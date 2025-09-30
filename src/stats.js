import { clamp01 } from "./utils.js";

// Traits tracked for population presence/averages; keep aligned with UI labels.
const TRAIT_NAMES = ["cooperation", "fighting", "breeding", "sight"];
// Trait values >= threshold are considered "active" for presence stats.
const TRAIT_THRESHOLD = 0.6;
const MAX_REPRODUCTION_PROB = 0.8;
const MAX_SIGHT_RANGE = 5;

// History series that the Stats class exposes to UI charts.
const HISTORY_SERIES_KEYS = [
  "population",
  "diversity",
  "diversityPressure",
  "energy",
  "growth",
  "eventStrength",
  "diversePairingRate",
  "meanDiversityAppetite",
  "mutationMultiplier",
];

const DIVERSITY_TARGET_DEFAULT = 0.35;
const DIVERSITY_PRESSURE_SMOOTHING = 0.85;

const createTraitValueMap = (initializer) =>
  Object.fromEntries(
    TRAIT_NAMES.map((key) => [
      key,
      typeof initializer === "function" ? initializer(key) : initializer,
    ]),
  );

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

    const values = new Array(this.length);

    for (let i = 0; i < this.length; i++) {
      const index = (this.start + i) % this.capacity;

      values[i] = this.buffer[index];
    }

    return values;
  }
}

// Helper ensures ring construction is consistently clamped to integers.
const createHistoryRing = (size = 0) => new FixedSizeRingBuffer(size);

const createEmptyTraitPresence = () => ({
  population: 0,
  averages: createTraitValueMap(0),
  fractions: createTraitValueMap(0),
  counts: createTraitValueMap(0),
});

const clampInteractionTrait = (genes, key) => {
  const value = genes && typeof genes[key] === "number" ? genes[key] : 0;

  return clamp01(value);
};

const TRAIT_CALCULATORS = {
  cooperation: (cell) => clampInteractionTrait(cell?.interactionGenes, "cooperate"),
  fighting: (cell) => clampInteractionTrait(cell?.interactionGenes, "fight"),
  breeding: (cell) => {
    const probability =
      typeof cell?.dna?.reproductionProb === "function"
        ? cell.dna.reproductionProb()
        : 0;
    const normalized = probability > 0 ? probability / MAX_REPRODUCTION_PROB : 0;

    return clamp01(normalized);
  },
  sight: (cell) => {
    const sight = cell?.sight || 0;
    const normalized = sight > 0 ? sight / MAX_SIGHT_RANGE : 0;

    return clamp01(normalized);
  },
};

// Captures counters for the mating subsystem; reused to avoid churn.
const createEmptyMatingSnapshot = () => ({
  choices: 0,
  successes: 0,
  diverseChoices: 0,
  diverseSuccesses: 0,
  appetiteSum: 0,
  selectionModes: { curiosity: 0, preference: 0 },
  poolSizeSum: 0,
  blocks: 0,
  lastBlockReason: null,
});

/**
 * Aggregates per-tick simulation metrics and exposes rolling history series
 * for UI components. This class is intentionally stateful so the simulation
 * engine can reuse a single instance across ticks without reallocating rings.
 */
