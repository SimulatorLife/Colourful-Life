import { TRAIT_ACTIVATION_THRESHOLD } from "./config.js";
import {
  clamp,
  clamp01,
  sanitizeNumber,
  sanitizePositiveInteger,
  toFiniteOrNull,
} from "./utils.js";
import { warnOnce } from "./utils/error.js";

// Trait values >= threshold are considered "active" for presence stats.
const TRAIT_THRESHOLD = TRAIT_ACTIVATION_THRESHOLD;
const MAX_REPRODUCTION_PROB = 0.8;
const MAX_SIGHT_RANGE = 5;

// History series that the Stats class exposes to UI charts.
const HISTORY_SERIES_KEYS = [
  "population",
  "diversity",
  "diversityPressure",
  "energy",
  "growth",
  "birthsPerTick",
  "deathsPerTick",
  "eventStrength",
  "diversePairingRate",
  "meanDiversityAppetite",
  "mateNoveltyPressure",
  "mutationMultiplier",
  "starvationRate",
];

const DIVERSITY_TARGET_DEFAULT = 0.35;
const DIVERSITY_PRESSURE_SMOOTHING = 0.85;
const STRATEGY_PRESSURE_SMOOTHING = 0.82;

const LIFE_EVENT_LOG_CAPACITY = 240;
const LIFE_EVENT_RATE_DEFAULT_WINDOW = 200;

const DEFAULT_RANDOM = () => Math.random();

const INTERACTION_TRAIT_LABELS = Object.freeze({
  cooperate: "Cooperative",
  fight: "Combative",
  avoid: "Cautious",
});

const TRAIT_COMPUTE_WARNING =
  "Trait compute function failed; defaulting to neutral contribution.";

function wrapTraitCompute(fn) {
  if (typeof fn !== "function") {
    return () => 0;
  }

  return (cell) => {
    try {
      return clamp01(fn(cell));
    } catch (error) {
      warnOnce(TRAIT_COMPUTE_WARNING, error);

      return 0;
    }
  };
}

function normalizeThreshold(value, fallback = TRAIT_THRESHOLD) {
  const numeric = Number(value);

  return clamp01(Number.isFinite(numeric) ? numeric : fallback);
}

const clampInteractionTrait = (genes, key) => {
  const value = genes && typeof genes[key] === "number" ? genes[key] : 0;

  return clamp01(value);
};

// Baseline trait metrics tracked by Stats; callers may extend via constructor options.
const DEFAULT_TRAIT_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "cooperation",
    compute: wrapTraitCompute((cell) =>
      clampInteractionTrait(cell?.interactionGenes, "cooperate"),
    ),
    threshold: TRAIT_THRESHOLD,
  }),
  Object.freeze({
    key: "fighting",
    compute: wrapTraitCompute((cell) =>
      clampInteractionTrait(cell?.interactionGenes, "fight"),
    ),
    threshold: TRAIT_THRESHOLD,
  }),
  Object.freeze({
    key: "breeding",
    compute: wrapTraitCompute((cell) => {
      const probability =
        typeof cell?.dna?.reproductionProb === "function"
          ? cell.dna.reproductionProb()
          : 0;
      const normalized = probability > 0 ? probability / MAX_REPRODUCTION_PROB : 0;

      return normalized;
    }),
    threshold: TRAIT_THRESHOLD,
  }),
  Object.freeze({
    key: "sight",
    compute: wrapTraitCompute((cell) => {
      const sight = cell?.sight || 0;
      const normalized = sight > 0 ? sight / MAX_SIGHT_RANGE : 0;

      return normalized;
    }),
    threshold: TRAIT_THRESHOLD,
  }),
]);

// Normalises caller-supplied trait overrides, merging them with defaults.
function resolveTraitDefinitions(candidate) {
  const baseDefinitions = new Map(
    DEFAULT_TRAIT_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        compute: definition.compute,
        threshold: definition.threshold,
      },
    ]),
  );

  if (!Array.isArray(candidate)) {
    return Array.from(baseDefinitions.values());
  }

  for (const entry of candidate) {
    if (!entry || typeof entry !== "object") continue;

    const key = typeof entry.key === "string" ? entry.key.trim() : "";

    if (!key) continue;

    const overrideCompute =
      typeof entry.compute === "function" ? wrapTraitCompute(entry.compute) : null;
    const prior = baseDefinitions.get(key);
    const compute = overrideCompute ?? prior?.compute;

    if (typeof compute !== "function") {
      continue;
    }

    const threshold = normalizeThreshold(
      entry.threshold,
      prior?.threshold ?? TRAIT_THRESHOLD,
    );

    baseDefinitions.set(key, { key, compute, threshold });
  }

  return Array.from(baseDefinitions.values());
}

const createTraitValueMap = (definitions, initializer) => {
  const source =
    Array.isArray(definitions) && definitions.length > 0
      ? definitions
      : DEFAULT_TRAIT_DEFINITIONS;

  return Object.fromEntries(
    source.map(({ key }) => [
      key,
      typeof initializer === "function" ? initializer(key) : initializer,
    ]),
  );
};

/**
 * Minimal fixed-capacity ring buffer used by chart history accessors.
 * Keeps insertion O(n) for deterministic order while bounding memory.
 */
class FixedSizeRingBuffer {
  constructor(size = 0) {
    this.capacity = Math.max(0, Math.floor(size));
    this.buffer = new Array(this.capacity || 0);
    this.start = 0;
    this.length = 0;
  }

  push(value) {
    if (this.capacity === 0) return;

    if (this.length < this.capacity) {
      const index = (this.start + this.length) % this.capacity;

      this.buffer[index] = value;
      this.length += 1;

      return;
    }

    this.buffer[this.start] = value;
    this.start = (this.start + 1) % this.capacity;
  }

  values() {
    if (this.length === 0 || this.capacity === 0) return [];

    return Array.from({ length: this.length }, (_, index) => {
      const bufferIndex = (this.start + index) % this.capacity;

      return this.buffer[bufferIndex];
    });
  }

  clear() {
    this.start = 0;
    this.length = 0;

    if (Array.isArray(this.buffer)) {
      this.buffer.fill(undefined);
    }
  }
}

// Helper ensures ring construction is consistently clamped to integers.
const createHistoryRing = (size = 0) => new FixedSizeRingBuffer(size);

const createEmptyTraitPresence = (definitions) => ({
  population: 0,
  averages: createTraitValueMap(definitions, 0),
  fractions: createTraitValueMap(definitions, 0),
  counts: createTraitValueMap(definitions, 0),
});

