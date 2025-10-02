import { TRAIT_ACTIVATION_THRESHOLD } from "./config.js";
import { clamp, clamp01, warnOnce } from "./utils.js";

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
  "eventStrength",
  "diversePairingRate",
  "meanDiversityAppetite",
  "mutationMultiplier",
];

const DIVERSITY_TARGET_DEFAULT = 0.35;
const DIVERSITY_PRESSURE_SMOOTHING = 0.85;

const LIFE_EVENT_LOG_CAPACITY = 240;

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

  if (!Number.isFinite(numeric)) {
    return clamp01(fallback);
  }

  return clamp01(numeric);
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
  /**
   * @param {number} [historySize=10000] Maximum retained history samples per series.
   * @param {{traitDefinitions?: Array<{key: string, compute?: Function, threshold?: number}>}} [options]
   *   Optional configuration allowing callers to extend or override tracked trait metrics.
   */
  constructor(historySize = 10000, options = {}) {
    this.historySize = historySize;
    const { traitDefinitions } = options ?? {};

    this.traitDefinitions = resolveTraitDefinitions(traitDefinitions);
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
    this.behavioralEvenness = 0;
    this.lifeEventLog = createHistoryRing(LIFE_EVENT_LOG_CAPACITY);
    this.lifeEventSequence = 0;

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

    this.traitPresence = createEmptyTraitPresence(this.traitDefinitions);
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

  resetAll() {
    this.resetTick();
    this.totals = { ticks: 0, births: 0, deaths: 0, fights: 0, cooperations: 0 };

    Object.values(this.#historyRings).forEach((ring) => ring?.clear?.());
    const traitPresenceRings = this.#traitHistoryRings?.presence ?? {};
    const traitAverageRings = this.#traitHistoryRings?.average ?? {};

    Object.values(traitPresenceRings).forEach((ring) => ring?.clear?.());
    Object.values(traitAverageRings).forEach((ring) => ring?.clear?.());

    this.traitPresence = createEmptyTraitPresence(this.traitDefinitions);
    this.diversityPressure = 0;
    this.behavioralEvenness = 0;
    this.meanBehaviorComplementarity = 0;
    this.successfulBehaviorComplementarity = 0;
    this.lifeEventLog = createHistoryRing(LIFE_EVENT_LOG_CAPACITY);
    this.lifeEventSequence = 0;
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

  getBehavioralEvenness() {
    const value = Number.isFinite(this.behavioralEvenness)
      ? this.behavioralEvenness
      : 0;

    return clamp01(value);
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

  #computeBehavioralEvenness(traitPresence) {
    const fractions = traitPresence?.fractions;

    if (!fractions || typeof fractions !== "object") {
      return 0;
    }

    const values = [];

    for (const raw of Object.values(fractions)) {
      if (!Number.isFinite(raw) || raw <= 0) continue;

      values.push(clamp01(raw));
    }

    if (values.length === 0) return 0;
    if (values.length === 1) return 0;

    const sum = values.reduce((acc, value) => acc + value, 0);

    if (!(sum > 0)) {
      return 0;
    }

    const invSum = 1 / sum;
    let entropy = 0;

    for (const value of values) {
      const probability = value * invSum;

      if (!(probability > 0)) continue;

      entropy -= probability * Math.log(probability);
    }

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

    let total = 0;
    let best = entries[0];

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      total += entry.value;
      if (entry.value > best.value) {
        best = entry;
      }
    }

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

    const row = Number.isFinite(safeContext.row)
      ? safeContext.row
      : Number.isFinite(resolvedCell?.row)
        ? resolvedCell.row
        : null;
    const col = Number.isFinite(safeContext.col)
      ? safeContext.col
      : Number.isFinite(resolvedCell?.col)
        ? resolvedCell.col
        : null;
    const energy = Number.isFinite(safeContext.energy)
      ? safeContext.energy
      : Number.isFinite(resolvedCell?.energy)
        ? resolvedCell.energy
        : null;
    const colorCandidate = safeContext.color;
    const color =
      typeof colorCandidate === "string" && colorCandidate.length > 0
        ? colorCandidate
        : typeof resolvedCell?.dna?.toColor === "function"
          ? resolvedCell.dna.toColor()
          : typeof resolvedCell?.color === "string"
            ? resolvedCell.color
            : null;
    const mutationMultiplier = Number.isFinite(safeContext.mutationMultiplier)
      ? safeContext.mutationMultiplier
      : null;
    const intensity = Number.isFinite(safeContext.intensity)
      ? safeContext.intensity
      : null;
    const winChance = Number.isFinite(safeContext.winChance)
      ? clamp01(safeContext.winChance)
      : null;
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

    const event = {
      id: ++this.lifeEventSequence,
      type,
      tick: this.totals.ticks,
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
    this.#recordLifeEvent("birth", primary, secondary);
  }
  onDeath(primary, secondary) {
    this.deaths++;
    this.totals.deaths++;
    this.#recordLifeEvent("death", primary, secondary);
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
    const populationSize = Array.isArray(cells) ? cells.length : 0;

    if (populationSize < 2) return 0;

    const possiblePairs = (populationSize * (populationSize - 1)) / 2;

    if (possiblePairs <= 0) {
      return 0;
    }

    if (possiblePairs <= maxPairSamples) {
      let sum = 0;
      let count = 0;

      for (let i = 0; i < populationSize - 1; i++) {
        const a = cells[i];

        if (!a || typeof a.dna?.similarity !== "function") {
          continue;
        }

        for (let j = i + 1; j < populationSize; j++) {
          const b = cells[j];

          if (!b || typeof b.dna?.similarity !== "function") {
            continue;
          }

          sum += 1 - a.dna.similarity(b.dna);
          count++;
        }
      }

      return count > 0 ? sum / count : 0;
    }

    const sampleGoal = Math.min(maxPairSamples, possiblePairs);
    const maxAttempts = sampleGoal * 8;
    let collected = 0;
    let sum = 0;
    let attempts = 0;

    while (collected < sampleGoal && attempts < maxAttempts) {
      const a = cells[(Math.random() * populationSize) | 0];
      const b = cells[(Math.random() * populationSize) | 0];

      attempts++;

      if (!a || !b || a === b) {
        continue;
      }

      if (
        typeof a.dna?.similarity !== "function" ||
        typeof b.dna?.similarity !== "function"
      ) {
        continue;
      }

      sum += 1 - a.dna.similarity(b.dna);
      collected++;
    }

    if (collected === 0) {
      return 0;
    }

    return sum / collected;
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
    const cells = Array.isArray(snapshot?.cells) ? snapshot.cells : [];
    const totalEnergy = Number.isFinite(snapshot?.totalEnergy)
      ? snapshot.totalEnergy
      : 0;
    const totalAge = Number.isFinite(snapshot?.totalAge) ? snapshot.totalAge : 0;
    const meanEnergy = pop > 0 ? totalEnergy / pop : 0;
    // Age is tracked in simulation ticks; convert with the active tick rate if seconds are needed.
    const meanAge = pop > 0 ? totalAge / pop : 0;
    const diversity = this.estimateDiversity(cells);

    this.#updateDiversityPressure(diversity);
    const traitPresence = this.computeTraitPresence(cells);
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
    this.behavioralEvenness = behaviorEvenness;
    this.meanBehaviorComplementarity = meanComplementarity;
    this.successfulBehaviorComplementarity = successfulComplementarity;
    for (const { key } of this.traitDefinitions) {
      this.pushTraitHistory("presence", key, traitPresence.fractions[key] ?? 0);
      this.pushTraitHistory("average", key, traitPresence.averages[key] ?? 0);
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
      meanBehaviorComplementarity: meanComplementarity,
      successfulBehaviorComplementarity: successfulComplementarity,
      behaviorEvenness,
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

    this.matingDiversityThreshold = clamp(numeric, 0, 1);
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
    threshold,
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

  getRecentLifeEvents(limit = 12) {
    if (!this.lifeEventLog) return [];

    const values = this.lifeEventLog.values();

    if (!Array.isArray(values) || values.length === 0) {
      return [];
    }

    const numericLimit = Number(limit);
    const clampedLimit = Number.isFinite(numericLimit)
      ? Math.max(0, Math.floor(numericLimit))
      : Math.max(0, Math.floor(12));

    if (clampedLimit === 0) {
      return [];
    }

    const trimmed =
      clampedLimit >= values.length ? values.slice() : values.slice(-clampedLimit);

    return trimmed.reverse();
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