export default class Stats {
  #historyRings;
  #traitHistoryRings;
  constructor(historySize = 10000) {
    this.historySize = historySize;
    this.resetTick();
    this.history = {};
    this.#historyRings = {};
    this.totals = { ticks: 0, births: 0, deaths: 0, fights: 0, cooperations: 0 };
    this.traitHistory = { presence: {}, average: {} };
    this.#traitHistoryRings = { presence: {}, average: {} };
    this.matingDiversityThreshold = 0.45;
    this.lastMatingDebug = null;
    this.mutationMultiplier = 1;
    this.lastBlockedReproduction = null;
    this.diversityTarget = DIVERSITY_TARGET_DEFAULT;
    this.diversityPressure = 0;

    HISTORY_SERIES_KEYS.forEach((key) => {
      const ring = createHistoryRing(this.historySize);

      this.#historyRings[key] = ring;
      Object.defineProperty(this.history, key, {
        enumerable: true,
        configurable: false,
        get: () => ring.values(),
      });
    });

    for (let i = 0; i < TRAIT_NAMES.length; i++) {
      const key = TRAIT_NAMES[i];
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

    this.traitPresence = createEmptyTraitPresence();
  }

  resetTick() {
    this.births = 0;
    this.deaths = 0;
    this.fights = 0;
    this.cooperations = 0;
    this.mating = createEmptyMatingSnapshot();
    this.lastMatingDebug = null;
    this.lastBlockedReproduction = null;
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

  #updateDiversityPressure(observedDiversity = 0) {
    const target = clamp01(this.diversityTarget ?? DIVERSITY_TARGET_DEFAULT);

    if (target <= 0) {
      this.diversityPressure = 0;

      return;
    }

    const normalizedShortfall = clamp01((target - observedDiversity) / target);
    const prev = Number.isFinite(this.diversityPressure) ? this.diversityPressure : 0;
    const next =
      prev * DIVERSITY_PRESSURE_SMOOTHING +
      normalizedShortfall * (1 - DIVERSITY_PRESSURE_SMOOTHING);

    this.diversityPressure = clamp01(next);
  }

  onBirth() {
    this.births++;
    this.totals.births++;
  }
  onDeath() {
    this.deaths++;
    this.totals.deaths++;
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
  estimateDiversity(cells, maxPairSamples = 200) {
    const populationSize = cells.length;

    if (populationSize < 2) return 0;
    const possiblePairs = (populationSize * (populationSize - 1)) / 2;
    let sampleCount = Math.min(maxPairSamples, possiblePairs);
    let sum = 0;

    for (let i = 0; i < sampleCount; i++) {
      const a = cells[(Math.random() * populationSize) | 0];
      const b = cells[(Math.random() * populationSize) | 0];

      if (a === b) {
        i--;
        continue;
      }
      sum += 1 - a.dna.similarity(b.dna); // distance in [0,1]
    }

    return sum / sampleCount;
  }

  /**
   * Compute per-tick aggregates from the simulation snapshot and push the
   * derived values into rolling history buffers for charting.
   */
  updateFromSnapshot(snapshot) {
    this.totals.ticks++;
    const pop = snapshot?.population || 0;
    const cells = snapshot?.cells || [];
    const meanEnergy = pop ? snapshot.totalEnergy / pop : 0;
    const meanAge = pop ? snapshot.totalAge / pop : 0;
    const diversity = this.estimateDiversity(cells);

    this.#updateDiversityPressure(diversity);
    const traitPresence = this.computeTraitPresence(cells);
    const mateStats = this.mating || createEmptyMatingSnapshot();
    const choiceCount = mateStats.choices || 0;
    const successCount = mateStats.successes || 0;
    const diverseChoiceRate = choiceCount ? mateStats.diverseChoices / choiceCount : 0;
    const diverseSuccessRate = successCount
      ? mateStats.diverseSuccesses / successCount
      : 0;
    const meanAppetite = choiceCount ? mateStats.appetiteSum / choiceCount : 0;

    this.pushHistory("population", pop);
    this.pushHistory("diversity", diversity);
    this.pushHistory("diversityPressure", this.diversityPressure);
    this.pushHistory("energy", meanEnergy);
    this.pushHistory("growth", this.births - this.deaths);
    this.pushHistory("diversePairingRate", diverseChoiceRate);
    this.pushHistory("meanDiversityAppetite", meanAppetite);
    if (typeof this.mutationMultiplier === "number") {
      this.pushHistory("mutationMultiplier", this.mutationMultiplier);
    }

    this.traitPresence = traitPresence;
    for (let i = 0; i < TRAIT_NAMES.length; i++) {
      const key = TRAIT_NAMES[i];

      this.pushTraitHistory("presence", key, traitPresence.fractions[key]);
      this.pushTraitHistory("average", key, traitPresence.averages[key]);
    }

    return {
      population: pop,
      births: this.births,
      deaths: this.deaths,
      growth: this.births - this.deaths,
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
      curiositySelections: mateStats.selectionModes.curiosity,
      lastMating: this.lastMatingDebug,
      mutationMultiplier: this.mutationMultiplier,
      blockedMatings: mateStats.blocks || 0,
      lastBlockedReproduction: this.lastBlockedReproduction,
    };
  }

  setMatingDiversityThreshold(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return;

    this.matingDiversityThreshold = Math.min(Math.max(numeric, 0), 1);
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
  } = {}) {
    if (!this.mating) {
      this.mating = createEmptyMatingSnapshot();
    }

    const threshold = this.matingDiversityThreshold;
    const isDiverse = diversity >= threshold;

    this.mating.choices++;
    this.mating.appetiteSum += appetite || 0;
    this.mating.poolSizeSum += poolSize || 0;
    if (isDiverse) this.mating.diverseChoices++;
    if (selectionMode === "curiosity") this.mating.selectionModes.curiosity++;
    else this.mating.selectionModes.preference++;

    if (success) {
      this.mating.successes++;
      if (isDiverse) this.mating.diverseSuccesses++;
    }

    this.lastMatingDebug = {
      similarity,
      diversity,
      appetite,
      bias,
      selectionMode,
      poolSize,
      success,
      threshold,
      penalized,
      penaltyMultiplier,
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

  logEvent(event, multiplier = 1) {
    const s = event ? (event.strength || 0) * multiplier : 0;

    this.pushHistory("eventStrength", s);
  }

  setMutationMultiplier(multiplier = 1) {
    const value = Number.isFinite(multiplier) ? Math.max(0, multiplier) : 1;

    this.mutationMultiplier = value;
  }

  /**
   * Summarise per-trait participation across the provided cell population.
   * Returns population counts as well as normalised fractions for UI charts.
   */
  computeTraitPresence(cells = []) {
    const population = Array.isArray(cells) ? cells.length : 0;

    if (!population) return createEmptyTraitPresence();

    const sums = createTraitValueMap(0);
    const activeCounts = createTraitValueMap(0);

    for (let i = 0; i < population; i++) {
      const cell = cells[i];

      if (!cell) continue;

      for (let t = 0; t < TRAIT_NAMES.length; t++) {
        const key = TRAIT_NAMES[t];
        const value = TRAIT_CALCULATORS[key](cell);

        sums[key] += value;
        if (value >= TRAIT_THRESHOLD) {
          activeCounts[key] += 1;
        }
      }
    }

    const invPop = 1 / population;

    return {
      population,
      averages: createTraitValueMap((key) => sums[key] * invPop),
      fractions: createTraitValueMap((key) => activeCounts[key] * invPop),
      counts: createTraitValueMap((key) => activeCounts[key]),
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