// Captures counters for the mating subsystem; reused to avoid churn.
const createEmptyMatingSnapshot = () => ({
  choices: 0,
  successes: 0,
  diverseChoices: 0,
  diverseSuccesses: 0,
  appetiteSum: 0,
  selectionModes: { curiosity: 0, preference: 0 },
  poolSizeSum: 0,
  complementaritySum: 0,
  complementaritySuccessSum: 0,
  strategyPenaltySum: 0,
  strategyPressureSum: 0,
  noveltyPressureSum: 0,
  blocks: 0,
  lastBlockReason: null,
});

const isCellLike = (candidate) => {
  if (!candidate || typeof candidate !== "object") return false;

  return (
    typeof candidate.dna === "object" ||
    typeof candidate.color === "string" ||
    typeof candidate.interactionGenes === "object" ||
    typeof candidate.genes === "object" ||
    Number.isFinite(candidate.energy)
  );
};

/**
 * Aggregates per-tick simulation metrics and exposes rolling history series
 * for UI components. This class is intentionally stateful so the simulation
 * engine can reuse a single instance across ticks without reallocating rings.
 */
export default class Stats {
  #historyRings;
  #traitHistoryRings;
  #lifeEventTickBase;
  #tickInProgress;
  #traitSums;
  #traitActiveCounts;
  #traitPresenceView;
  #traitPopulation;
  #needsTraitRebuild;
  #traitPresenceDirty;
  #nextTraitResampleTick;
  #nextDiversitySampleTick;
  #diversityPopulationBaseline;
  #traitKeys;
  #traitComputes;
  #traitThresholds;
  #rng;
  #pairSampleScratch;
  #pairSampleSelection;
  /**
   * @param {number} [historySize=10000] Maximum retained history samples per series.
   * @param {{
   *   traitDefinitions?: Array<{key: string, compute?: Function, threshold?: number}>,
   *   traitResampleInterval?: number,
   *   diversitySampleInterval?: number,
   *   rng?: () => number,
   * }} [options]
   *   Optional configuration allowing callers to extend or override tracked trait metrics and randomness.
   */
  constructor(historySize = 10000, options = {}) {
    this.historySize = historySize;
    const { traitDefinitions, traitResampleInterval, diversitySampleInterval, rng } =
      options ?? {};

    this.traitDefinitions = resolveTraitDefinitions(traitDefinitions);
    this.traitPresence = createEmptyTraitPresence(this.traitDefinitions);
    this.#traitPresenceView = this.traitPresence;
    this.#traitKeys = this.traitDefinitions.map(({ key }) => key);
    this.#traitComputes = this.traitDefinitions.map(({ compute }) => compute);
    this.#traitThresholds = Float64Array.from(
      this.traitDefinitions,
      ({ threshold }) => threshold ?? TRAIT_THRESHOLD,
    );
    this.#traitSums = new Float64Array(this.traitDefinitions.length);
    this.#traitActiveCounts = new Float64Array(this.traitDefinitions.length);
    this.#rng = typeof rng === "function" ? rng : DEFAULT_RANDOM;
    this.traitResampleInterval = sanitizePositiveInteger(traitResampleInterval, {
      fallback: 120,
      min: 1,
    });
    this.diversitySampleInterval = sanitizePositiveInteger(diversitySampleInterval, {
      fallback: 4,
      min: 1,
    });
    this.lastDiversitySample = 0;
    this.#nextTraitResampleTick = 0;
    this.#nextDiversitySampleTick = 0;
    this.#diversityPopulationBaseline = 0;
    this.#resetTraitAggregates();
    this.resetTick();
    this.history = {};
    this.#historyRings = {};
    this.totals = { ticks: 0, births: 0, deaths: 0, fights: 0, cooperations: 0 };
    this.traitHistory = { presence: {}, average: {} };
    this.#traitHistoryRings = { presence: {}, average: {} };
    this.#lifeEventTickBase = this.totals.ticks;
    this.#tickInProgress = false;
    this.matingDiversityThreshold = 0.42;
    this.lastMatingDebug = null;
    this.mutationMultiplier = 1;
    this.lastBlockedReproduction = null;
    this.diversityTarget = DIVERSITY_TARGET_DEFAULT;
    this.diversityPressure = 0;
    this.behavioralEvenness = 0;
    this.strategyPressure = 0;
    this.lifeEventLog = createHistoryRing(LIFE_EVENT_LOG_CAPACITY);
    this.lifeEventSequence = 0;
    this.deathCauseTotals = Object.create(null);
    this.performance = Object.create(null);
    this.performance.energy = {
      lastTiming: null,
      history: createHistoryRing(240),
    };
    this.starvationRateSmoothed = 0;
    this.#pairSampleScratch = new Uint32Array(0);
    this.#pairSampleSelection = new Set();

    HISTORY_SERIES_KEYS.forEach((key) => {
      const ring = createHistoryRing(this.historySize);

      this.#historyRings[key] = ring;
      Object.defineProperty(this.history, key, {
        enumerable: true,
        configurable: false,
        get: () => ring.values(),
      });
    });

    for (const { key } of this.traitDefinitions) {
      const presenceRing = createHistoryRing(this.historySize);
      const averageRing = createHistoryRing(this.historySize);

      this.#traitHistoryRings.presence[key] = presenceRing;
      this.#traitHistoryRings.average[key] = averageRing;

      Object.defineProperty(this.traitHistory.presence, key, {
        enumerable: true,
        configurable: false,
        get: () => presenceRing.values(),
      });

      Object.defineProperty(this.traitHistory.average, key, {
        enumerable: true,
        configurable: false,
        get: () => averageRing.values(),
      });
    }

    this.traitPresence = this.#traitPresenceView;
  }

  resetTick() {
    this.births = 0;
    this.deaths = 0;
    this.fights = 0;
    this.cooperations = 0;
    this.mating = createEmptyMatingSnapshot();
    this.lastMatingDebug = null;
    this.lastBlockedReproduction = null;
    this.deathCausesTick = Object.create(null);
    const currentTicks = Number.isFinite(this.totals?.ticks) ? this.totals.ticks : 0;

    this.#lifeEventTickBase = currentTicks + 1;
    this.#tickInProgress = true;
  }

  resetAll() {
    this.resetTick();
    this.totals = { ticks: 0, births: 0, deaths: 0, fights: 0, cooperations: 0 };

    Object.values(this.#historyRings).forEach((ring) => ring?.clear?.());
    const traitPresenceRings = this.#traitHistoryRings?.presence ?? {};
    const traitAverageRings = this.#traitHistoryRings?.average ?? {};

    Object.values(traitPresenceRings).forEach((ring) => ring?.clear?.());
    Object.values(traitAverageRings).forEach((ring) => ring?.clear?.());

    this.#resetTraitAggregates();
    this.traitPresence = this.#traitPresenceView;
    this.lastDiversitySample = 0;
    this.#nextTraitResampleTick = this.totals.ticks;
    this.#nextDiversitySampleTick = this.totals.ticks;
    this.#diversityPopulationBaseline = 0;
    this.diversityPressure = 0;
    this.behavioralEvenness = 0;
    this.strategyPressure = 0;
    this.meanBehaviorComplementarity = 0;
    this.successfulBehaviorComplementarity = 0;
    this.lifeEventLog = createHistoryRing(LIFE_EVENT_LOG_CAPACITY);
    this.lifeEventSequence = 0;
    this.lastMatingDebug = null;
    this.lastBlockedReproduction = null;
    this.deathCauseTotals = Object.create(null);
    if (this.performance?.energy?.history?.clear) {
      this.performance.energy.history.clear();
    }
    if (this.performance?.energy) {
      this.performance.energy.lastTiming = null;
    }
    this.#tickInProgress = false;
    this.#lifeEventTickBase = this.totals.ticks;
    this.performance = Object.create(null);
    this.performance.energy = {
      lastTiming: null,
      history: createHistoryRing(240),
    };
    this.starvationRateSmoothed = 0;
  }

  setDiversityTarget(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return;

    this.diversityTarget = clamp01(numeric);
  }

  getDiversityTarget() {
    return this.diversityTarget;
  }

  getDiversityPressure() {
    return this.diversityPressure;
  }

  getBehavioralEvenness() {
    const value = Number.isFinite(this.behavioralEvenness)
      ? this.behavioralEvenness
      : 0;

    return clamp01(value);
  }

  getStrategyPressure() {
    const value = Number.isFinite(this.strategyPressure) ? this.strategyPressure : 0;

    return clamp01(value);
  }

  recordPerformanceSummary(domain, summary) {
    if (!domain || typeof domain !== "string") return;
    if (!summary || typeof summary !== "object") return;

    if (!this.performance || typeof this.performance !== "object") {
      this.performance = Object.create(null);
    }

    const bucket = (this.performance[domain] ??= {
      lastTick: Object.create(null),
      totals: Object.create(null),
      samples: Object.create(null),
    });
    const lastTick = bucket.lastTick;

    if (lastTick && typeof lastTick === "object") {
      for (const key of Object.keys(lastTick)) {
        delete lastTick[key];
      }
    }

    const coerceFinite = (candidate) => {
      const numeric = toFiniteOrNull(candidate);

      return numeric != null ? numeric : null;
    };

    for (const [metric, descriptor] of Object.entries(summary)) {
      if (!metric) continue;

      let value = null;
      let accumulate = true;
      let sampleCount = null;
      const isObjectDescriptor =
        descriptor != null &&
        typeof descriptor === "object" &&
        !Array.isArray(descriptor);

      if (isObjectDescriptor) {
        if (descriptor.value != null) {
          const numericValue = coerceFinite(descriptor.value);

          if (numericValue != null) {
            value = numericValue;
          }
        } else {
          const numericValue = coerceFinite(descriptor);

          if (numericValue != null) {
            value = numericValue;
          }
        }

        if (descriptor.accumulate === false) {
          accumulate = false;
        }

        if (descriptor.count != null) {
          const numericCount = coerceFinite(descriptor.count);

          if (numericCount != null) {
            sampleCount = numericCount;
          }
        } else if (descriptor.samples != null) {
          const numericSamples = coerceFinite(descriptor.samples);

          if (numericSamples != null) {
            sampleCount = numericSamples;
          }
        }
      } else {
        const numericValue = coerceFinite(descriptor);

        if (numericValue != null) {
          value = numericValue;
        }
      }

      if (value != null) {
        lastTick[metric] = value;

        if (accumulate) {
          bucket.totals[metric] = (bucket.totals[metric] ?? 0) + value;
        }
      }

      const resolvedSampleCount =
        sampleCount != null ? sampleCount : value != null ? 1 : null;

      if (resolvedSampleCount != null) {
        bucket.samples[metric] = (bucket.samples[metric] ?? 0) + resolvedSampleCount;
      }
    }
  }

  #updateDiversityPressure(
    observedDiversity = 0,
    behaviorEvenness = 0,
    successfulComplementarity = 0,
    meanStrategyPenalty = 1,
    diverseSuccessRate = 0,
  ) {
    const target = clamp01(this.diversityTarget ?? DIVERSITY_TARGET_DEFAULT);

    if (target <= 0) {
      this.diversityPressure = 0;

      return;
    }

    const diversityValue = clamp01(
      Number.isFinite(observedDiversity) ? observedDiversity : 0,
    );
    const evennessValue = clamp01(
      Number.isFinite(behaviorEvenness) ? behaviorEvenness : 0,
    );
    const complementValue = clamp01(
      Number.isFinite(successfulComplementarity) ? successfulComplementarity : 0,
    );
    const penaltyAverage = clamp01(
      Number.isFinite(meanStrategyPenalty) ? meanStrategyPenalty : 1,
    );
    const penaltySlack = penaltyAverage;
    const penaltyRelief = clamp01(1 - penaltyAverage);
    const successRate = clamp01(
      Number.isFinite(diverseSuccessRate) ? diverseSuccessRate : 0,
    );
    const successTarget = Math.max(0.1, Math.min(0.85, 0.35 + target * 0.5));
    const successShortfall =
      successTarget > 0 ? clamp01((successTarget - successRate) / successTarget) : 0;

    const geneticShortfall = clamp01((target - diversityValue) / target);
    const evennessShortfall = clamp01(1 - evennessValue);
    const evennessDemand = evennessShortfall * (0.3 + geneticShortfall * 0.4);
    const successDemand =
      successShortfall * (0.25 + penaltySlack * 0.35 + (1 - evennessValue) * 0.25);
    const combinedShortfall = clamp01(
      geneticShortfall * 0.65 + evennessDemand + successDemand,
    );
    const complementRelief = complementValue * 0.35;
    const targetPressure = Math.max(0, combinedShortfall - complementRelief);
    const prev = Number.isFinite(this.diversityPressure) ? this.diversityPressure : 0;
    const next =
      prev * DIVERSITY_PRESSURE_SMOOTHING +
      targetPressure * (1 - DIVERSITY_PRESSURE_SMOOTHING);

    this.diversityPressure = clamp01(next);

    const monotonyDemand =
      evennessShortfall * (0.45 + geneticShortfall * 0.35) * (0.7 + penaltySlack * 0.6);
    const monotonyDemandScaled = clamp01(monotonyDemand * (1 + successShortfall * 0.5));
    const complementReliefStrategy = clamp01(
      complementValue * (0.25 + geneticShortfall * 0.3) * (0.8 + penaltyRelief * 0.4),
    );
    const rawStrategyPressure = clamp01(
      monotonyDemandScaled - complementReliefStrategy,
    );
    const prevStrategy = Number.isFinite(this.strategyPressure)
      ? this.strategyPressure
      : 0;
    const strategyNext =
      prevStrategy * STRATEGY_PRESSURE_SMOOTHING +
      rawStrategyPressure * (1 - STRATEGY_PRESSURE_SMOOTHING);

    this.strategyPressure = clamp01(strategyNext);
  }

  #computeBehavioralEvenness(traitPresence) {
    const fractions = traitPresence?.fractions;

    if (!fractions || typeof fractions !== "object") {
      return 0;
    }

    const values = Object.values(fractions).reduce((acc, raw) => {
      if (!Number.isFinite(raw) || raw <= 0) {
        return acc;
      }

      acc.push(clamp01(raw));

      return acc;
    }, []);

    if (values.length === 0) return 0;
    if (values.length === 1) return 0;

    const sum = values.reduce((acc, value) => acc + value, 0);

    if (!(sum > 0)) {
      return 0;
    }

    const invSum = 1 / sum;
    const entropy = values.reduce((total, value) => {
      const probability = value * invSum;

      if (!(probability > 0)) {
        return total;
      }

      return total - probability * Math.log(probability);
    }, 0);

    const maxEntropy = Math.log(values.length);

    if (!(maxEntropy > 0) || !Number.isFinite(entropy)) {
      return 0;
    }

    return clamp01(entropy / maxEntropy);
  }

  #resolveLifeEventArgs(primary, secondary) {
    if (isCellLike(primary)) {
      const context = secondary && typeof secondary === "object" ? secondary : {};

      return { cell: primary, context };
    }

    const context =
      primary && typeof primary === "object"
        ? primary
        : secondary && typeof secondary === "object"
          ? secondary
          : {};
    const candidate = context?.cell;
    const cell = isCellLike(candidate) ? candidate : null;

    return { cell, context };
  }

  #resetTraitAggregates() {
    if (this.#traitSums) {
      this.#traitSums.fill(0);
    }
    if (this.#traitActiveCounts) {
      this.#traitActiveCounts.fill(0);
    }

    this.#traitPopulation = 0;
    this.#needsTraitRebuild = true;
    this.#traitPresenceDirty = true;

    if (!this.#traitPresenceView) return;

    const { averages, fractions, counts } = this.#traitPresenceView;

    this.#traitPresenceView.population = 0;

    if (!Array.isArray(this.#traitKeys)) return;

    this.#traitKeys.forEach((key) => {
      averages[key] = 0;
      fractions[key] = 0;
      counts[key] = 0;
    });
  }

  #resolveTraitValue(compute, cell) {
    const rawValue = typeof compute === "function" ? compute(cell) : 0;

    return Number.isFinite(rawValue) ? clamp01(rawValue) : 0;
  }

  #applyTraitSample(cell, direction) {
    if (!cell) {
      this.#needsTraitRebuild = true;
      this.#traitPresenceDirty = true;

      return;
    }

    const sums = this.#traitSums;
    const activeCounts = this.#traitActiveCounts;
    const thresholds = this.#traitThresholds;

    this.#traitComputes.forEach((compute, index) => {
      const threshold = thresholds[index];
      const value = this.#resolveTraitValue(compute, cell);
      const nextSum = sums[index] + value * direction;

      sums[index] = nextSum >= 0 ? nextSum : 0;

      if (value >= threshold) {
        const nextCount = activeCounts[index] + direction;

        activeCounts[index] = nextCount > 0 ? nextCount : 0;
      }
    });

    this.#traitPresenceDirty = true;
  }

  #rebuildTraitAggregates(cellSources) {
    const pool = Array.isArray(cellSources) ? cellSources : [];
    const computes = this.#traitComputes;
    const thresholds = this.#traitThresholds;
    const computeCount = computes.length;

    this.#traitSums.fill(0);
    this.#traitActiveCounts.fill(0);

    if (pool.length === 0) {
      this.#traitPopulation = 0;
      this.#needsTraitRebuild = false;
      this.#traitPresenceDirty = true;

      return;
    }

    const traitSums = this.#traitSums;
    const traitActiveCounts = this.#traitActiveCounts;
    const hasOwn = Object.prototype.hasOwnProperty;

    let population = 0;

    const poolLength = pool.length;

    for (let i = 0; i < poolLength; i += 1) {
      const source = pool[i];
      const cell =
        source && typeof source === "object" && hasOwn.call(source, "cell")
          ? source.cell
          : source;

      if (!cell || typeof cell !== "object") {
        continue;
      }

      population += 1;

      for (let traitIndex = 0; traitIndex < computeCount; traitIndex += 1) {
        const compute = computes[traitIndex];
        const threshold = thresholds[traitIndex];
        const value = compute(cell) || 0;

        traitSums[traitIndex] += value;
        traitActiveCounts[traitIndex] += value >= threshold ? 1 : 0;
      }
    }

    this.#traitPopulation = population;
    this.#needsTraitRebuild = false;
    this.#traitPresenceDirty = true;
  }

  #refreshTraitPresenceView(population = this.#traitPopulation) {
    if (!this.#traitPresenceView) {
      return createEmptyTraitPresence(this.traitDefinitions);
    }

    const resolvedPopulation = Math.max(0, Math.floor(Number(population) || 0));
    const invPop = resolvedPopulation > 0 ? 1 / resolvedPopulation : 0;
    const view = this.#traitPresenceView;

    view.population = resolvedPopulation;

    this.#traitKeys.forEach((key, index) => {
      const sum = this.#traitSums[index];
      const count = this.#traitActiveCounts[index];
      const normalizedCount = count > 0 ? count : 0;
      const average = resolvedPopulation > 0 ? clamp01(sum * invPop) : 0;
      const fraction = resolvedPopulation > 0 ? clamp01(normalizedCount * invPop) : 0;

      view.averages[key] = average;
      view.fractions[key] = fraction;
      view.counts[key] = Math.max(0, Math.round(normalizedCount));
    });

    return view;
  }

  #resolveInteractionHighlight(interactionGenes) {
    if (!interactionGenes || typeof interactionGenes !== "object") {
      return null;
    }

    const entries = [
      { key: "cooperate", value: Number(interactionGenes.cooperate) },
      { key: "fight", value: Number(interactionGenes.fight) },
      { key: "avoid", value: Number(interactionGenes.avoid) },
    ].filter((entry) => Number.isFinite(entry.value) && entry.value > 0);

    if (!entries.length) {
      return null;
    }

    const { total, best } = entries.reduce(
      (accumulator, entry) => {
        accumulator.total += entry.value;

        if (entry.value > accumulator.best.value) {
          accumulator.best = entry;
        }

        return accumulator;
      },
      { total: 0, best: entries[0] },
    );

    if (best.value <= 0) {
      return null;
    }

    const ratio = total > 0 ? clamp01(best.value / total) : 0;
    const label = INTERACTION_TRAIT_LABELS[best.key] ?? best.key;

    return {
      key: best.key,
      label,
      ratio,
      value: best.value,
    };
  }

  #buildLifeEventPayload(type, cell, context = {}) {
    if (!type) return null;

    const safeContext = context && typeof context === "object" ? { ...context } : {};
    const contextCell = safeContext.cell;
    const resolvedCell = isCellLike(cell)
      ? cell
      : isCellLike(contextCell)
        ? contextCell
        : null;

    if (safeContext.cell) delete safeContext.cell;

    const row = toFiniteOrNull(safeContext.row) ?? toFiniteOrNull(resolvedCell?.row);
    const col = toFiniteOrNull(safeContext.col) ?? toFiniteOrNull(resolvedCell?.col);
    const energy =
      toFiniteOrNull(safeContext.energy) ?? toFiniteOrNull(resolvedCell?.energy);
    const colorCandidate = safeContext.color;
    const color =
      typeof colorCandidate === "string" && colorCandidate.length > 0
        ? colorCandidate
        : typeof resolvedCell?.dna?.toColor === "function"
          ? resolvedCell.dna.toColor()
          : typeof resolvedCell?.color === "string"
            ? resolvedCell.color
            : null;
    const mutationMultiplier = toFiniteOrNull(safeContext.mutationMultiplier);
    const intensity = toFiniteOrNull(safeContext.intensity);
    const winChanceCandidate = toFiniteOrNull(safeContext.winChance);
    const winChance = winChanceCandidate != null ? clamp01(winChanceCandidate) : null;
    const opponentColor =
      typeof safeContext.opponentColor === "string" &&
      safeContext.opponentColor.length > 0
        ? safeContext.opponentColor
        : null;
    const note =
      typeof safeContext.note === "string" && safeContext.note.length > 0
        ? safeContext.note
        : null;
    const cause =
      typeof safeContext.cause === "string" && safeContext.cause.length > 0
        ? safeContext.cause
        : type;
    const interactionGenes =
      safeContext.interactionGenes && typeof safeContext.interactionGenes === "object"
        ? safeContext.interactionGenes
        : resolvedCell?.interactionGenes;
    const highlight = this.#resolveInteractionHighlight(interactionGenes);
    const parentColors = Array.isArray(safeContext.parents)
      ? safeContext.parents
          .map((value) => (typeof value === "string" ? value : null))
          .filter((value) => value)
      : null;

    const currentTicks = Number.isFinite(this.totals?.ticks) ? this.totals.ticks : 0;
    const event = {
      id: ++this.lifeEventSequence,
      type,
      tick: this.#tickInProgress ? this.#lifeEventTickBase : currentTicks,
      row,
      col,
      energy,
      color,
      cause,
    };

    if (highlight) {
      event.highlight = highlight;
    }
    if (mutationMultiplier != null) {
      event.mutationMultiplier = mutationMultiplier;
    }
    if (intensity != null) {
      event.intensity = intensity;
    }
    if (winChance != null) {
      event.winChance = winChance;
    }
    if (opponentColor) {
      event.opponentColor = opponentColor;
    }
    if (note) {
      event.note = note;
    }
    if (parentColors && parentColors.length > 0) {
      event.parents = parentColors;
    }

    return event;
  }

  #recordLifeEvent(type, primary, secondary) {
    if (!this.lifeEventLog) return;

    const { cell, context } = this.#resolveLifeEventArgs(primary, secondary);
    const payload = this.#buildLifeEventPayload(type, cell, context);

    if (payload) {
      this.lifeEventLog.push(payload);
    }
  }

  onBirth(primary, secondary) {
    this.births++;
    this.totals.births++;
    const { cell } = this.#resolveLifeEventArgs(primary, secondary);

    this.#traitPopulation += 1;

    if (cell) {
      this.#applyTraitSample(cell, 1);
    } else {
      this.#needsTraitRebuild = true;
      this.#traitPresenceDirty = true;
    }

    this.#recordLifeEvent("birth", primary, secondary);
  }
  onDeath(primary, secondary) {
    this.deaths++;
    this.totals.deaths++;
    const { cell } = this.#resolveLifeEventArgs(primary, secondary);

    if (cell) {
      this.#applyTraitSample(cell, -1);
    } else {
      this.#needsTraitRebuild = true;
      this.#traitPresenceDirty = true;
    }

    this.#traitPopulation = Math.max(0, this.#traitPopulation - 1);
    this.#recordLifeEvent("death", primary, secondary);

    const causeCandidate =
      secondary && typeof secondary === "object" ? secondary.cause : null;
    const causeKey =
      typeof causeCandidate === "string" && causeCandidate.length > 0
        ? causeCandidate
        : "unknown";

    if (!this.deathCausesTick) {
      this.deathCausesTick = Object.create(null);
    }
    if (!this.deathCauseTotals) {
      this.deathCauseTotals = Object.create(null);
    }

    this.deathCausesTick[causeKey] = (this.deathCausesTick[causeKey] || 0) + 1;
    this.deathCauseTotals[causeKey] = (this.deathCauseTotals[causeKey] || 0) + 1;
  }
  onFight() {
    this.fights++;
    this.totals.fights++;
  }
  onCooperate() {
    this.cooperations++;
    this.totals.cooperations++;
  }

  // Sample mean pairwise distance between up to maxPairSamples random pairs.
  estimateDiversity(cellSources, maxPairSamples = 200) {
    if (!Array.isArray(cellSources) || cellSources.length < 2) {
      return 0;
    }

    const numericMaxSamples = Number(maxPairSamples);
    const sanitizedMaxSamples = Number.isFinite(numericMaxSamples)
      ? Math.max(0, Math.floor(numericMaxSamples))
      : numericMaxSamples === Infinity
        ? Infinity
        : 0;
    const validDna = cellSources.reduce((dnaList, source) => {
      const cell =
        source &&
        typeof source === "object" &&
        Object.prototype.hasOwnProperty.call(source, "cell")
          ? source.cell
          : source;

      const dna = cell?.dna;

      if (dna && typeof dna.similarity === "function") {
        dnaList.push(dna);
      }

      return dnaList;
    }, []);

    const populationSize = validDna.length;

    if (populationSize < 2) {
      return 0;
    }

    const possiblePairs = (populationSize * (populationSize - 1)) / 2;

    if (!(possiblePairs > 0)) {
      return 0;
    }

    if (sanitizedMaxSamples === 0 || possiblePairs <= sanitizedMaxSamples) {
      let sum = 0;
      let count = 0;

      for (let i = 0; i < populationSize - 1; i += 1) {
        const dnaA = validDna[i];
        const { similarity } = dnaA;

        if (typeof similarity !== "function") {
          continue;
        }

        for (let j = i + 1; j < populationSize; j += 1) {
          const dnaB = validDna[j];

          sum += 1 - similarity.call(dnaA, dnaB);
          count += 1;
        }
      }

      return count > 0 ? sum / count : 0;
    }

    const sampleLimit = Math.min(sanitizedMaxSamples, possiblePairs);
    const rng = this.#rng ?? DEFAULT_RANDOM;
    const sampleIndex = (range) => {
      if (!(range > 0)) {
        return 0;
      }

      let roll = rng();

      if (!Number.isFinite(roll)) {
        roll = DEFAULT_RANDOM();
      }

      const fractional = roll - Math.trunc(roll);
      const normalized = fractional >= 0 ? fractional : fractional + 1;

      return Math.min(range - 1, Math.floor(normalized * range));
    };

    let samples = this.#pairSampleScratch;

    if (!samples || samples.length < sampleLimit) {
      samples = new Uint32Array(sampleLimit);
      this.#pairSampleScratch = samples;
    }

    const selected = this.#pairSampleSelection;

    selected.clear();

    let filled = 0;
    const startIndex = possiblePairs - sampleLimit;

    for (let i = startIndex; i < possiblePairs; i += 1) {
      const candidate = sampleIndex(i + 1);
      const pick = selected.has(candidate) ? i : candidate;

      selected.add(pick);
      samples[filled] = pick;
      filled += 1;
    }

    if (filled === 0) {
      return 0;
    }

    const sortedSamples = samples.subarray(0, filled);

    sortedSamples.sort((a, b) => a - b);

    let sum = 0;
    let count = 0;
    let rowOffset = 0;
    let sampleIdx = 0;

    for (
      let first = 0;
      first < populationSize - 1 && sampleIdx < sortedSamples.length;
      first += 1
    ) {
      const combosForFirst = populationSize - first - 1;
      const rowEnd = rowOffset + combosForFirst;

      while (sampleIdx < sortedSamples.length) {
        const comboIndex = sortedSamples[sampleIdx];

        if (comboIndex >= rowEnd) {
          break;
        }

        const second = first + 1 + (comboIndex - rowOffset);
        const dnaA = validDna[first];
        const dnaB = validDna[second];
        const similarity = dnaA?.similarity;

        if (dnaA && dnaB && typeof similarity === "function") {
          sum += 1 - similarity.call(dnaA, dnaB);
          count += 1;
        }

        sampleIdx += 1;
      }

      rowOffset = rowEnd;
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Compute per-tick aggregates from the simulation snapshot and push the
   * derived values into rolling history buffers for charting.
   */
  updateFromSnapshot(snapshot) {
    this.totals.ticks++;
    const rawPopulation = Number(snapshot?.population);
    const pop = Number.isFinite(rawPopulation)
      ? Math.max(0, Math.floor(rawPopulation))
      : 0;
    const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
    const populationSources = Array.isArray(snapshot?.populationCells)
      ? snapshot.populationCells
      : entries;
    const totalEnergy = Number.isFinite(snapshot?.totalEnergy)
      ? snapshot.totalEnergy
      : 0;
    const totalAge = Number.isFinite(snapshot?.totalAge) ? snapshot.totalAge : 0;
    const meanEnergy = pop > 0 ? totalEnergy / pop : 0;
    // Age is tracked in simulation ticks; convert with the active tick rate if seconds are needed.
    const meanAge = pop > 0 ? totalAge / pop : 0;
    const tick = this.totals.ticks;
    const populationChanged = this.#traitPopulation !== pop;

    if (populationChanged) {
      this.#traitPresenceDirty = true;
    }

    const shouldRebuildTraits =
      this.#needsTraitRebuild ||
      populationChanged ||
      tick >= this.#nextTraitResampleTick;

    if (shouldRebuildTraits) {
      this.#rebuildTraitAggregates(populationSources);
      this.#nextTraitResampleTick = tick + this.traitResampleInterval;
    }

    let traitPresence;

    if (shouldRebuildTraits || this.#traitPresenceDirty) {
      traitPresence = this.#refreshTraitPresenceView();
      this.traitPresence = traitPresence;
      this.#traitPresenceDirty = false;
    } else {
      traitPresence = this.traitPresence;
    }

    const shouldSampleDiversity =
      tick >= this.#nextDiversitySampleTick ||
      this.#diversityPopulationBaseline !== pop;

    if (shouldSampleDiversity) {
      this.lastDiversitySample = this.estimateDiversity(populationSources);
      this.#diversityPopulationBaseline = pop;
      this.#nextDiversitySampleTick = tick + this.diversitySampleInterval;
    }

    const diversity = this.lastDiversitySample;
    const behaviorEvenness = this.#computeBehavioralEvenness(traitPresence);
    const mateStats = this.mating || createEmptyMatingSnapshot();
    const choiceCount = mateStats.choices || 0;
    const successCount = mateStats.successes || 0;
    const diverseChoiceRate = choiceCount ? mateStats.diverseChoices / choiceCount : 0;
    const diverseSuccessRate = successCount
      ? mateStats.diverseSuccesses / successCount
      : 0;
    const meanAppetite = choiceCount ? mateStats.appetiteSum / choiceCount : 0;
    const meanComplementarity =
      choiceCount > 0 ? mateStats.complementaritySum / choiceCount : 0;
    const successfulComplementarity =
      successCount > 0 ? mateStats.complementaritySuccessSum / successCount : 0;
    const meanStrategyPenalty =
      choiceCount > 0 ? mateStats.strategyPenaltySum / choiceCount : 1;
    const meanStrategyPressure =
      choiceCount > 0 ? mateStats.strategyPressureSum / choiceCount : 0;
    const meanMateNoveltyPressure =
      choiceCount > 0 ? mateStats.noveltyPressureSum / choiceCount : 0;

    this.#updateDiversityPressure(
      diversity,
      behaviorEvenness,
      successfulComplementarity,
      meanStrategyPenalty,
      diverseSuccessRate,
    );

    this.pushHistory("population", pop);
    this.pushHistory("diversity", diversity);
    this.pushHistory("diversityPressure", this.diversityPressure);
    this.pushHistory("energy", meanEnergy);
    this.pushHistory("growth", this.births - this.deaths);
    this.pushHistory("birthsPerTick", this.births);
    this.pushHistory("deathsPerTick", this.deaths);
    this.pushHistory("diversePairingRate", diverseChoiceRate);
    this.pushHistory("meanDiversityAppetite", meanAppetite);
    this.pushHistory("mateNoveltyPressure", meanMateNoveltyPressure);
    if (typeof this.mutationMultiplier === "number") {
      this.pushHistory("mutationMultiplier", this.mutationMultiplier);
    }
    const starvationDeaths = this.deathCausesTick?.starvation ?? 0;
    const starvationInstant = this.deaths > 0 ? starvationDeaths / this.deaths : 0;
    const totalDeaths = this.totals?.deaths ?? 0;
    const starvationCumulative =
      totalDeaths > 0 && Number.isFinite(totalDeaths)
        ? (this.deathCauseTotals?.starvation ?? 0) / totalDeaths
        : 0;
    const previousStarvation = Number.isFinite(this.starvationRateSmoothed)
      ? this.starvationRateSmoothed
      : 0;
    const blendedStarvation =
      previousStarvation * 0.6 + starvationCumulative * 0.25 + starvationInstant * 0.15;

    this.starvationRateSmoothed = clamp01(blendedStarvation);
    this.pushHistory("starvationRate", this.starvationRateSmoothed);

    this.traitPresence = traitPresence;
    this.behavioralEvenness = behaviorEvenness;
    this.meanBehaviorComplementarity = meanComplementarity;
    this.successfulBehaviorComplementarity = successfulComplementarity;
    for (const { key } of this.traitDefinitions) {
      this.pushTraitHistory("presence", key, traitPresence.fractions[key] ?? 0);
      this.pushTraitHistory("average", key, traitPresence.averages[key] ?? 0);
    }

    this.#tickInProgress = false;
    this.#lifeEventTickBase = this.totals.ticks;

    return {
      population: pop,
      births: this.births,
      deaths: this.deaths,
      growth: this.births - this.deaths,
      birthsPerTick: this.births,
      deathsPerTick: this.deaths,
      fights: this.fights,
      cooperations: this.cooperations,
      meanEnergy,
      meanAge,
      diversity,
      diversityPressure: this.diversityPressure,
      diversityTarget: this.diversityTarget,
      traitPresence,
      mateChoices: choiceCount,
      successfulMatings: successCount,
      diverseChoiceRate,
      diverseMatingRate: diverseSuccessRate,
      meanDiversityAppetite: meanAppetite,
      meanBehaviorComplementarity: meanComplementarity,
      successfulBehaviorComplementarity: successfulComplementarity,
      behaviorEvenness,
      meanStrategyPenalty,
      meanStrategyPressure,
      mateNoveltyPressure: meanMateNoveltyPressure,
      strategyPressure: this.strategyPressure,
      curiositySelections: mateStats.selectionModes.curiosity,
      lastMating: this.lastMatingDebug,
      mutationMultiplier: this.mutationMultiplier,
      blockedMatings: mateStats.blocks || 0,
      lastBlockedReproduction: this.lastBlockedReproduction,
      deathBreakdown: this.deathCausesTick ? { ...this.deathCausesTick } : {},
      starvationRate: this.starvationRateSmoothed,
    };
  }

  setMatingDiversityThreshold(value) {
    const clamped = sanitizeNumber(value, { fallback: null, min: 0, max: 1 });

    if (clamped === null) return;

    this.matingDiversityThreshold = clamped;
  }

  /**
   * Capture the outcome of a single mate choice, tracking diversity exposure
   * and success rates used in diversity overlays.
   */
  recordMateChoice({
    similarity = 1,
    diversity = 0,
    appetite = 0,
    bias = 0,
    selectionMode = "preference",
    poolSize = 0,
    success = false,
    penalized = false,
    penaltyMultiplier = 1,
    behaviorComplementarity = 0,
    strategyPenaltyMultiplier = 1,
    strategyPressure = undefined,
    threshold,
    noveltyPressure = undefined,
  } = {}) {
    if (!this.mating) {
      this.mating = createEmptyMatingSnapshot();
    }

    const resolvedThreshold = clamp01(
      Number.isFinite(threshold) ? threshold : this.matingDiversityThreshold,
    );
    const isDiverse = diversity >= resolvedThreshold;
    const complementarity = clamp01(behaviorComplementarity);

    this.mating.choices++;
    this.mating.appetiteSum += appetite || 0;
    this.mating.poolSizeSum += poolSize || 0;
    if (isDiverse) this.mating.diverseChoices++;
    if (selectionMode === "curiosity") this.mating.selectionModes.curiosity++;
    else this.mating.selectionModes.preference++;
    this.mating.complementaritySum += complementarity;
    const strategyMultiplier = clamp01(
      Number.isFinite(strategyPenaltyMultiplier) ? strategyPenaltyMultiplier : 1,
    );

    this.mating.strategyPenaltySum += strategyMultiplier;
    if (Number.isFinite(strategyPressure)) {
      this.mating.strategyPressureSum += clamp01(strategyPressure);
    }
    if (Number.isFinite(noveltyPressure)) {
      this.mating.noveltyPressureSum += clamp01(noveltyPressure);
    }

    if (success) {
      this.mating.successes++;
      if (isDiverse) this.mating.diverseSuccesses++;
      this.mating.complementaritySuccessSum += complementarity;
    }

    this.lastMatingDebug = {
      similarity,
      diversity,
      appetite,
      bias,
      selectionMode,
      poolSize,
      success,
      threshold: resolvedThreshold,
      penalized,
      penaltyMultiplier,
      behaviorComplementarity: complementarity,
      strategyPenaltyMultiplier,
      strategyPressure,
      noveltyPressure,
      blockedReason: this.mating.lastBlockReason || undefined,
    };
    // Consume the one-time reason so the next mating record does not reuse it.
    this.mating.lastBlockReason = null;
  }

  recordReproductionBlocked({
    reason,
    parentA = null,
    parentB = null,
    spawn = null,
  } = {}) {
    if (!this.mating) {
      this.mating = createEmptyMatingSnapshot();
    }

    this.mating.blocks = (this.mating.blocks || 0) + 1;
    this.mating.lastBlockReason = reason || "Blocked by reproductive zone";
    this.lastBlockedReproduction = {
      reason: this.mating.lastBlockReason,
      parentA,
      parentB,
      spawn,
      tick: this.totals.ticks,
    };
  }

  recordEnergyStageTimings({
    segmentation = 0,
    density = 0,
    diffusion = 0,
    total = 0,
    tileCount = 0,
    strategy = "dirty-regions",
  } = {}) {
    if (!this.performance || typeof this.performance !== "object") {
      this.performance = {
        energy: {
          lastTiming: null,
          history: createHistoryRing(240),
        },
      };
    }

    if (!this.performance.energy) {
      this.performance.energy = {
        lastTiming: null,
        history: createHistoryRing(240),
      };
    }

    const bucket = this.performance.energy;

    if (!bucket.history || typeof bucket.history.push !== "function") {
      bucket.history = createHistoryRing(240);
    }

    const entry = {
      segmentation,
      density,
      diffusion,
      total,
      tileCount,
      strategy,
      timestamp: Date.now(),
    };

    bucket.lastTiming = entry;
    bucket.history.push(entry);
  }

  logEvent(event, multiplier = 1) {
    const s = event ? (event.strength || 0) * multiplier : 0;

    this.pushHistory("eventStrength", s);
  }

  getRecentLifeEvents(limit = 12) {
    if (!this.lifeEventLog) return [];

    const numericLimit = Math.floor(Number(limit));

    if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
      return [];
    }

    const values = this.lifeEventLog.values();

    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }

    const boundedLimit = Math.min(values.length, numericLimit);

    return values.slice(values.length - boundedLimit).reverse();
  }

  getLifeEventRateSummary(windowSize = LIFE_EVENT_RATE_DEFAULT_WINDOW) {
    if (!this.lifeEventLog) {
      return {
        births: 0,
        deaths: 0,
        net: 0,
        total: 0,
        window: 0,
        eventsPer100Ticks: 0,
        birthsPer100Ticks: 0,
        deathsPer100Ticks: 0,
      };
    }

    const numericWindow = Math.floor(Number(windowSize));

    if (!Number.isFinite(numericWindow) || numericWindow <= 0) {
      return {
        births: 0,
        deaths: 0,
        net: 0,
        total: 0,
        window: 0,
        eventsPer100Ticks: 0,
        birthsPer100Ticks: 0,
        deathsPer100Ticks: 0,
      };
    }

    const latestTick = Number.isFinite(this.totals?.ticks) ? this.totals.ticks : 0;
    const windowStart = Math.max(0, latestTick - numericWindow);
    const values = this.lifeEventLog.values();

    if (!Array.isArray(values) || values.length === 0) {
      return {
        births: 0,
        deaths: 0,
        net: 0,
        total: 0,
        window: Math.max(0, latestTick - windowStart),
        eventsPer100Ticks: 0,
        birthsPer100Ticks: 0,
        deathsPer100Ticks: 0,
      };
    }

    let births = 0;
    let deaths = 0;
    // Track event counts within the requested window so quiet stretches are
    // reflected in the per-100 tick rates.

    for (const event of values) {
      if (!event) continue;

      const tick = Number.isFinite(event.tick) ? event.tick : null;

      if (tick == null || tick < windowStart) {
        continue;
      }

      if (event.type === "birth") {
        births += 1;
      } else if (event.type === "death") {
        deaths += 1;
      }
    }

    const total = births + deaths;

    if (total === 0) {
      return {
        births: 0,
        deaths: 0,
        net: 0,
        total: 0,
        window: Math.max(0, latestTick - windowStart),
        eventsPer100Ticks: 0,
        birthsPer100Ticks: 0,
        deathsPer100Ticks: 0,
      };
    }

    const ticksObserved = Math.max(0, latestTick - windowStart);
    const normalizedSpan = Math.max(1, Math.min(numericWindow, ticksObserved || 1));

    const birthsPer100Ticks = (births / normalizedSpan) * 100;
    const deathsPer100Ticks = (deaths / normalizedSpan) * 100;

    return {
      births,
      deaths,
      net: births - deaths,
      total,
      window: normalizedSpan,
      eventsPer100Ticks: (total / normalizedSpan) * 100,
      birthsPer100Ticks,
      deathsPer100Ticks,
    };
  }

  setRandomGenerator(randomFn) {
    this.#rng = typeof randomFn === "function" ? randomFn : DEFAULT_RANDOM;
  }

  setMutationMultiplier(multiplier = 1) {
    const value = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;

    this.mutationMultiplier = value;
  }

  /**
   * Summarise per-trait participation across the provided cell population.
   * Returns population counts as well as normalised fractions for UI charts.
   * The tracked trait set reflects the definitions supplied to the constructor.
   */
  computeTraitPresence(cells = []) {
    const population = Array.isArray(cells) ? cells.length : 0;

    if (!population) return createEmptyTraitPresence(this.traitDefinitions);

    const sums = createTraitValueMap(this.traitDefinitions, 0);
    const activeCounts = createTraitValueMap(this.traitDefinitions, 0);

    for (let i = 0; i < population; i++) {
      const cell = cells[i];

      if (!cell) continue;

      for (let t = 0; t < this.traitDefinitions.length; t++) {
        const definition = this.traitDefinitions[t];
        const key = definition.key;
        const value = definition.compute(cell);

        sums[key] += value;
        if (value >= definition.threshold) {
          activeCounts[key] += 1;
        }
      }
    }

    const invPop = 1 / population;

    return {
      population,
      averages: createTraitValueMap(this.traitDefinitions, (key) => sums[key] * invPop),
      fractions: createTraitValueMap(
        this.traitDefinitions,
        (key) => activeCounts[key] * invPop,
      ),
      counts: createTraitValueMap(this.traitDefinitions, (key) => activeCounts[key]),
    };
  }

  pushHistory(key, value) {
    const ring = this.#historyRings?.[key];

    ring?.push(value);
  }

  pushTraitHistory(type, key, value) {
    const ring = this.#traitHistoryRings?.[type]?.[key];

    ring?.push(value);
  }

  getHistorySeries(key) {
    return this.#historyRings?.[key]?.values() ?? [];
  }

  getTraitHistorySeries(type, key) {
    return this.#traitHistoryRings?.[type]?.[key]?.values() ?? [];
  }
}
