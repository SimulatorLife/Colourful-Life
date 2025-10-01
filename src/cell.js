import DNA from "./genome.js";
import Brain, { OUTPUT_GROUPS } from "./brain.js";
import { randomRange, clamp, lerp, cloneTracePayload, warnOnce } from "./utils.js";
import { isEventAffecting } from "./events/eventManager.js";
import { getEventEffect } from "./events/eventEffects.js";
import { accumulateEventModifiers } from "./energySystem.js";
import { MAX_TILE_ENERGY } from "./config.js";

const EPSILON = 1e-9;

function softmax(logits = []) {
  if (!Array.isArray(logits) || logits.length === 0) return [];

  const { length } = logits;
  // Manual loops avoid multiple temporary arrays that the previous implementation
  // created via spread/map/reduce inside per-tick decision hot paths.
  let maxLogit = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < length; i++) {
    const value = Number(logits[i]);

    if (Number.isNaN(value)) {
      maxLogit = NaN;
      break;
    }

    if (value > maxLogit) {
      maxLogit = value;
    }
  }

  const expValues = new Array(length);
  let sum = 0;

  if (Number.isNaN(maxLogit)) {
    for (let i = 0; i < length; i++) {
      expValues[i] = NaN;
    }
  } else {
    for (let i = 0; i < length; i++) {
      const expValue = Math.exp(Number(logits[i]) - maxLogit);

      expValues[i] = expValue;
      sum += expValue;
    }
  }

  if (!Number.isFinite(sum) || sum <= 0) {
    sum = 1;
  }

  const invSum = 1 / sum;

  for (let i = 0; i < length; i++) {
    expValues[i] *= invSum;
  }

  return expValues;
}

function sampleFromDistribution(probabilities = [], labels = [], rng = Math.random) {
  if (!Array.isArray(probabilities) || probabilities.length === 0) return null;
  const total = probabilities.reduce((acc, v) => acc + v, 0);

  if (!Number.isFinite(total) || total <= EPSILON) return null;
  const randomSource = typeof rng === "function" ? rng : Math.random;
  const r = randomSource() * total;
  let acc = 0;

  for (let i = 0; i < probabilities.length; i++) {
    acc += probabilities[i];

    if (r <= acc + EPSILON) return labels[i] ?? i;
  }

  return labels[labels.length - 1] ?? probabilities.length - 1;
}

export default class Cell {
  static chanceToMutate = 0.15;
  static geneMutationRange = 0.2;

  constructor(row, col, dna, energy) {
    this.row = row;
    this.col = col;
    this.dna = dna || DNA.random();
    this.brain = Brain.fromDNA(this.dna);
    this.genes = this.dna.weights();
    this.color = this.dna.toColor();
    this.age = 0;
    this.lifespan = this.dna.lifespanDNA();
    this.sight = this.dna.sight();
    this.energy = energy;
    this.neurons = this.brain?.neuronCount || this.dna.neurons();
    this.strategy = this.dna.strategy();
    this.movementGenes = this.dna.movementGenes();
    this.interactionGenes = this.dna.interactionGenes();
    this.density = this.dna.densityResponses();
    this.baseCrowdingTolerance = clamp(
      typeof this.dna.forageCrowdingTolerance === "function"
        ? this.dna.forageCrowdingTolerance()
        : 0.5,
      0,
      1,
    );
    this._crowdingTolerance = this.baseCrowdingTolerance;
    this.baseRiskTolerance = clamp(
      typeof this.dna.riskTolerance === "function" ? this.dna.riskTolerance() : 0.5,
      0,
      1,
    );
    this.neuralFatigueProfile =
      typeof this.dna.neuralFatigueProfile === "function"
        ? this.dna.neuralFatigueProfile()
        : null;
    this.neuralPlasticityProfile =
      typeof this.dna.neuralPlasticityProfile === "function"
        ? this.dna.neuralPlasticityProfile()
        : null;
    this.neuralReinforcementProfile =
      typeof this.dna.neuralReinforcementProfile === "function"
        ? this.dna.neuralReinforcementProfile()
        : null;
    this.fitnessScore = null;
    this.matePreferenceBias =
      typeof this.dna.mateSimilarityBias === "function"
        ? this.dna.mateSimilarityBias()
        : 0;
    this.diversityAppetite =
      typeof this.dna.diversityAppetite === "function"
        ? this.dna.diversityAppetite()
        : 0;
    this.mateSamplingProfile =
      typeof this.dna.mateSamplingProfile === "function"
        ? this.dna.mateSamplingProfile()
        : null;
    this.riskMemoryProfile =
      typeof this.dna.riskMemoryProfile === "function"
        ? this.dna.riskMemoryProfile()
        : null;
    this._rngCache = new Map();
    this._sharedRngCache = new Map();
    this._mateSelectionNoiseRng = this.resolveRng("mateSelectionNoise");
    this._neuralLoad = 0;
    this.lastEventPressure = 0;
    this._usedNeuralMovement = false;
    this.decisionHistory = [];
    this._pendingDecisionContexts = [];
    this._decisionContextIndex = new Map();
    this._riskMemory = {
      resource: 0,
      event: 0,
      social: 0,
      fatigue: 0,
      confidence: 0,
    };
    this.resourceTrendAdaptation =
      typeof this.dna.resourceTrendAdaptation === "function"
        ? this.dna.resourceTrendAdaptation()
        : 0.35;
    const initialResourceLevel = clamp((energy ?? 0) / (MAX_TILE_ENERGY || 1), 0, 1);

    this._resourceBaseline = initialResourceLevel;
    this._resourceDelta = 0;
    this._resourceSignal = 0;
    this._resourceSignalLastInput = { energy: initialResourceLevel, delta: 0 };
    const baselineFatigue = clamp(
      Number.isFinite(this.neuralFatigueProfile?.baseline)
        ? this.neuralFatigueProfile.baseline
        : 0.35,
      0,
      1,
    );

    this._neuralFatigue = baselineFatigue;
    this._neuralEnergyReserve = initialResourceLevel;
    this._neuralFatigueSnapshot = null;
    this._pendingRestRecovery = 0;
    const interactionProfile =
      typeof this.dna.interactionPlasticity === "function"
        ? this.dna.interactionPlasticity()
        : null;

    this._interactionBaseline = clamp(interactionProfile?.baseline ?? 0, -1, 1);
    this._interactionMomentum = this._interactionBaseline;
    this._interactionLearning = clamp(
      interactionProfile?.learningRate ?? 0.35,
      0.05,
      0.95,
    );
    this._interactionVolatility = clamp(interactionProfile?.volatility ?? 0.5, 0.05, 2);
    this._interactionDecay = clamp(interactionProfile?.decay ?? 0.08, 0.001, 0.6);
    this._lastInteractionDecayAge = this.age;
    this._lastInteractionSummary = null;
    // Cache metabolism profile once; combine DNA-driven baseline with neural imprint
    const geneRow = this.genes?.[5];
    const neuralSignature = Array.isArray(geneRow)
      ? geneRow.reduce((sum, weight) => sum + Math.abs(weight), 0) /
        (geneRow.length || 1)
      : Math.abs(Number(geneRow) || 0);
    const dnaMetabolismProfile =
      typeof this.dna.metabolicProfile === "function"
        ? this.dna.metabolicProfile()
        : null;
    const baselineMetabolism = clamp(
      Number.isFinite(dnaMetabolismProfile?.baseline)
        ? dnaMetabolismProfile.baseline
        : 0.35 + neuralSignature * 0.3,
      0.05,
      2.5,
    );
    const neuralDrag = clamp(
      Number.isFinite(dnaMetabolismProfile?.neuralDrag)
        ? dnaMetabolismProfile.neuralDrag
        : 0.35,
      0.05,
      1.5,
    );

    this.metabolicCrowdingTax = clamp(
      Number.isFinite(dnaMetabolismProfile?.crowdingTax)
        ? dnaMetabolismProfile.crowdingTax
        : 0.35,
      0,
      2,
    );
    this.metabolism = clamp(
      baselineMetabolism + neuralSignature * neuralDrag * 0.5,
      0.05,
      3,
    );
    this.metabolicProfile = {
      baseline: baselineMetabolism,
      neuralDrag,
      crowdingTax: this.metabolicCrowdingTax,
      neuralSignature,
    };
    this.offspring = 0;
    this.fightsWon = 0;
    this.fightsLost = 0;
    this.matingAttempts = 0;
    this.matingSuccesses = 0;
    this.diverseMateScore = 0;
    this.similarityPenalty = 0;
  }

  static breed(parentA, parentB, mutationMultiplier = 1, options = {}) {
    const { maxTileEnergy } = options || {};
    const row = parentA.row;
    const col = parentA.col;
    const avgChance = (parentA.dna.mutationChance() + parentB.dna.mutationChance()) / 2;
    const avgRange = (parentA.dna.mutationRange() + parentB.dna.mutationRange()) / 2;
    const safeMultiplier = Number.isFinite(mutationMultiplier) ? mutationMultiplier : 1;
    const effectiveMultiplier = Math.max(0, safeMultiplier);
    const chance = Math.max(0, avgChance * effectiveMultiplier);
    const range = Math.max(0, Math.round(avgRange * effectiveMultiplier));
    const crossoverRng =
      typeof parentA.resolveSharedRng === "function"
        ? parentA.resolveSharedRng(parentB, "offspringGenome")
        : null;
    const childDNA = parentA.dna.reproduceWith(
      parentB.dna,
      chance,
      range,
      crossoverRng,
    );
    const resolvedMaxTileEnergy =
      typeof maxTileEnergy === "number"
        ? maxTileEnergy
        : typeof window !== "undefined" && window.GridManager?.maxTileEnergy != null
          ? window.GridManager.maxTileEnergy
          : MAX_TILE_ENERGY;
    const calculateInvestment = (parent, starvation) => {
      const fracFn = parent.dna?.parentalInvestmentFrac;
      const investFrac = typeof fracFn === "function" ? fracFn.call(parent.dna) : 0.4;
      const desired = Math.max(0, Math.min(parent.energy, parent.energy * investFrac));
      const maxSpend = Math.max(0, parent.energy - starvation);

      return Math.min(desired, maxSpend);
    };
    const starvationA = parentA.starvationThreshold(resolvedMaxTileEnergy);
    const starvationB = parentB.starvationThreshold(resolvedMaxTileEnergy);
    const investA = calculateInvestment(parentA, starvationA);
    const investB = calculateInvestment(parentB, starvationB);

    if (investA <= 0 || investB <= 0) return null;

    parentA.energy = Math.max(0, parentA.energy - investA);
    parentB.energy = Math.max(0, parentB.energy - investB);

    const offspringEnergy = investA + investB;
    const offspring = new Cell(row, col, childDNA, offspringEnergy);
    const parentStrategies = [];

    if (Number.isFinite(parentA.strategy)) parentStrategies.push(parentA.strategy);
    if (Number.isFinite(parentB.strategy)) parentStrategies.push(parentB.strategy);

    if (typeof childDNA?.inheritStrategy === "function") {
      const inherited = childDNA.inheritStrategy(parentStrategies, {
        fallback: offspring.strategy,
      });

      if (Number.isFinite(inherited)) {
        offspring.strategy = clamp(inherited, 0, 1);
      }
    } else if (parentStrategies.length > 0) {
      const avg =
        parentStrategies.reduce((sum, value) => sum + value, 0) /
        parentStrategies.length;

      offspring.strategy = clamp(avg, 0, 1);
    }
    parentA.offspring = (parentA.offspring || 0) + 1;
    parentB.offspring = (parentB.offspring || 0) + 1;

    return offspring;
  }

  similarityTo(other) {
    return this.dna.similarity(other.dna);
  }

  // Lifespan is fully DNA-dictated via genome.lifespanDNA()

  evaluateMateCandidate(mate = {}) {
    const target = mate?.target;

    if (!target) return null;

    const similarityCandidate = mate?.precomputedSimilarity;
    const similarity = Number.isFinite(similarityCandidate)
      ? similarityCandidate
      : this.#safeSimilarityTo(target, {
          context: "mate candidate evaluation",
          fallback: 0,
        });
    const diversity = 1 - similarity;
    const bias = this.matePreferenceBias ?? 0;
    const appetite = this.diversityAppetite ?? 0;
    const similarPull = similarity * (1 + Math.max(0, bias));
    const diversePull = diversity * (1 + Math.max(0, -bias) + appetite);
    const curiosityBonus = diversity * appetite * 0.5;
    const preferenceScore = similarPull + diversePull + curiosityBonus;

    const samplingProfile = this.mateSamplingProfile || {};
    const weightScale = clamp(
      Number.isFinite(samplingProfile?.preferenceSoftening)
        ? samplingProfile.preferenceSoftening
        : 1,
      0.05,
      4,
    );
    const noveltyWeight = clamp(
      Number.isFinite(samplingProfile?.noveltyWeight)
        ? samplingProfile.noveltyWeight
        : 0,
      -1,
      1,
    );
    const jitterAmplitude = clamp(
      Number.isFinite(samplingProfile?.selectionJitter)
        ? samplingProfile.selectionJitter
        : 0,
      0,
      1,
    );
    const randomSource =
      typeof this._mateSelectionNoiseRng === "function"
        ? this._mateSelectionNoiseRng
        : this.resolveRng("mateSelectionNoise");
    const jitter = jitterAmplitude > 0 ? (randomSource() - 0.5) * jitterAmplitude : 0;
    const weighted = preferenceScore * weightScale + diversity * noveltyWeight + jitter;
    const selectionWeight = Math.max(0.0001, weighted);

    mate.similarity = similarity;
    mate.diversity = diversity;
    mate.appetite = appetite;
    mate.mateBias = bias;
    mate.curiosityBonus = curiosityBonus;
    mate.preferenceScore = preferenceScore;
    mate.selectionWeight = selectionWeight;

    return mate;
  }

  scorePotentialMates(potentialMates = []) {
    const scored = [];

    for (let i = 0; i < potentialMates.length; i++) {
      const mate = potentialMates[i];

      if (!mate?.target) continue;
      if (
        typeof mate.preferenceScore === "number" &&
        typeof mate.selectionWeight === "number" &&
        typeof mate.similarity === "number"
      ) {
        scored.push(mate);
        continue;
      }

      const evaluated = this.evaluateMateCandidate(mate);

      if (evaluated) scored.push(evaluated);
    }

    return scored;
  }

  selectMateWeighted(potentialMates = []) {
    const evaluated = this.scorePotentialMates(potentialMates).filter(
      (m) => m && m.selectionWeight > 0 && m.target,
    );

    if (evaluated.length === 0) return { chosen: null, evaluated: [], mode: "none" };

    const appetite = clamp(this.diversityAppetite ?? 0, 0, 1);
    const samplingProfile = this.mateSamplingProfile || {};

    if (typeof this._mateSelectionNoiseRng !== "function") {
      this._mateSelectionNoiseRng = this.resolveRng("mateSelectionNoise");
    }
    const randomSample = this._mateSelectionNoiseRng;
    let mode = "preference";
    let chosen = null;

    const curiosityBase = Math.min(0.5, appetite * 0.25);
    const profileCuriosity = samplingProfile?.curiosityChance;
    const curiosityChance = clamp(
      (profileCuriosity ?? curiosityBase) * (0.7 + appetite * 0.6),
      0,
      0.95,
    );

    if (evaluated.length > 1 && randomSample() < curiosityChance) {
      const sorted = [...evaluated].sort((a, b) => b.diversity - a.diversity);
      const tailBase = clamp(0.2 + appetite * 0.5, 0.05, 1);
      const tailFraction = clamp(samplingProfile?.tailFraction ?? tailBase, 0.05, 1);
      const tailSpan = Math.max(1, Math.ceil(sorted.length * tailFraction));
      const idx = Math.min(sorted.length - 1, Math.floor(randomSample() * tailSpan));

      chosen = sorted[idx];
      mode = "curiosity";
    }

    if (!chosen) {
      const totalWeight = evaluated.reduce(
        (sum, m) =>
          sum +
          (Number.isFinite(m.selectionWeight) ? Math.max(0, m.selectionWeight) : 0),
        0,
      );
      const safeTotal = totalWeight > 0 ? totalWeight : 1;
      let roll = randomSample() * safeTotal;

      for (let i = 0; i < evaluated.length; i++) {
        const candidate = evaluated[i];
        const weight = Math.max(0, candidate.selectionWeight);

        roll -= weight;
        if (roll <= 0) {
          chosen = candidate;
          break;
        }
      }

      if (!chosen) chosen = evaluated[evaluated.length - 1];
    }

    return { chosen, evaluated, mode };
  }

  #fallbackMateSelection(potentialMates = []) {
    const pref = this.dna?.mateSimilarityPreference?.() ?? {};
    const target = clamp(pref.target ?? 0.75, 0, 1);
    const tolerance = Math.max(0.05, pref.tolerance ?? 0.25);
    const kinBias = clamp(pref.kinBias ?? 0.5, 0, 1);
    const samplingProfile = this.mateSamplingProfile || {};
    const noveltyBias = clamp(
      Number.isFinite(samplingProfile?.fallbackNoveltyBias)
        ? samplingProfile.fallbackNoveltyBias
        : 0,
      -1,
      1,
    );
    const stabilityWeight = clamp(
      Number.isFinite(samplingProfile?.fallbackStabilityWeight)
        ? samplingProfile.fallbackStabilityWeight
        : 0.5,
      0,
      1,
    );
    const noiseAmplitude = clamp(
      Number.isFinite(samplingProfile?.fallbackNoise)
        ? samplingProfile.fallbackNoise
        : Number.isFinite(samplingProfile?.selectionJitter)
          ? samplingProfile.selectionJitter
          : 0.05,
      0,
      0.6,
    );
    const noiseSource =
      typeof this._mateSelectionNoiseRng === "function"
        ? this._mateSelectionNoiseRng
        : this.resolveRng("mateChoice");
    const fallbackNoise = this.resolveRng("fallbackMateNoise");

    let fallbackMate = null;
    let bestScore = -Infinity;

    for (const mate of potentialMates) {
      if (!mate?.target) continue;

      const similarity = this.#safeSimilarityTo(mate.target, {
        context: "fallback mate selection scoring",
        fallback: Number.NaN,
      });

      if (!Number.isFinite(similarity)) continue;
      const diff = Math.abs(similarity - target);
      const targetScore = Math.max(0, 1 - diff / tolerance);
      const kinScore = similarity;
      let score = (1 - kinBias) * targetScore + kinBias * kinScore;

      score = score * (1 - stabilityWeight) + kinScore * stabilityWeight;
      score += (1 - similarity) * noveltyBias;

      if (noiseAmplitude > 0) {
        const noiseFn = typeof noiseSource === "function" ? noiseSource : fallbackNoise;

        score += (noiseFn() - 0.5) * noiseAmplitude;
      }

      if (score > bestScore) {
        bestScore = score;
        fallbackMate = mate;
      }
    }

    return fallbackMate;
  }

  #selectHighestPreferenceMate(scored = []) {
    let bestMate = null;
    let highestPreference = -Infinity;

    for (const mate of scored) {
      if (!mate) continue;

      if (mate.preferenceScore > highestPreference) {
        highestPreference = mate.preferenceScore;
        bestMate = mate;
      }
    }

    return bestMate;
  }

  findBestMate(potentialMates) {
    if (!Array.isArray(potentialMates) || potentialMates.length === 0) return null;

    const scored = this.scorePotentialMates(potentialMates);

    if (scored.length === 0) {
      return this.#fallbackMateSelection(potentialMates);
    }

    return this.#selectHighestPreferenceMate(scored);
  }

  recordMatingOutcome({
    diversity = 0,
    success = false,
    penalized = false,
    penaltyMultiplier = 1,
  } = {}) {
    this.matingAttempts = (this.matingAttempts || 0) + 1;

    if (success) {
      this.matingSuccesses = (this.matingSuccesses || 0) + 1;
      this.diverseMateScore =
        (this.diverseMateScore || 0) + clamp(diversity ?? 0, 0, 1);
    }

    if (penalized) {
      const penalty = clamp(1 - (penaltyMultiplier ?? 1), 0, 1);

      this.similarityPenalty = (this.similarityPenalty || 0) + penalty;
    }
  }

  // Internal: nearest target utility
  #nearest(list, row, col) {
    if (!list || list.length === 0) return null;
    let best = null;
    let bestDist = Infinity;

    for (const t of list) {
      const d = Math.max(Math.abs(t.row - row), Math.abs(t.col - col));

      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }

    return best;
  }

  #canUseNeuralPolicies() {
    return Boolean(this.brain && this.brain.connectionCount > 0);
  }

  #registerDecisionContext(group, sensors, evaluation, activationLoad = 0) {
    if (!evaluation) return null;

    const safeSensors =
      sensors && typeof sensors === "object" && !Array.isArray(sensors)
        ? Object.fromEntries(
            Object.entries(sensors).map(([key, value]) => [key, Number(value) || 0]),
          )
        : null;
    const sensorVector = Array.isArray(evaluation.sensors)
      ? evaluation.sensors.map((value) => (Number.isFinite(value) ? value : 0))
      : null;
    const activationCount = Math.max(
      0,
      activationLoad || evaluation.activationCount || 0,
    );
    const context = {
      tick: this.age,
      group,
      sensors: safeSensors,
      sensorVector,
      outputs: evaluation.values ? { ...evaluation.values } : null,
      activationCount,
      trace: evaluation.trace ? cloneTracePayload(evaluation.trace) : null,
      outcome: null,
    };

    this._pendingDecisionContexts.push(context);
    this._decisionContextIndex.set(group, context);

    return context;
  }

  #assignDecisionOutcome(group, outcome) {
    if (!this._decisionContextIndex?.has(group)) return;

    const context = this._decisionContextIndex.get(group);

    if (!context) return;

    if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
      const existing =
        context.outcome &&
        typeof context.outcome === "object" &&
        !Array.isArray(context.outcome)
          ? context.outcome
          : {};

      context.outcome = { ...existing, ...outcome };
    } else {
      context.outcome = outcome ?? null;
    }
  }

  #getDecisionOutcome(group) {
    if (!this._decisionContextIndex?.has(group)) return null;

    const context = this._decisionContextIndex.get(group);

    if (!context) return null;

    const { outcome } = context;

    if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) {
      return null;
    }

    return outcome;
  }

  #resolveDecisionReward(
    decision,
    {
      energyBefore = this.energy,
      energyAfter = this.energy,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = {},
  ) {
    const profile = this.neuralReinforcementProfile;

    if (!profile || !decision || typeof decision !== "object") return null;

    const outcome = decision.outcome;

    if (!outcome || typeof outcome !== "object") return null;

    const capacity = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const normalizedEnergyDelta = clamp(
      ((Number.isFinite(energyAfter) ? energyAfter : 0) -
        (Number.isFinite(energyBefore) ? energyBefore : 0)) /
        capacity,
      -1,
      1,
    );
    const cognitiveCost = clamp(
      Number.isFinite(decision.energyImpact?.cognitive)
        ? decision.energyImpact.cognitive / capacity
        : 0,
      0,
      2,
    );
    const fatigueBefore = decision.neuralFatigue?.before;
    const fatigueAfter = decision.neuralFatigue?.after;
    const fatigueDelta = clamp(
      Number.isFinite(fatigueBefore) && Number.isFinite(fatigueAfter)
        ? fatigueBefore - fatigueAfter
        : 0,
      -1,
      1,
    );

    let reward =
      normalizedEnergyDelta * (profile.energyDeltaWeight ?? 0) -
      cognitiveCost * (profile.cognitiveCostWeight ?? 0) +
      fatigueDelta * (profile.fatigueReliefWeight ?? 0);

    const sensors = decision.sensors || {};
    const group = decision.group;

    if (group === "movement") {
      const action = outcome.action;

      if (action && profile.movementActions) {
        const pref = profile.movementActions[action];

        if (Number.isFinite(pref)) {
          reward += (pref - 0.2) * (profile.movementAlignmentWeight ?? 0);
        }
      }

      if (Number.isFinite(outcome.restBoost)) {
        reward += outcome.restBoost * (profile.restBoostWeight ?? 0);
      }
    } else if (group === "interaction") {
      const action = outcome.action;

      if (action && profile.interactionActions) {
        const pref = profile.interactionActions[action];

        if (Number.isFinite(pref)) {
          reward += (pref - 1 / 3) * (profile.interactionAlignmentWeight ?? 0);
        }
      }
    } else if (group === "reproduction") {
      const probability = clamp(outcome.probability ?? 0, 0, 1);
      const baseProbability = clamp(
        outcome.baseProbability ?? sensors.baseReproductionProbability ?? 0,
        0,
        1,
      );

      reward += (probability - baseProbability) * (profile.reproductionWeight ?? 0);
    } else if (group === "targeting") {
      const chosen = outcome.chosen;

      if (chosen && profile.targetingFocus) {
        const baseline = 0.25;
        const ourEnergy = Number.isFinite(energyBefore)
          ? energyBefore
          : (this.energy ?? 0);
        const enemyEnergy = Number.isFinite(chosen.energy) ? chosen.energy : ourEnergy;
        const weakSignal = clamp((ourEnergy - enemyEnergy) / capacity, -1, 1);
        const strongSignal = -weakSignal;
        const proximitySignal =
          chosen.distance != null && Number.isFinite(chosen.distance)
            ? clamp(1 - Math.min(chosen.distance, 6) / 6, 0, 1) * 2 - 1
            : 0;
        const attritionSignal =
          chosen.attrition != null && Number.isFinite(chosen.attrition)
            ? clamp(chosen.attrition * 2 - 1, -1, 1)
            : 0;
        const alignment = profile.targetingAlignmentWeight ?? 0;

        reward +=
          (clamp(profile.targetingFocus.weak ?? baseline, 0, 1) - baseline) *
          weakSignal *
          alignment;
        reward +=
          (clamp(profile.targetingFocus.strong ?? baseline, 0, 1) - baseline) *
          strongSignal *
          alignment;
        reward +=
          (clamp(profile.targetingFocus.proximity ?? baseline, 0, 1) - baseline) *
          proximitySignal *
          alignment;
        reward +=
          (clamp(profile.targetingFocus.attrition ?? baseline, 0, 1) - baseline) *
          attritionSignal *
          alignment;
      }
    }

    if (!Number.isFinite(reward)) return null;

    return clamp(reward, -1.25, 1.25);
  }

  #finalizeDecisionContexts({
    energyBefore = this.energy,
    energyAfter = this.energy,
    energyLoss = 0,
    cognitiveLoss = 0,
    baselineCost = cognitiveLoss,
    dynamicCost = 0,
    dynamicLoad = 0,
    totalLoss = energyLoss + cognitiveLoss,
    baselineNeurons = Math.max(0, this.neurons || 0),
    neuralFatigueSnapshot = this._neuralFatigueSnapshot ?? null,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const pending = Array.isArray(this._pendingDecisionContexts)
      ? this._pendingDecisionContexts
      : [];

    if (pending.length === 0) {
      this._pendingDecisionContexts = [];
      this._decisionContextIndex.clear();

      return;
    }

    const perActivationCost = dynamicLoad > 0 ? dynamicCost / dynamicLoad : 0;
    const baselineShare = pending.length > 0 ? baselineCost / pending.length : 0;

    const decisions = pending.map((context) => {
      const activationCount = Math.max(0, context.activationCount || 0);
      const dynamicShare = activationCount * perActivationCost;
      const normalizedOutcome =
        context.outcome &&
        typeof context.outcome === "object" &&
        !Array.isArray(context.outcome)
          ? { ...context.outcome }
          : (context.outcome ?? null);

      return {
        tick: context.tick,
        group: context.group,
        sensors: context.sensors ? { ...context.sensors } : null,
        sensorVector: Array.isArray(context.sensorVector)
          ? [...context.sensorVector]
          : null,
        outputs: context.outputs ? { ...context.outputs } : null,
        activationCount,
        trace: cloneTracePayload(context.trace),
        outcome: normalizedOutcome,
        energyImpact: {
          baseline: baselineShare,
          dynamic: dynamicShare,
          cognitive: baselineShare + dynamicShare,
          totalLoss,
        },
        neuralFatigue:
          neuralFatigueSnapshot && typeof neuralFatigueSnapshot === "object"
            ? {
                before: Number.isFinite(neuralFatigueSnapshot.before)
                  ? neuralFatigueSnapshot.before
                  : null,
                after: Number.isFinite(neuralFatigueSnapshot.after)
                  ? neuralFatigueSnapshot.after
                  : null,
                loadPressure: Number.isFinite(neuralFatigueSnapshot.loadPressure)
                  ? neuralFatigueSnapshot.loadPressure
                  : null,
                energyPressure: Number.isFinite(neuralFatigueSnapshot.energyPressure)
                  ? neuralFatigueSnapshot.energyPressure
                  : null,
                densityPressure: Number.isFinite(neuralFatigueSnapshot.densityPressure)
                  ? neuralFatigueSnapshot.densityPressure
                  : null,
                combinedStress: Number.isFinite(neuralFatigueSnapshot.combinedStress)
                  ? neuralFatigueSnapshot.combinedStress
                  : null,
                recoveryApplied: Number.isFinite(neuralFatigueSnapshot.recoveryApplied)
                  ? neuralFatigueSnapshot.recoveryApplied
                  : null,
                restBaseRecovery: Number.isFinite(
                  neuralFatigueSnapshot.restBaseRecovery,
                )
                  ? neuralFatigueSnapshot.restBaseRecovery
                  : null,
                restBonusApplied: Number.isFinite(
                  neuralFatigueSnapshot.restBonusApplied,
                )
                  ? neuralFatigueSnapshot.restBonusApplied
                  : null,
                restBoostCarry: Number.isFinite(neuralFatigueSnapshot.restBoostCarry)
                  ? neuralFatigueSnapshot.restBoostCarry
                  : null,
                restSupport: Number.isFinite(neuralFatigueSnapshot.restSupport)
                  ? neuralFatigueSnapshot.restSupport
                  : null,
                energyReserveBefore: Number.isFinite(
                  neuralFatigueSnapshot.energyReserveBefore,
                )
                  ? neuralFatigueSnapshot.energyReserveBefore
                  : null,
                energyReserveAfter: Number.isFinite(
                  neuralFatigueSnapshot.energyReserveAfter,
                )
                  ? neuralFatigueSnapshot.energyReserveAfter
                  : null,
              }
            : null,
      };
    });

    const rewardContext = {
      energyBefore,
      energyAfter,
      maxTileEnergy,
    };

    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];

      if (!decision?.outcome || typeof decision.outcome !== "object") continue;

      const rewardSignal = this.#resolveDecisionReward(decision, rewardContext);

      if (Number.isFinite(rewardSignal)) {
        decision.outcome.rewardSignal = clamp(rewardSignal, -1, 1);
      }
    }

    if (this.brain && typeof this.brain.applySensorFeedback === "function") {
      for (let i = 0; i < decisions.length; i++) {
        const decision = decisions[i];

        if (!decision?.sensorVector) continue;

        const energyCost = Number.isFinite(decision.energyImpact?.cognitive)
          ? decision.energyImpact.cognitive
          : 0;
        const fatigueBefore = decision.neuralFatigue?.before;
        const fatigueAfter = decision.neuralFatigue?.after;
        const fatigueDelta =
          Number.isFinite(fatigueBefore) && Number.isFinite(fatigueAfter)
            ? fatigueBefore - fatigueAfter
            : 0;
        const rewardSignal = Number.isFinite(decision.outcome?.rewardSignal)
          ? clamp(decision.outcome.rewardSignal, -1, 1)
          : 0;

        this.brain.applySensorFeedback({
          group: decision.group,
          sensorVector: decision.sensorVector,
          activationCount: decision.activationCount,
          energyCost,
          fatigueDelta,
          rewardSignal,
          maxTileEnergy,
        });
      }
    }

    const record = {
      tick: this.age,
      energyBefore,
      energyAfter,
      totalLoss,
      energyLoss,
      cognitiveLoss,
      baselineCost,
      dynamicCost,
      dynamicLoad,
      baselineNeurons,
      usageCostPerActivation: perActivationCost,
      decisions,
    };

    this.decisionHistory.push(record);

    const historyLimit = 20;

    if (this.decisionHistory.length > historyLimit) {
      this.decisionHistory.splice(0, this.decisionHistory.length - historyLimit);
    }

    this._pendingDecisionContexts = [];
    this._decisionContextIndex.clear();
  }

  #currentNeuralFatigue() {
    const baseline = clamp(
      Number.isFinite(this.neuralFatigueProfile?.baseline)
        ? this.neuralFatigueProfile.baseline
        : 0.35,
      0,
      1,
    );

    if (!Number.isFinite(this._neuralFatigue)) {
      return baseline;
    }

    return clamp(this._neuralFatigue, 0, 1);
  }

  #currentNeuralEnergyReserve() {
    if (Number.isFinite(this._neuralEnergyReserve)) {
      return clamp(this._neuralEnergyReserve, 0, 1);
    }

    return clamp((this.energy ?? 0) / (MAX_TILE_ENERGY || 1), 0, 1);
  }

  #updateNeuralFatigueState({
    dynamicLoad = 0,
    baselineNeurons = 0,
    cognitiveLoss = 0,
    effectiveDensity = 0,
    energyBefore = this.energy,
    energyAfter = this.energy,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const profile = this.neuralFatigueProfile || {};
    const baseline = clamp(
      Number.isFinite(profile.baseline) ? profile.baseline : 0.35,
      0,
      1,
    );
    const loadCapacity = clamp(
      Number.isFinite(profile.loadCapacity) ? profile.loadCapacity : 1,
      0.2,
      2.5,
    );
    const stressGain = clamp(
      Number.isFinite(profile.stressGain) ? profile.stressGain : 0.35,
      0.05,
      0.95,
    );
    const recoveryRate = clamp(
      Number.isFinite(profile.recoveryRate) ? profile.recoveryRate : 0.25,
      0.01,
      1,
    );
    const densitySensitivity = clamp(
      Number.isFinite(profile.densitySensitivity) ? profile.densitySensitivity : 0.4,
      0,
      1.2,
    );
    const restThreshold = clamp(
      Number.isFinite(profile.restThreshold) ? profile.restThreshold : 0.45,
      0,
      1,
    );
    const restEfficiency = clamp(
      Number.isFinite(profile.restEfficiency) ? profile.restEfficiency : 0.45,
      0,
      1.5,
    );
    const pendingRestBoost = clamp(
      Number.isFinite(this._pendingRestRecovery) ? this._pendingRestRecovery : 0,
      0,
      3,
    );

    this._pendingRestRecovery = 0;

    const maxEnergy = Number.isFinite(maxTileEnergy)
      ? Math.max(0.1, maxTileEnergy)
      : MAX_TILE_ENERGY;
    const denominator = maxEnergy || 1;
    const energyBeforeFrac = clamp(
      Number.isFinite(energyBefore)
        ? energyBefore / denominator
        : this.#currentNeuralEnergyReserve(),
      0,
      1,
    );
    const energyAfterFrac = clamp(
      Number.isFinite(energyAfter) ? energyAfter / denominator : energyBeforeFrac,
      0,
      1,
    );
    const energyDrop = Math.max(0, energyBeforeFrac - energyAfterFrac);
    const baseNeurons = Math.max(1, Math.max(0, baselineNeurons || this.neurons || 0));
    const normalizedLoad = clamp(
      dynamicLoad / Math.max(1, baseNeurons * loadCapacity),
      0,
      3,
    );
    const energyPressure = clamp(
      energyDrop * 1.25 +
        ((Number.isFinite(cognitiveLoss) ? cognitiveLoss : 0) /
          Math.max(0.1, maxEnergy)) *
          0.4,
      0,
      1,
    );
    const densityPressure = clamp(effectiveDensity * densitySensitivity, 0, 1);
    const combinedStress = clamp(
      normalizedLoad * 0.6 + energyPressure * 0.3 + densityPressure * 0.25,
      0,
      1,
    );
    const stressDelta = combinedStress * stressGain;
    const previous = this.#currentNeuralFatigue();
    const restful = energyAfterFrac >= restThreshold;
    const restSupport = restful
      ? clamp(
          (energyAfterFrac - restThreshold) / Math.max(0.001, 1 - restThreshold),
          0,
          1,
        )
      : 0;
    const fatigueAboveBaseline =
      previous > baseline
        ? clamp((previous - baseline) / Math.max(0.001, 1 - baseline), 0, 1)
        : 0;
    const baseRecovery = restful
      ? recoveryRate * (0.35 + restSupport * 0.8)
      : recoveryRate * 0.2;
    const restBonus = pendingRestBoost
      ? clamp(
          pendingRestBoost *
            restEfficiency *
            (0.4 + restSupport * 0.4 + fatigueAboveBaseline * 0.4),
          0,
          1.2,
        )
      : 0;
    const recoveryApplied = clamp(baseRecovery + restBonus, 0, 1.5);
    const increased = clamp(previous + stressDelta, 0, 1);
    const recovered = clamp(increased - recoveryApplied * increased, 0, 1);
    const next = clamp(lerp(recovered, baseline, 0.04), 0, 1);

    this._neuralFatigue = next;
    this._neuralEnergyReserve = energyAfterFrac;
    this._neuralFatigueSnapshot = {
      before: previous,
      after: next,
      loadPressure: normalizedLoad,
      energyPressure,
      densityPressure,
      combinedStress,
      stressDelta,
      recoveryApplied,
      restBaseRecovery: baseRecovery,
      restBonusApplied: restBonus,
      restBoostCarry: pendingRestBoost,
      restSupport,
      energyReserveBefore: energyBeforeFrac,
      energyReserveAfter: energyAfterFrac,
    };

    return this._neuralFatigueSnapshot;
  }

  #resolveRiskTolerance() {
    const base = Number.isFinite(this.baseRiskTolerance)
      ? clamp(this.baseRiskTolerance, 0, 1)
      : 0.5;
    const profile = this.neuralFatigueProfile || {};
    const baselineFatigue = clamp(
      Number.isFinite(profile.baseline) ? profile.baseline : 0.35,
      0,
      1,
    );
    const fatigue = this.#currentNeuralFatigue();
    const energyReserve = this.#currentNeuralEnergyReserve();
    const fatigueWeight = clamp(
      Number.isFinite(profile.fatigueRiskWeight) ? profile.fatigueRiskWeight : 0.4,
      0,
      1.2,
    );
    const restBonus = clamp(
      Number.isFinite(profile.restRiskBonus) ? profile.restRiskBonus : 0.2,
      0,
      0.8,
    );
    const restThreshold = clamp(
      Number.isFinite(profile.restThreshold) ? profile.restThreshold : 0.45,
      0,
      1,
    );

    const fatigueAbove =
      fatigue > baselineFatigue
        ? clamp(
            (fatigue - baselineFatigue) / Math.max(0.001, 1 - baselineFatigue),
            0,
            1,
          )
        : 0;
    const fatigueBelow =
      fatigue < baselineFatigue
        ? clamp((baselineFatigue - fatigue) / Math.max(0.001, baselineFatigue), 0, 1)
        : 0;
    const restState =
      energyReserve > restThreshold
        ? clamp(
            (energyReserve - restThreshold) / Math.max(0.001, 1 - restThreshold),
            0,
            1,
          )
        : -clamp(
            (restThreshold - energyReserve) / Math.max(0.001, restThreshold),
            0,
            1,
          );

    let adjusted = base;

    if (fatigueAbove > 0) {
      adjusted -= fatigueAbove * fatigueWeight * Math.min(1, base + 0.4);
    }
    if (fatigueBelow > 0) {
      adjusted += fatigueBelow * restBonus * (1 - base) * 0.5;
    }
    if (restState > 0) {
      adjusted += restState * restBonus * (1 - adjusted);
    } else if (restState < 0) {
      adjusted += restState * fatigueWeight * 0.4;
    }

    const memoryProfile = this.riskMemoryProfile || {};
    const memory = this._riskMemory;

    if (memory) {
      const resourceSignal = clamp(Number(memory.resource) || 0, -1, 1);
      const eventSignal = clamp(Number(memory.event) || 0, 0, 1);
      const socialSignal = clamp(Number(memory.social) || 0, -1, 1);
      const fatigueSignal = clamp(Number(memory.fatigue) || 0, -1, 1);
      const confidenceSignal = clamp(Number(memory.confidence) || 0, -1, 1);
      const scarcityDrive = clamp(
        Number.isFinite(memoryProfile.scarcityDrive)
          ? memoryProfile.scarcityDrive
          : 0.35,
        0,
        1.5,
      );
      const eventWeight = clamp(
        Number.isFinite(memoryProfile.eventWeight) ? memoryProfile.eventWeight : 0.4,
        0,
        1.5,
      );
      const socialWeight = clamp(
        Number.isFinite(memoryProfile.socialWeight) ? memoryProfile.socialWeight : 0.3,
        0,
        1.5,
      );
      const fatigueMemoryWeight = clamp(
        Number.isFinite(memoryProfile.fatigueWeight)
          ? memoryProfile.fatigueWeight
          : 0.25,
        0,
        1.2,
      );
      const confidenceWeight = clamp(
        Number.isFinite(memoryProfile.confidenceWeight)
          ? memoryProfile.confidenceWeight
          : 0.3,
        0,
        1.2,
      );

      adjusted += -resourceSignal * scarcityDrive * 0.35;
      adjusted -= eventSignal * eventWeight * 0.35;
      adjusted += socialSignal * socialWeight * 0.25;

      if (fatigueSignal > 0) {
        adjusted -= fatigueSignal * fatigueMemoryWeight * 0.15;
      } else if (fatigueSignal < 0) {
        adjusted += -fatigueSignal * fatigueMemoryWeight * 0.08;
      }

      adjusted += confidenceSignal * confidenceWeight * 0.2;
    }

    return clamp(adjusted, 0, 1);
  }

  getRiskTolerance() {
    return this.#resolveRiskTolerance();
  }

  getNeuralFatigue() {
    return this.#currentNeuralFatigue();
  }

  #readSensor(sensorVector, sensors, key, fallback = 0) {
    let fromVector = false;
    let value = Number.NaN;

    if (sensorVector && typeof sensorVector.length === "number") {
      const index = Brain.sensorIndex(key);

      if (
        Number.isFinite(index) &&
        index >= 0 &&
        index < sensorVector.length &&
        Number.isFinite(sensorVector[index])
      ) {
        value = sensorVector[index];
        fromVector = true;
      }
    }

    if (!Number.isFinite(value) && sensors && typeof sensors === "object") {
      const candidate = sensors[key];

      if (Number.isFinite(candidate)) {
        value = candidate;
        fromVector = false;
      }
    }

    if (!Number.isFinite(value)) {
      value = fallback;
      fromVector = false;
    }

    return { value, fromVector };
  }

  #normalizeUnit(value, fromVector) {
    const numeric = Number.isFinite(value) ? value : 0;

    return clamp(fromVector ? (numeric + 1) * 0.5 : numeric, 0, 1);
  }

  #normalizeSigned(value, fromVector) {
    const numeric = Number.isFinite(value) ? value : 0;

    return clamp(numeric, -1, 1);
  }

  #normalizeBipolar(value, fromVector) {
    const numeric = Number.isFinite(value) ? value : 0;

    if (fromVector) {
      return clamp(numeric, -1, 1);
    }

    return clamp(numeric * 2 - 1, -1, 1);
  }

  #integrateRiskMemory(group, sensors, sensorVector) {
    if (!this._riskMemory) return;

    const profile = this.riskMemoryProfile || {};
    const assimilation = clamp(
      Number.isFinite(profile.assimilation) ? profile.assimilation : 0.25,
      0.01,
      1,
    );
    const decay = clamp(
      Number.isFinite(profile.decay) ? profile.decay : 0.12,
      0.01,
      0.6,
    );

    const resourceInfo = this.#readSensor(
      sensorVector,
      sensors,
      "resourceTrend",
      this._resourceSignal ?? 0,
    );
    const resourceTrend = this.#normalizeSigned(
      resourceInfo.value,
      resourceInfo.fromVector,
    );

    const eventInfo = this.#readSensor(
      sensorVector,
      sensors,
      "eventPressure",
      clamp(this.lastEventPressure || 0, 0, 1),
    );
    const eventPressure = this.#normalizeUnit(eventInfo.value, eventInfo.fromVector);

    const allyInfo = this.#readSensor(
      sensorVector,
      sensors,
      "allyFraction",
      sensors?.allyFraction ?? 0,
    );
    const enemyInfo = this.#readSensor(
      sensorVector,
      sensors,
      "enemyFraction",
      sensors?.enemyFraction ?? 0,
    );
    const mateInfo = this.#readSensor(
      sensorVector,
      sensors,
      "mateFraction",
      sensors?.mateFraction ?? 0,
    );
    const allySupport = this.#normalizeUnit(allyInfo.value, allyInfo.fromVector);
    const enemyThreat = this.#normalizeUnit(enemyInfo.value, enemyInfo.fromVector);
    const matePresence = this.#normalizeUnit(mateInfo.value, mateInfo.fromVector);

    const fatigueInfo = this.#readSensor(
      sensorVector,
      sensors,
      "neuralFatigue",
      this.#currentNeuralFatigue(),
    );
    const fatigueSignal = this.#normalizeBipolar(
      fatigueInfo.value,
      fatigueInfo.fromVector,
    );

    const momentumInfo = this.#readSensor(
      sensorVector,
      sensors,
      "interactionMomentum",
      this._interactionMomentum ?? 0,
    );
    const momentumSignal = this.#normalizeSigned(
      momentumInfo.value,
      momentumInfo.fromVector,
    );

    const riskInfo = this.#readSensor(
      sensorVector,
      sensors,
      "riskTolerance",
      this.baseRiskTolerance ?? 0.5,
    );
    const riskUnit = this.#normalizeUnit(riskInfo.value, riskInfo.fromVector);
    const riskSigned = this.#normalizeBipolar(riskInfo.value, riskInfo.fromVector);

    const socialSupport = clamp(allySupport - enemyThreat + matePresence * 0.35, -1, 1);
    const confidenceSignal = clamp(
      riskSigned * 0.5 +
        momentumSignal * 0.3 +
        socialSupport * 0.25 -
        (eventPressure - 0.5) * 0.3,
      -1,
      1,
    );

    this._riskMemory.resource = lerp(this._riskMemory.resource, 0, decay);
    this._riskMemory.event = lerp(this._riskMemory.event, 0, decay * 0.6);
    this._riskMemory.social = lerp(this._riskMemory.social, 0, decay);
    this._riskMemory.fatigue = lerp(this._riskMemory.fatigue, 0, decay * 0.5);
    this._riskMemory.confidence = lerp(this._riskMemory.confidence, 0, decay);

    const resourceAlpha = clamp(assimilation * (profile.resourceWeight ?? 0.45), 0, 1);
    const eventAlpha = clamp(assimilation * (profile.eventWeight ?? 0.5), 0, 1);
    const socialAlpha = clamp(assimilation * (profile.socialWeight ?? 0.4), 0, 1);
    const fatigueAlpha = clamp(assimilation * (profile.fatigueWeight ?? 0.35), 0, 1);
    const confidenceAlpha = clamp(
      assimilation * (profile.confidenceWeight ?? 0.3),
      0,
      1,
    );

    this._riskMemory.resource = lerp(
      this._riskMemory.resource,
      resourceTrend,
      resourceAlpha,
    );
    this._riskMemory.event = lerp(this._riskMemory.event, eventPressure, eventAlpha);
    this._riskMemory.social = lerp(this._riskMemory.social, socialSupport, socialAlpha);
    this._riskMemory.fatigue = lerp(
      this._riskMemory.fatigue,
      fatigueSignal,
      fatigueAlpha,
    );
    this._riskMemory.confidence = lerp(
      this._riskMemory.confidence,
      confidenceSignal,
      confidenceAlpha,
    );

    if (group === "movement" && riskUnit > 0) {
      const driftWeight = clamp(
        Number.isFinite(profile.confidenceWeight)
          ? profile.confidenceWeight * 0.2
          : 0.06,
        0,
        0.2,
      );

      this._riskMemory.confidence = lerp(
        this._riskMemory.confidence,
        clamp(riskUnit * 2 - 1, -1, 1),
        driftWeight,
      );
    }
  }

  #riskMemorySensorValues() {
    const memory = this._riskMemory;

    if (!memory) {
      return { scarcityMemory: 0, confidenceMemory: 0 };
    }

    const scarcityMemory = clamp(
      Number.isFinite(memory.resource) ? -memory.resource : 0,
      -1,
      1,
    );
    const confidenceMemory = clamp(
      Number.isFinite(memory.confidence) ? memory.confidence : 0,
      -1,
      1,
    );

    return { scarcityMemory, confidenceMemory };
  }

  resolveTrait(traitName) {
    if (traitName === "riskTolerance") {
      return this.#resolveRiskTolerance();
    }

    return null;
  }

  #averageSimilarity(list = []) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    let total = 0;
    let count = 0;

    for (const entry of list) {
      if (!entry?.target) continue;
      const similarity = this.#safeSimilarityTo(entry.target, {
        context: "average similarity aggregation",
        fallback: Number.NaN,
      });

      if (!Number.isFinite(similarity)) continue;

      total += similarity;
      count++;
    }

    return count > 0 ? total / count : 0;
  }

  #safeSimilarityTo(
    candidate,
    { context = "similarity evaluation", fallback = null } = {},
  ) {
    if (!candidate?.dna) return fallback;

    try {
      const value = this.similarityTo(candidate);

      return Number.isFinite(value) ? value : fallback;
    } catch (error) {
      warnOnce(`Failed to compute similarity during ${context}.`, error);

      return fallback;
    }
  }

  #updateResourceSignal({ tileEnergy = 0, tileEnergyDelta = 0 } = {}) {
    const normalizedEnergy = clamp(Number.isFinite(tileEnergy) ? tileEnergy : 0, 0, 1);
    const normalizedDelta = clamp(
      Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0,
      -1,
      1,
    );

    if (
      this._resourceSignalLastInput &&
      Math.abs(this._resourceSignalLastInput.energy - normalizedEnergy) <= EPSILON &&
      Math.abs(this._resourceSignalLastInput.delta - normalizedDelta) <= EPSILON
    ) {
      return this._resourceSignal ?? 0;
    }

    const adaptation = clamp(this.resourceTrendAdaptation ?? 0.35, 0.05, 0.95);
    const baselineRate = clamp(adaptation * 0.25, 0.01, 0.6);
    const currentBaseline =
      Number.isFinite(this._resourceBaseline) && this._resourceBaseline >= 0
        ? this._resourceBaseline
        : normalizedEnergy;
    const currentDelta = Number.isFinite(this._resourceDelta) ? this._resourceDelta : 0;
    const nextDelta = lerp(currentDelta, normalizedDelta, adaptation);
    const nextBaseline = lerp(currentBaseline, normalizedEnergy, baselineRate);
    const divergence = clamp(normalizedEnergy - nextBaseline, -1, 1);
    const signal = clamp(nextDelta * 0.7 + divergence * 0.6, -1, 1);

    this._resourceDelta = nextDelta;
    this._resourceBaseline = nextBaseline;
    this._resourceSignal = signal;
    this._resourceSignalLastInput = {
      energy: normalizedEnergy,
      delta: normalizedDelta,
    };

    return signal;
  }

  #resolveInteractionMomentum({ applyDecay = true } = {}) {
    const baseline = Number.isFinite(this._interactionBaseline)
      ? this._interactionBaseline
      : 0;

    if (!Number.isFinite(this._interactionMomentum)) {
      this._interactionMomentum = baseline;
    }

    if (!applyDecay) {
      return clamp(this._interactionMomentum, -1, 1);
    }

    if (this._interactionDecay <= 0) {
      return clamp(this._interactionMomentum, -1, 1);
    }

    const lastAge = Number.isFinite(this._lastInteractionDecayAge)
      ? this._lastInteractionDecayAge
      : this.age;

    if (this.age !== lastAge) {
      const iterations = Math.max(0, Math.min(6, Math.floor(this.age - lastAge)));

      for (let i = 0; i < iterations; i++) {
        this._interactionMomentum = clamp(
          lerp(this._interactionMomentum, baseline, this._interactionDecay),
          -1,
          1,
        );
      }

      this._lastInteractionDecayAge = this.age;
    }

    return clamp(this._interactionMomentum, -1, 1);
  }

  getInteractionMomentum({ decay = false } = {}) {
    return this.#resolveInteractionMomentum({ applyDecay: Boolean(decay) });
  }

  experienceInteraction(event = {}) {
    if (!event || typeof event !== "object") {
      return this.#resolveInteractionMomentum({ applyDecay: false });
    }

    const baseline = Number.isFinite(this._interactionBaseline)
      ? this._interactionBaseline
      : 0;
    const learning = clamp(this._interactionLearning ?? 0, 0, 1);
    const volatility = Math.max(0, this._interactionVolatility ?? 0);

    const defaultProfile = {
      fightWin: { base: -0.45, kinship: -0.35 },
      fightLoss: { base: -0.75, kinship: -0.35 },
      cooperateGive: { base: 0.4, kinship: 0.3 },
      cooperateReceive: { base: 0.6, kinship: 0.3 },
      reproduce: { base: 0.3, kinship: 0.2 },
      genericPositive: 0.2,
      genericNegative: -0.2,
      energyDeltaWeight: 0.35,
      intensityWeight: 1,
    };

    const affectProfile =
      typeof this.dna?.interactionAffectProfile === "function"
        ? this.dna.interactionAffectProfile()
        : null;

    const sanitizePair = (candidate, fallback) => {
      const base = Number.isFinite(candidate?.base)
        ? clamp(candidate.base, -2, 2)
        : fallback.base;
      const kinship = Number.isFinite(candidate?.kinship)
        ? clamp(candidate.kinship, -2, 2)
        : fallback.kinship;

      return { base, kinship };
    };

    const fightWin = sanitizePair(affectProfile?.fight?.win, defaultProfile.fightWin);
    const fightLoss = sanitizePair(
      affectProfile?.fight?.loss,
      defaultProfile.fightLoss,
    );
    const cooperateGive = sanitizePair(
      affectProfile?.cooperation?.give,
      defaultProfile.cooperateGive,
    );
    const cooperateReceive = sanitizePair(
      affectProfile?.cooperation?.receive,
      defaultProfile.cooperateReceive,
    );
    const reproduceProfile = sanitizePair(
      affectProfile?.reproduce,
      defaultProfile.reproduce,
    );

    const genericPositive = Number.isFinite(affectProfile?.generic?.positive)
      ? clamp(affectProfile.generic.positive, -1, 1)
      : defaultProfile.genericPositive;
    const genericNegative = Number.isFinite(affectProfile?.generic?.negative)
      ? clamp(affectProfile.generic.negative, -1, 1)
      : defaultProfile.genericNegative;
    const energyDeltaWeight = Number.isFinite(affectProfile?.energyDeltaWeight)
      ? clamp(affectProfile.energyDeltaWeight, -1, 1)
      : defaultProfile.energyDeltaWeight;
    const intensityWeight = Number.isFinite(affectProfile?.intensityWeight)
      ? clamp(affectProfile.intensityWeight, 0, 3)
      : defaultProfile.intensityWeight;

    if (learning <= 0 || volatility <= 0) {
      return this.#resolveInteractionMomentum({ applyDecay: false });
    }

    let kinship = Number.isFinite(event.kinship)
      ? clamp(event.kinship, 0, 1)
      : Number.NaN;
    const partner = event.partner ?? null;

    if (!Number.isFinite(kinship) && partner) {
      kinship = clamp(
        this.#safeSimilarityTo(partner, {
          context: "interaction kinship estimation",
          fallback: 0,
        }),
        0,
        1,
      );
    }

    if (!Number.isFinite(kinship)) kinship = 0;

    let signal = 0;
    const type = event.type;
    const outcome = event.outcome ?? null;

    switch (type) {
      case "fight": {
        const profile = outcome === "win" ? fightWin : fightLoss;

        signal = profile.base + kinship * profile.kinship;
        break;
      }
      case "cooperate": {
        const profile = outcome === "receive" ? cooperateReceive : cooperateGive;

        signal = profile.base + kinship * profile.kinship;
        break;
      }
      case "reproduce": {
        signal = reproduceProfile.base + kinship * reproduceProfile.kinship;
        break;
      }
      default: {
        if (outcome === "positive") signal += genericPositive;
        if (outcome === "negative") signal += genericNegative;
        break;
      }
    }

    const energyDelta = clamp(
      Number.isFinite(event.energyDelta)
        ? event.energyDelta / (MAX_TILE_ENERGY || 1)
        : 0,
      -1,
      1,
    );
    const intensity = clamp(
      Number.isFinite(event.intensity) ? event.intensity : 1,
      0,
      2,
    );

    signal += energyDelta * energyDeltaWeight;

    const target = clamp(
      baseline + signal * volatility * clamp(intensity * intensityWeight, 0, 4),
      -1,
      1,
    );
    const current = Number.isFinite(this._interactionMomentum)
      ? this._interactionMomentum
      : baseline;
    const next = clamp(current + (target - current) * learning, -1, 1);

    this._interactionMomentum = next;
    this._lastInteractionDecayAge = this.age;
    this._lastInteractionSummary = {
      type,
      outcome,
      kinship,
      energyDelta,
      intensity,
      signalContribution: signal,
      affectProfileSnapshot: {
        fightWin: { ...fightWin },
        fightLoss: { ...fightLoss },
        cooperateGive: { ...cooperateGive },
        cooperateReceive: { ...cooperateReceive },
        reproduce: { ...reproduceProfile },
        genericPositive,
        genericNegative,
        energyDeltaWeight,
        intensityWeight,
      },
      resultingMomentum: next,
    };

    return next;
  }

  #movementSensors({
    localDensity = 0,
    densityEffectMultiplier = 1,
    mates = [],
    enemies = [],
    society = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const totalNeighbors = Math.max(1, mates.length + enemies.length + society.length);
    const allyFrac = society.length / totalNeighbors;
    const enemyFrac = enemies.length / totalNeighbors;
    const mateFrac = mates.length / totalNeighbors;
    const energyFrac = clamp(
      (this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY),
      0,
      1,
    );
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : energyFrac;
    const resourceTrend = this.#updateResourceSignal({
      tileEnergy: tileLevel,
      tileEnergyDelta,
    });
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const allySimilarity = this.#averageSimilarity(society);
    const enemySimilarity = this.#averageSimilarity(enemies);
    const mateSimilarity = this.#averageSimilarity(mates);
    const riskTolerance = this.#resolveRiskTolerance();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const neuralFatigue = this.#currentNeuralFatigue();
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      allyFraction: allyFrac,
      enemyFraction: enemyFrac,
      mateFraction: mateFrac,
      allySimilarity,
      enemySimilarity,
      mateSimilarity,
      ageFraction: ageFrac,
      riskTolerance,
      interactionMomentum,
      eventPressure,
      resourceTrend,
      neuralFatigue,
      scarcityMemory,
      confidenceMemory,
    };
  }

  #queueRestRecovery({ localDensity = 0, densityEffectMultiplier = 1 } = {}) {
    const profile = this.neuralFatigueProfile || {};
    const baseline = clamp(
      Number.isFinite(profile.baseline) ? profile.baseline : 0.35,
      0,
      1,
    );
    const restThreshold = clamp(
      Number.isFinite(profile.restThreshold) ? profile.restThreshold : 0.45,
      0,
      1,
    );
    const restEfficiency = clamp(
      Number.isFinite(profile.restEfficiency) ? profile.restEfficiency : 0.45,
      0.1,
      1.5,
    );
    const fatigue = this.#currentNeuralFatigue();
    const energyReserve = this.#currentNeuralEnergyReserve();
    const restNeed =
      fatigue > baseline
        ? clamp((fatigue - baseline) / Math.max(0.001, 1 - baseline), 0, 1)
        : 0;
    const restSupport =
      energyReserve > restThreshold
        ? clamp(
            (energyReserve - restThreshold) / Math.max(0.001, 1 - restThreshold),
            0,
            1,
          )
        : 0;
    const densityPenalty = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const densityRelief = clamp(0.35 + (1 - densityPenalty) * 0.65, 0.2, 1);
    const baseBoost =
      restEfficiency * densityRelief * (0.3 + restNeed * 0.5 + restSupport * 0.35);
    const boost = clamp(baseBoost, 0, 1.2);
    const carry = clamp(
      (Number.isFinite(this._pendingRestRecovery) ? this._pendingRestRecovery : 0) +
        boost,
      0,
      3,
    );

    this._pendingRestRecovery = carry;

    this.#assignDecisionOutcome("movement", {
      restBoost: boost,
      restCarry: carry,
      restNeed,
      restSupport,
      restDensityRelief: densityRelief,
    });

    return boost;
  }

  #interactionSensors({
    localDensity = 0,
    densityEffectMultiplier = 1,
    enemies = [],
    allies = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const totalNeighbors = Math.max(1, enemies.length + allies.length);
    const enemyFrac = enemies.length / totalNeighbors;
    const allyFrac = allies.length / totalNeighbors;
    const energyFrac = clamp(
      (this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY),
      0,
      1,
    );
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : energyFrac;
    const resourceTrend = this.#updateResourceSignal({
      tileEnergy: tileLevel,
      tileEnergyDelta,
    });
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const enemySimilarity = this.#averageSimilarity(enemies);
    const allySimilarity = this.#averageSimilarity(allies);
    const riskTolerance = this.#resolveRiskTolerance();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const neuralFatigue = this.#currentNeuralFatigue();

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      enemyFraction: enemyFrac,
      allyFraction: allyFrac,
      enemySimilarity,
      allySimilarity,
      ageFraction: ageFrac,
      riskTolerance,
      interactionMomentum,
      eventPressure,
      resourceTrend,
      neuralFatigue,
    };
  }

  #reproductionSensors(
    partner,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      maxTileEnergy = MAX_TILE_ENERGY,
      baseProbability = 0.5,
      tileEnergy = null,
      tileEnergyDelta = 0,
    } = {},
  ) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const energyFrac = clamp(
      (this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY),
      0,
      1,
    );
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : energyFrac;
    const resourceTrend = this.#updateResourceSignal({
      tileEnergy: tileLevel,
      tileEnergyDelta,
    });
    const partnerEnergy = clamp(
      (partner?.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY),
      0,
      1,
    );
    const similarity = clamp(
      this.#safeSimilarityTo(partner, {
        context: "reproduction sensor partner similarity",
        fallback: 0,
      }),
      0,
      1,
    );
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const partnerAgeFrac =
      partner?.lifespan > 0 ? clamp(partner.age / partner.lifespan, 0, 1) : 0;
    const senSelf =
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0;
    const senPartner =
      partner && typeof partner.dna?.senescenceRate === "function"
        ? partner.dna.senescenceRate()
        : 0;
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const neuralFatigue = this.#currentNeuralFatigue();
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();

    return {
      energy: energyFrac,
      partnerEnergy,
      effectiveDensity: effD,
      partnerSimilarity: similarity,
      baseReproductionProbability: baseProbability,
      ageFraction: ageFrac,
      partnerAgeFraction: partnerAgeFrac,
      selfSenescence: senSelf,
      partnerSenescence: senPartner,
      interactionMomentum,
      eventPressure,
      resourceTrend,
      neuralFatigue,
      scarcityMemory,
      confidenceMemory,
    };
  }

  #targetingSensors(enemies = [], { maxTileEnergy = MAX_TILE_ENERGY } = {}) {
    const energyCap = maxTileEnergy > 0 ? maxTileEnergy : MAX_TILE_ENERGY || 1;
    const resolvedEnemies = Array.isArray(enemies) ? enemies : [];
    let count = 0;
    let minDiff = Infinity;
    let maxDiff = -Infinity;
    let attritionSum = 0;
    let similaritySum = 0;
    let closest = Infinity;

    for (const entry of resolvedEnemies) {
      const target = entry?.target;

      if (!target) continue;

      const enemyEnergy = Number.isFinite(target.energy) ? target.energy : 0;
      const diff = clamp(((this.energy ?? 0) - enemyEnergy) / energyCap, -1, 1);

      minDiff = Math.min(minDiff, diff);
      maxDiff = Math.max(maxDiff, diff);

      const distance = Math.max(
        Math.abs((entry.row ?? target.row ?? this.row) - this.row),
        Math.abs((entry.col ?? target.col ?? this.col) - this.col),
      );

      if (Number.isFinite(distance)) {
        closest = Math.min(closest, distance);
      }

      const attrition = target.lifespan
        ? clamp((target.age ?? 0) / target.lifespan, 0, 1)
        : 0;

      attritionSum += attrition;

      const similarity = clamp(
        this.#safeSimilarityTo(target, {
          context: "targeting sensor similarity accumulation",
          fallback: 0,
        }),
        0,
        1,
      );

      similaritySum += similarity;
      count++;
    }

    const averageSimilarity = count > 0 ? similaritySum / count : 0;
    const averageAttrition = count > 0 ? attritionSum / count : 0;
    const weaknessSignal = Number.isFinite(maxDiff) ? clamp(maxDiff, -1, 1) : 0;
    const threatSignal = Number.isFinite(minDiff) ? clamp(-minDiff, -1, 1) : 0;
    const proximity = Number.isFinite(closest) ? 1 / (1 + closest) : 0;
    const proximitySignal = clamp(proximity * 2 - 1, -1, 1);
    const attritionSignal = clamp(averageAttrition * 2 - 1, -1, 1);
    const sightRange = Math.max(1, Math.floor(this.sight ?? 1));
    const maxNeighbors = (sightRange * 2 + 1) * (sightRange * 2 + 1) - 1;
    const enemyFraction = clamp(count / Math.max(1, maxNeighbors), 0, 1);
    const resourceTrend = clamp(
      Number.isFinite(this._resourceSignal) ? this._resourceSignal : 0,
      -1,
      1,
    );
    const riskTolerance = this.#resolveRiskTolerance();
    const neuralFatigue = this.#currentNeuralFatigue();
    const interactionMomentum = this.#resolveInteractionMomentum();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();

    return {
      energy: clamp((this.energy ?? 0) / energyCap, 0, 1),
      effectiveDensity: enemyFraction,
      enemyFraction,
      enemySimilarity: averageSimilarity,
      interactionMomentum,
      eventPressure,
      ageFraction: this.getAgeFraction(),
      riskTolerance,
      resourceTrend,
      neuralFatigue,
      scarcityMemory,
      confidenceMemory,
      targetWeakness: weaknessSignal,
      targetThreat: threatSignal,
      targetProximity: proximitySignal,
      targetAttrition: attritionSignal,
    };
  }

  #evaluateBrainGroup(group, sensors) {
    if (!this.#canUseNeuralPolicies()) {
      this.#integrateRiskMemory(group, sensors, null);

      return null;
    }

    const result = this.brain.evaluateGroup(group, sensors, { trace: true });

    this.#integrateRiskMemory(group, sensors, result?.sensors ?? null);

    if (!result || !result.values) {
      this._decisionContextIndex.delete(group);

      return null;
    }

    const activationLoad = Math.max(0, result.activationCount || 0);

    this._neuralLoad += activationLoad;

    this.#registerDecisionContext(group, sensors, result, activationLoad);

    return result.values;
  }

  #mapLegacyStrategyToAction(strategy) {
    switch (strategy) {
      case "pursuit":
        return "pursue";
      case "cautious":
        return "avoid";
      default:
        return "explore";
    }
  }

  getAgeFraction() {
    if (!Number.isFinite(this.lifespan) || this.lifespan <= 0) return 0;

    return clamp(this.age / this.lifespan, 0, 1);
  }

  resolveRng(tag, fallback = Math.random) {
    const key = typeof tag === "string" && tag.length > 0 ? tag : "default";

    if (!this._rngCache) this._rngCache = new Map();
    if (this._rngCache.has(key)) return this._rngCache.get(key);

    const source =
      typeof this.dna?.prngFor === "function" ? this.dna.prngFor(key) : null;
    const rng = typeof source === "function" ? source : fallback;
    const resolved = typeof rng === "function" ? rng : Math.random;

    this._rngCache.set(key, resolved);

    return resolved;
  }

  resolveSharedRng(other, tag, fallback = Math.random) {
    const key = typeof tag === "string" && tag.length > 0 ? tag : "shared";

    if (!other) {
      return this.resolveRng(`${key}:solo`, fallback);
    }

    if (!this._sharedRngCache) this._sharedRngCache = new Map();

    let map = this._sharedRngCache.get(key);

    if (!map) {
      map = new WeakMap();
      this._sharedRngCache.set(key, map);
    }

    if (map.has(other)) {
      return map.get(other);
    }

    const otherDNA = other?.dna ?? other ?? null;
    let rng = null;

    if (typeof this.dna?.sharedRng === "function") {
      rng = this.dna.sharedRng(otherDNA, key);
    }

    if (typeof rng !== "function") {
      rng = this.resolveRng(`${key}:${otherDNA?.seed?.() ?? "none"}`, fallback);
    }

    map.set(other, rng);

    return rng;
  }

  ageEnergyMultiplier(load = 1) {
    const ageFrac = this.getAgeFraction();

    if (ageFrac <= 0) return 1;

    const senescence =
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0;
    const basePull = 0.12 + Math.max(0, senescence);
    const linear = 1 + ageFrac * basePull;
    const curvature = 1 + ageFrac * ageFrac * (0.25 + Math.max(0, senescence) * 1.1);
    const combined = linear * curvature;
    const loadFactor = clamp(Number.isFinite(load) ? load : 1, 0, 3);

    return 1 + (combined - 1) * loadFactor;
  }

  #decideMovementAction(context = {}) {
    const sensors = this.#movementSensors(context);
    const values = this.#evaluateBrainGroup("movement", sensors);

    if (!values) {
      this._usedNeuralMovement = false;

      return { action: null, usedBrain: false };
    }

    const entries = OUTPUT_GROUPS.movement;
    const logits = entries.map(({ key }) => values[key] ?? 0);
    const labels = entries.map(({ key }) => key);
    const probs = softmax(logits);
    const decisionRng = this.resolveRng("movementDecision");
    const action = sampleFromDistribution(probs, labels, decisionRng);
    const probabilitiesByKey = {};
    const logitsByKey = {};

    for (let i = 0; i < labels.length; i++) {
      const key = labels[i];

      probabilitiesByKey[key] = probs[i] ?? 0;
      logitsByKey[key] = logits[i] ?? 0;
    }

    if (!action) {
      this._usedNeuralMovement = false;
      this.#assignDecisionOutcome("movement", {
        action: null,
        usedBrain: true,
        probabilities: probabilitiesByKey,
        logits: logitsByKey,
      });

      return { action: null, usedBrain: false };
    }

    this._usedNeuralMovement = true;

    this.#assignDecisionOutcome("movement", {
      action,
      usedBrain: true,
      probabilities: probabilitiesByKey,
      logits: logitsByKey,
    });

    return { action, usedBrain: true };
  }

  decideRandomMove() {
    // DNA-driven rest probability: more cautious genomes rest more
    const g = this.movementGenes || { wandering: 0.33, pursuit: 0.33, cautious: 0.34 };
    const w = Math.max(0, g.wandering);
    const p = Math.max(0, g.pursuit);
    const c = Math.max(0, g.cautious);
    const total = w + p + c || 1;
    const pStay = Math.max(0, Math.min(0.9, 0.15 + 0.7 * (c / total)));
    const rng = this.resolveRng("movementRandom");

    if (rng() < pStay) return { dr: 0, dc: 0 };
    // Otherwise pick one of 4 directions uniformly
    switch ((rng() * 4) | 0) {
      case 0:
        return { dr: -1, dc: 0 };
      case 1:
        return { dr: 1, dc: 0 };
      case 2:
        return { dr: 0, dc: -1 };
      default:
        return { dr: 0, dc: 1 };
    }
  }

  #calculateMetabolicEnergyLoss(effectiveDensity) {
    const energyLossConfig = this.density?.energyLoss ?? { min: 1, max: 1 };
    const minLoss = Number.isFinite(energyLossConfig.min) ? energyLossConfig.min : 1;
    const maxLoss = Number.isFinite(energyLossConfig.max)
      ? energyLossConfig.max
      : minLoss;
    const energyDensityMult = lerp(minLoss, maxLoss, effectiveDensity);
    const baseLoss = this.dna.energyLossBase();
    const metabolicMultiplier = 1 + Math.max(0, this.metabolism || 0);
    const crowdPenalty =
      1 + effectiveDensity * Math.max(0, this.metabolicCrowdingTax || 0);
    const lossScale =
      this.dna.baseEnergyLossScale() *
      metabolicMultiplier *
      energyDensityMult *
      crowdPenalty;
    const agingPenalty = this.ageEnergyMultiplier();

    return baseLoss * lossScale * agingPenalty;
  }

  #calculateCognitiveCosts(effectiveDensity) {
    const baselineNeurons = Math.max(0, this.neurons || 0);
    const dynamicLoad = Math.max(0, this._neuralLoad || 0);
    const cognitiveAgeMultiplier = this.ageEnergyMultiplier(0.75);
    const breakdown =
      typeof this.dna.cognitiveCostComponents === "function"
        ? this.dna.cognitiveCostComponents({
            baselineNeurons,
            dynamicNeurons: dynamicLoad,
            sight: this.sight,
            effDensity: effectiveDensity,
          })
        : null;

    if (breakdown) {
      const baselineCost = (breakdown.baseline || 0) * cognitiveAgeMultiplier;
      const dynamicCost = (breakdown.dynamic || 0) * cognitiveAgeMultiplier;

      return {
        baselineCost,
        dynamicCost,
        cognitiveLoss: baselineCost + dynamicCost,
        dynamicLoad,
        baselineNeurons,
      };
    }

    const baselineCost =
      this.dna.cognitiveCost(baselineNeurons, this.sight, effectiveDensity) *
      cognitiveAgeMultiplier;
    const combinedLoad = Math.max(0, baselineNeurons + dynamicLoad);
    const totalCost =
      this.dna.cognitiveCost(combinedLoad, this.sight, effectiveDensity) *
      cognitiveAgeMultiplier;
    const dynamicCost = Math.max(0, totalCost - baselineCost);

    return {
      baselineCost,
      dynamicCost,
      cognitiveLoss: baselineCost + dynamicCost,
      dynamicLoad,
      baselineNeurons,
    };
  }

  manageEnergy(row, col, { localDensity, densityEffectMultiplier, maxTileEnergy }) {
    const effectiveDensity = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const energyLoss = this.#calculateMetabolicEnergyLoss(effectiveDensity);
    const { baselineCost, dynamicCost, cognitiveLoss, dynamicLoad, baselineNeurons } =
      this.#calculateCognitiveCosts(effectiveDensity);
    const energyBefore = this.energy;

    this.energy -= energyLoss + cognitiveLoss;
    this.lastEventPressure = Math.max(0, (this.lastEventPressure || 0) * 0.9);

    const fatigueSnapshot = this.#updateNeuralFatigueState({
      dynamicLoad,
      baselineNeurons,
      cognitiveLoss,
      effectiveDensity,
      energyBefore,
      energyAfter: this.energy,
      maxTileEnergy,
    });

    this.#finalizeDecisionContexts({
      energyBefore,
      energyAfter: this.energy,
      energyLoss,
      cognitiveLoss,
      baselineCost,
      dynamicCost,
      dynamicLoad,
      baselineNeurons,
      totalLoss: energyLoss + cognitiveLoss,
      neuralFatigueSnapshot: fatigueSnapshot,
      maxTileEnergy,
    });

    this._neuralLoad = 0;

    return this.energy <= this.starvationThreshold(maxTileEnergy);
  }

  resolveHarvestCrowdingPenalty({
    density = 0,
    tileEnergy = 0.5,
    tileEnergyDelta = 0,
    baseRate = 0,
    availableEnergy = 0,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const tolerance = clamp(this.baseCrowdingTolerance ?? 0.5, 0, 1);
    const adaptation = clamp(this._crowdingTolerance ?? tolerance, 0, 1);
    const crowd = clamp(Number.isFinite(density) ? density : 0, 0, 1);
    const normalizedEnergy =
      maxTileEnergy > 0 ? clamp((this.energy ?? 0) / maxTileEnergy, 0, 1) : 0;
    const scarcity = clamp(1 - normalizedEnergy, 0, 1);
    const tileAbundance = clamp(tileEnergy ?? 0, 0, 1);
    const tileScarcity = clamp(1 - tileAbundance, 0, 1);
    const declinePressure = clamp(-(tileEnergyDelta ?? 0), 0, 1);
    const resourceSignal = clamp(this._resourceSignal ?? 0, -1, 1);
    const expectation = clamp(Number.isFinite(baseRate) ? baseRate : 0, 0, 1.5);
    const availableNorm =
      maxTileEnergy > 0
        ? clamp(
            Number.isFinite(availableEnergy) ? availableEnergy / maxTileEnergy : 0,
            0,
            1,
          )
        : 0;
    const scarcityDrive = clamp(
      scarcity * 0.6 + tileScarcity * 0.45 + declinePressure * 0.6,
      0,
      1.6,
    );
    const opportunism = clamp(expectation * 0.5 + availableNorm * 0.5, 0, 1);
    const adaptability = clamp(
      adaptation + (resourceSignal < 0 ? Math.abs(resourceSignal) * 0.35 : 0),
      0,
      1,
    );
    const sensitivityBase = 0.35 + (1 - tolerance) * 0.9;
    const crowdSensitivity = clamp(
      sensitivityBase *
        (1 + scarcityDrive * (0.65 + opportunism * 0.55)) *
        (1 - adaptability * 0.45),
      0.05,
      1.45,
    );
    const penalty = Math.max(0, 1 - crowdSensitivity * crowd);
    const pressureSignal = crowd > tolerance ? crowd - tolerance : 0;
    const reliefSignal = crowd < tolerance ? tolerance - crowd : 0;
    const scarcityWeight = clamp(0.2 + scarcity * 0.5 + tileScarcity * 0.3, 0.1, 1);
    const learningRate = clamp(
      0.08 + crowd * 0.25 + scarcityWeight * 0.3 + opportunism * 0.2,
      0.05,
      0.65,
    );
    let target = adaptation;

    if (pressureSignal > 0 && penalty < 0.75) {
      target = Math.max(0, adaptation - pressureSignal * (0.2 + scarcityWeight * 0.4));
    } else if (reliefSignal > 0) {
      target = Math.min(
        1,
        adaptation + reliefSignal * (0.18 + (1 - scarcityWeight) * 0.25),
      );
    }

    if (resourceSignal > 0 && crowd < tolerance) {
      target = Math.min(1, target + resourceSignal * 0.2);
    }

    this._crowdingTolerance = clamp(lerp(adaptation, target, learningRate), 0, 1);

    return clamp(penalty, 0, 1);
  }

  getDecisionTelemetry(limit = 5) {
    const history = Array.isArray(this.decisionHistory) ? this.decisionHistory : [];
    const normalizedLimit = Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : history.length;
    const sliceStart = Math.max(
      0,
      history.length - (normalizedLimit || history.length),
    );

    return history.slice(sliceStart).map((entry) => {
      const { decisions = [], ...rest } = entry || {};

      return {
        ...rest,
        decisions: decisions.map((decision) => ({
          ...decision,
          sensors: decision.sensors ? { ...decision.sensors } : null,
          sensorVector: Array.isArray(decision.sensorVector)
            ? [...decision.sensorVector]
            : null,
          outputs: decision.outputs ? { ...decision.outputs } : null,
          trace: cloneTracePayload(decision.trace),
          outcome:
            decision.outcome &&
            typeof decision.outcome === "object" &&
            !Array.isArray(decision.outcome)
              ? { ...decision.outcome }
              : (decision.outcome ?? null),
          energyImpact: decision.energyImpact ? { ...decision.energyImpact } : null,
        })),
      };
    });
  }

  starvationThreshold(maxTileEnergy = 5) {
    return this.dna.starvationThresholdFrac() * maxTileEnergy;
  }

  static randomMovementGenes() {
    return {
      wandering: randomRange(0, 1),
      pursuit: randomRange(0, 1),
      cautious: randomRange(0, 1),
    };
  }

  #legacyChooseMovementStrategy(localDensity = 0, densityEffectMultiplier = 1) {
    let { wandering, pursuit, cautious } = this.movementGenes;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const cautiousMul = lerp(
      this.density.cautious.min,
      this.density.cautious.max,
      effD,
    );
    const pursuitMul = lerp(this.density.pursuit.max, this.density.pursuit.min, effD);
    const cautiousScaled = Math.max(0, cautious * cautiousMul);
    const pursuitScaled = Math.max(0, pursuit * pursuitMul);
    const wanderingScaled = Math.max(0, wandering);
    const total = wanderingScaled + pursuitScaled + cautiousScaled || 1;
    const rng = this.resolveRng("legacyMovementChoice");
    const r = randomRange(0, total, rng);

    if (r < wanderingScaled) return "wandering";
    if (r < wanderingScaled + pursuitScaled) return "pursuit";

    return "cautious";
  }

  chooseMovementStrategy({
    localDensity = 0,
    densityEffectMultiplier = 1,
    mates = [],
    enemies = [],
    society = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const decision = this.#decideMovementAction({
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    });

    if (decision.usedBrain && decision.action) return decision.action;

    this._usedNeuralMovement = false;

    const legacy = this.#legacyChooseMovementStrategy(
      localDensity,
      densityEffectMultiplier,
    );

    return this.#mapLegacyStrategyToAction(legacy);
  }

  #legacyExecuteMovementStrategy(
    gridArr,
    row,
    col,
    mates,
    enemies,
    society,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      rows,
      cols,
      moveToTarget,
      moveAwayFromTarget,
      moveRandomly,
      getEnergyAt,
      tryMove,
      isTileBlocked,
    } = {},
  ) {
    const strategy = this.#legacyChooseMovementStrategy(
      localDensity,
      densityEffectMultiplier,
    );

    if (strategy === "pursuit") {
      const target =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (target)
        return moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

      return moveRandomly(gridArr, row, col, this, rows, cols);
    }
    if (strategy === "cautious") {
      const threat =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (threat)
        return moveAwayFromTarget(
          gridArr,
          row,
          col,
          threat.row,
          threat.col,
          rows,
          cols,
        );

      return moveRandomly(gridArr, row, col, this, rows, cols);
    }
    // wandering: try cohesion toward allies first
    if (Array.isArray(society) && society.length > 0) {
      const coh = typeof this.dna.cohesion === "function" ? this.dna.cohesion() : 0;
      const cohesionRng = this.resolveRng("legacyMovementCohesion");

      if (cohesionRng() < coh) {
        const target = this.#nearest(society, row, col);

        if (target)
          return moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);
      }
    }
    // then bias toward best energy neighbor if provided
    if (typeof getEnergyAt === "function") {
      const dirs = [
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 },
      ];
      let best = null;
      let bestE = -Infinity;

      for (const d of dirs) {
        const rr = row + d.dr;
        const cc = col + d.dc;

        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        if (typeof isTileBlocked === "function" && isTileBlocked(rr, cc)) continue;
        const occPenalty = gridArr[rr][cc] ? -1 : 0;
        const e = (getEnergyAt(rr, cc) ?? 0) + occPenalty;

        if (e > bestE) {
          bestE = e;
          best = d;
        }
      }
      const g = this.movementGenes || { wandering: 1, pursuit: 1, cautious: 1 };
      const total =
        Math.max(0, g.wandering) + Math.max(0, g.pursuit) + Math.max(0, g.cautious) ||
        1;
      const dnaExploit =
        typeof this.dna.exploitationBias === "function"
          ? this.dna.exploitationBias()
          : 0.5;
      const pExploit = Math.max(
        0.05,
        Math.min(
          0.95,
          0.3 + 0.4 * (Math.max(0, g.wandering) / total) + 0.3 * dnaExploit,
        ),
      );
      const exploitRng = this.resolveRng("legacyMovementExploit");

      if (best && exploitRng() < pExploit) {
        if (typeof tryMove === "function")
          return tryMove(gridArr, row, col, best.dr, best.dc, rows, cols);

        return moveRandomly(gridArr, row, col, this, rows, cols);
      }
    }

    return moveRandomly(gridArr, row, col, this, rows, cols);
  }

  executeMovementStrategy(gridArr, row, col, mates, enemies, society, context = {}) {
    const {
      localDensity = 0,
      densityEffectMultiplier = 1,
      rows,
      cols,
      moveToTarget,
      moveAwayFromTarget,
      moveRandomly,
      getEnergyAt,
      tryMove,
      isTileBlocked,
      maxTileEnergy = MAX_TILE_ENERGY,
      tileEnergy = null,
      tileEnergyDelta = 0,
    } = context;
    const strategyContext = {
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    };
    const decision = this.#decideMovementAction(strategyContext);

    if (!decision.usedBrain || !decision.action) {
      return this.#legacyExecuteMovementStrategy(
        gridArr,
        row,
        col,
        mates,
        enemies,
        society,
        context,
      );
    }

    const chosen = decision.action;
    const nearestEnemy = this.#nearest(enemies, row, col);
    const nearestMate = this.#nearest(mates, row, col);
    const nearestAlly = this.#nearest(society, row, col);

    const attemptEnergyExploit = () => {
      if (typeof getEnergyAt !== "function") return false;
      const dirs = [
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 },
      ];
      let bestDir = null;
      let bestValue = -Infinity;

      for (const d of dirs) {
        const rr = row + d.dr;
        const cc = col + d.dc;

        if (rr < 0 || rr >= (rows ?? 0) || cc < 0 || cc >= (cols ?? 0)) continue;
        if (typeof isTileBlocked === "function" && isTileBlocked(rr, cc)) continue;
        const occupancyPenalty = gridArr?.[rr]?.[cc] ? -1 : 0;
        const energy = (getEnergyAt(rr, cc) ?? 0) + occupancyPenalty;

        if (energy > bestValue) {
          bestValue = energy;
          bestDir = d;
        }
      }

      if (!bestDir) return false;

      if (typeof tryMove === "function") {
        const moved = tryMove(gridArr, row, col, bestDir.dr, bestDir.dc, rows, cols);

        if (moved) return true;
      }

      if (typeof moveRandomly === "function") {
        moveRandomly(gridArr, row, col, this, rows, cols);
      }

      return true;
    };

    switch (chosen) {
      case "rest":
        this.#queueRestRecovery({ localDensity, densityEffectMultiplier });

        return;
      case "pursue": {
        const target = nearestEnemy || nearestMate || nearestAlly;

        if (target && typeof moveToTarget === "function") {
          moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

          return;
        }

        break;
      }
      case "avoid": {
        const threat = nearestEnemy || nearestMate || nearestAlly;

        if (threat && typeof moveAwayFromTarget === "function") {
          moveAwayFromTarget(gridArr, row, col, threat.row, threat.col, rows, cols);

          return;
        }

        break;
      }
      case "cohere": {
        const target = nearestAlly || nearestMate;

        if (target && typeof moveToTarget === "function") {
          moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

          return;
        }

        break;
      }
      default:
        break;
    }

    if (chosen === "explore" && attemptEnergyExploit()) return;

    if (typeof moveRandomly === "function") {
      moveRandomly(gridArr, row, col, this, rows, cols);
    }
  }

  computeReproductionProbability(partner, { localDensity, densityEffectMultiplier }) {
    const baseReproProb =
      (this.dna.reproductionProb() + partner.dna.reproductionProb()) / 2;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const reproMul = lerp(
      this.density.reproduction.max,
      this.density.reproduction.min,
      effD,
    );
    const sA =
      typeof this.dna.senescenceRate === "function" ? this.dna.senescenceRate() : 0;
    const sB =
      typeof partner.dna.senescenceRate === "function"
        ? partner.dna.senescenceRate()
        : 0;
    const aA = this.lifespan > 0 ? this.age / this.lifespan : 0;
    const aB = partner.lifespan > 0 ? partner.age / partner.lifespan : 0;
    const senPenalty = 1 - 0.5 * (sA * aA + sB * aB);

    return Math.min(
      0.95,
      Math.max(0.01, baseReproProb * reproMul * Math.max(0.2, senPenalty)),
    );
  }

  decideReproduction(partner, context = {}) {
    const {
      localDensity = 0,
      densityEffectMultiplier = 1,
      maxTileEnergy = MAX_TILE_ENERGY,
      baseProbability = 0.5,
      tileEnergy = null,
      tileEnergyDelta = 0,
    } = context;

    const sensors = this.#reproductionSensors(partner, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy,
      baseProbability,
      tileEnergy,
      tileEnergyDelta,
    });
    const values = this.#evaluateBrainGroup("reproduction", sensors);

    if (!values) {
      return { probability: baseProbability, usedNetwork: false };
    }

    const entries = OUTPUT_GROUPS.reproduction;
    const logits = entries.map(({ key }) => values[key] ?? 0);
    const probs = softmax(logits);
    const acceptIndex = entries.findIndex((entry) => entry.key === "accept");
    const yes = acceptIndex >= 0 ? clamp(probs[acceptIndex] ?? 0, 0, 1) : 0;
    const probability = clamp((baseProbability + yes) / 2, 0, 1);

    this.#assignDecisionOutcome("reproduction", {
      probability,
      usedNetwork: true,
      baseProbability,
      logits: entries.reduce((acc, { key }, idx) => {
        acc[key] = logits[idx] ?? 0;

        return acc;
      }, {}),
    });

    return { probability, usedNetwork: true };
  }

  #legacyChooseInteractionAction(localDensity = 0, densityEffectMultiplier = 1) {
    const { avoid, fight, cooperate } = this.interactionGenes;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const fightMul = lerp(this.density.fight.min, this.density.fight.max, effD);
    const coopMul = lerp(this.density.cooperate.max, this.density.cooperate.min, effD);
    const fightW = Math.max(0.0001, fight * fightMul);
    const coopW = Math.max(0.0001, cooperate * coopMul);
    const avoidW = Math.max(0.0001, avoid);
    const total = avoidW + fightW + coopW;
    const rng = this.resolveRng("legacyInteractionChoice");
    const roll = randomRange(0, total, rng);

    if (roll < avoidW) return "avoid";
    if (roll < avoidW + fightW) return "fight";

    return "cooperate";
  }

  chooseInteractionAction({
    localDensity = 0,
    densityEffectMultiplier = 1,
    enemies = [],
    allies = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const fallback = () =>
      this.#legacyChooseInteractionAction(localDensity, densityEffectMultiplier);
    const sensors = this.#interactionSensors({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies,
      maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    });
    const values = this.#evaluateBrainGroup("interaction", sensors);

    if (values) {
      const entries = OUTPUT_GROUPS.interaction;
      const logits = entries.map(({ key }) => values[key] ?? 0);
      const labels = entries.map(({ key }) => key);
      const probs = softmax(logits);
      const decisionRng = this.resolveRng("interactionDecision");
      const choice = sampleFromDistribution(probs, labels, decisionRng);
      const probabilitiesByKey = {};

      for (let i = 0; i < labels.length; i++) {
        probabilitiesByKey[labels[i]] = probs[i] ?? 0;
      }

      if (choice) {
        this.#assignDecisionOutcome("interaction", {
          action: choice,
          usedNetwork: true,
          probabilities: probabilitiesByKey,
          logits: entries.reduce((acc, { key }, idx) => {
            acc[key] = logits[idx] ?? 0;

            return acc;
          }, {}),
        });

        return choice;
      }

      this.#assignDecisionOutcome("interaction", {
        action: null,
        usedNetwork: true,
        probabilities: probabilitiesByKey,
        logits: entries.reduce((acc, { key }, idx) => {
          acc[key] = logits[idx] ?? 0;

          return acc;
        }, {}),
      });
    }

    const fallbackAction = fallback();

    this.#assignDecisionOutcome("interaction", {
      action: fallbackAction,
      usedNetwork: false,
    });

    return fallbackAction;
  }

  chooseEnemyTarget(enemies = [], { maxTileEnergy = MAX_TILE_ENERGY } = {}) {
    if (!Array.isArray(enemies) || enemies.length === 0) return null;

    const focus =
      typeof this.dna.conflictFocus === "function" ? this.dna.conflictFocus() : null;
    const weights = {
      weak: Math.max(0.0001, focus?.weak ?? 1),
      strong: Math.max(0.0001, focus?.strong ?? 1),
      proximity: Math.max(0.0001, focus?.proximity ?? 1),
      attrition: Math.max(0.0001, focus?.attrition ?? 1),
    };
    const energyCap = maxTileEnergy > 0 ? maxTileEnergy : MAX_TILE_ENERGY || 1;
    let decisionDetails = null;

    if (this.#canUseNeuralPolicies()) {
      const sensors = this.#targetingSensors(enemies, { maxTileEnergy });
      const values = this.#evaluateBrainGroup("targeting", sensors);

      if (values) {
        const entries = OUTPUT_GROUPS.targeting;
        const logits = entries.map(({ key }) => values[key] ?? 0);
        const probabilities = softmax(logits);
        const logitsByKey = {};
        const probabilitiesByKey = {};
        const fallbackTotal = Object.values(weights).reduce(
          (sum, value) => sum + Math.max(0, value),
          0,
        );
        const fallbackNormalized = fallbackTotal
          ? {
              weak: weights.weak / fallbackTotal,
              strong: weights.strong / fallbackTotal,
              proximity: weights.proximity / fallbackTotal,
              attrition: weights.attrition / fallbackTotal,
            }
          : { weak: 0.25, strong: 0.25, proximity: 0.25, attrition: 0.25 };
        const mapping = {
          focusWeak: "weak",
          focusStrong: "strong",
          focusProximity: "proximity",
          focusAttrition: "attrition",
        };
        const neuralNormalized = { ...fallbackNormalized };

        for (let i = 0; i < entries.length; i++) {
          const { key } = entries[i];

          logitsByKey[key] = logits[i] ?? 0;
          probabilitiesByKey[key] = probabilities[i] ?? 0;

          const mapped = mapping[key];

          if (!mapped) continue;

          neuralNormalized[mapped] = probabilities[i] ?? neuralNormalized[mapped];
        }

        const influence = 0.75;
        const combinedNormalized = {};

        for (const key of Object.keys(fallbackNormalized)) {
          const neuralValue = neuralNormalized[key] ?? fallbackNormalized[key];

          combinedNormalized[key] = lerp(
            fallbackNormalized[key],
            neuralValue,
            influence,
          );
        }

        const combinedTotal = Object.values(combinedNormalized).reduce(
          (sum, value) => sum + value,
          0,
        );
        const scaling =
          combinedTotal > 0 ? fallbackTotal / combinedTotal : fallbackTotal;

        for (const key of Object.keys(combinedNormalized)) {
          const normalized =
            combinedTotal > 0 ? combinedNormalized[key] / combinedTotal : 0.25;

          combinedNormalized[key] = normalized;
          weights[key] = Math.max(0.0001, normalized * (scaling || 1));
        }

        decisionDetails = {
          usedNetwork: true,
          probabilities: probabilitiesByKey,
          logits: logitsByKey,
          weights: { ...combinedNormalized },
        };
      }
    }

    let best = null;
    let bestScore = -Infinity;
    let chosenSummary = null;

    for (const enemy of enemies) {
      if (!enemy || !enemy.target) continue;

      const row = enemy.row ?? enemy.target.row ?? this.row;
      const col = enemy.col ?? enemy.target.col ?? this.col;
      const dist = Math.max(Math.abs(row - this.row), Math.abs(col - this.col));
      const enemyEnergy = Number.isFinite(enemy.target.energy)
        ? enemy.target.energy
        : 0;
      const diff = clamp(((this.energy ?? 0) - enemyEnergy) / energyCap, -1, 1);
      const weakSignal = clamp(1 + diff, 0.05, 1.95);
      const strongSignal = clamp(1 - diff, 0.05, 1.95);
      const proximitySignal = clamp(1 / (1 + (Number.isFinite(dist) ? dist : 0)), 0, 1);
      const attritionSignal = enemy.target.lifespan
        ? clamp((enemy.target.age ?? 0) / enemy.target.lifespan, 0, 1)
        : 0;
      const score =
        weights.weak * weakSignal +
        weights.strong * strongSignal +
        weights.proximity * proximitySignal +
        weights.attrition * attritionSignal;

      if (score > bestScore) {
        bestScore = score;
        best = enemy;
        const similarity = clamp(
          this.#safeSimilarityTo(enemy.target, {
            context: "targeting decision similarity ranking",
            fallback: 0,
          }),
          0,
          1,
        );

        chosenSummary = {
          row: enemy.row,
          col: enemy.col,
          energy: enemyEnergy,
          distance: Number.isFinite(dist) ? dist : null,
          similarity,
          attrition: attritionSignal,
        };
      }
    }

    if (!best && enemies.length > 0) {
      const fallbackRng = this.resolveRng("targetingFallback");
      const fallbackIndex = Math.floor(fallbackRng() * enemies.length);

      best = enemies[fallbackIndex];

      if (best?.target) {
        const row = best.row ?? best.target.row ?? this.row;
        const col = best.col ?? best.target.col ?? this.col;
        const dist = Math.max(Math.abs(row - this.row), Math.abs(col - this.col));
        const similarity = clamp(
          this.#safeSimilarityTo(best.target, {
            context: "targeting fallback similarity",
            fallback: 0,
          }),
          0,
          1,
        );

        chosenSummary = {
          row: best.row,
          col: best.col,
          energy: Number.isFinite(best.target.energy) ? best.target.energy : null,
          distance: Number.isFinite(dist) ? dist : null,
          similarity,
          attrition: best.target.lifespan
            ? clamp((best.target.age ?? 0) / best.target.lifespan, 0, 1)
            : null,
        };
      }
    }

    if (decisionDetails) {
      decisionDetails.chosen = chosenSummary;
      decisionDetails.candidateCount = enemies.length;
      this.#assignDecisionOutcome("targeting", decisionDetails);
    } else {
      this.#assignDecisionOutcome("targeting", {
        usedNetwork: false,
        weights: {
          weak: weights.weak,
          strong: weights.strong,
          proximity: weights.proximity,
          attrition: weights.attrition,
        },
        candidateCount: enemies.length,
        chosen: chosenSummary,
      });
    }

    return best ?? null;
  }

  applyEventEffects(
    row,
    col,
    currentEvent,
    eventStrengthMultiplier = 1,
    maxTileEnergy = 5,
  ) {
    const events = Array.isArray(currentEvent)
      ? currentEvent
      : currentEvent
        ? [currentEvent]
        : [];

    const { appliedEvents } = accumulateEventModifiers({
      events,
      row,
      col,
      eventStrengthMultiplier,
      isEventAffecting,
      getEventEffect,
    });

    if (appliedEvents.length === 0) {
      return;
    }

    const responseProfile =
      typeof this.dna.eventResponseProfile === "function"
        ? this.dna.eventResponseProfile()
        : null;
    const baseRecovery = clamp(this.dna.recoveryRate?.() ?? 0, 0, 1);
    const vigilance = clamp(responseProfile?.vigilance ?? 0.6, 0.2, 1.2);
    const mitigation = clamp(responseProfile?.drainMitigation ?? 0.4, 0, 0.95);
    const retention = clamp(responseProfile?.pressureRetention ?? 0.6, 0.05, 0.95);
    const rebound = clamp(responseProfile?.rebound ?? 0.15, 0, 0.8);
    const strengthScale = clamp(1 - baseRecovery * 0.35, 0.25, 1);
    let pressurePeak = 0;

    for (const { effect, strength } of appliedEvents) {
      if (!effect?.cell) continue;

      const effectiveStrength = clamp(strength * vigilance, 0, 1.5);
      const cellStrength = clamp(effectiveStrength * strengthScale, 0, 1.2);
      const { energyLoss = 0, resistanceGene } = effect.cell;
      const resistance = clamp(
        typeof resistanceGene === "string" &&
          typeof this.dna?.[resistanceGene] === "function"
          ? this.dna[resistanceGene]()
          : 0,
        0,
        1,
      );
      const mitigatedImpact = energyLoss * cellStrength * (1 - resistance);

      this.energy -= mitigatedImpact * (1 - mitigation);

      const pressureContribution = clamp(
        cellStrength * retention * (1 - mitigation * 0.5) * (1 - resistance * 0.3),
        0,
        1,
      );

      pressurePeak = Math.max(pressurePeak, pressureContribution);
    }

    const previousPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const dampenedPrevious = previousPressure * (1 - rebound);

    this.lastEventPressure = Math.max(dampenedPrevious, pressurePeak);
    this.energy = Math.max(0, Math.min(maxTileEnergy, this.energy));
  }

  createFightIntent({
    attackerRow = this.row,
    attackerCol = this.col,
    targetRow,
    targetCol,
  } = {}) {
    if (targetRow == null || targetCol == null) return null;

    return {
      type: "fight",
      initiator: {
        cell: this,
        row: attackerRow,
        col: attackerCol,
      },
      target: {
        row: targetRow,
        col: targetCol,
      },
    };
  }

  createCooperationIntent({
    row = this.row,
    col = this.col,
    targetRow,
    targetCol,
    targetCell = null,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    if (targetRow == null || targetCol == null) return null;
    const partner = targetCell ?? null;
    const capacity = maxTileEnergy > 0 ? maxTileEnergy : MAX_TILE_ENERGY;
    const selfEnergyNorm =
      capacity > 0 ? clamp((this.energy ?? 0) / capacity, 0, 1) : 0;
    const partnerEnergy = Number.isFinite(partner?.energy) ? partner.energy : null;
    const partnerNorm =
      partnerEnergy != null && Number.isFinite(partnerEnergy)
        ? clamp(partnerEnergy / capacity, 0, 1)
        : selfEnergyNorm;
    const kinship = clamp(
      this.#safeSimilarityTo(partner, {
        context: "cooperation intent kinship",
        fallback: 0,
      }),
      0,
      1,
    );
    const baseShare =
      typeof this.dna.cooperateShareFrac === "function"
        ? this.dna.cooperateShareFrac({
            energyDelta: partnerNorm - selfEnergyNorm,
            kinship,
          })
        : 0;
    const shareResolution = this.#resolveCooperationShareFraction({
      baseline: baseShare,
      selfEnergy: selfEnergyNorm,
      partnerEnergy: partnerNorm,
      kinship,
    });
    const shareFraction = shareResolution.share;

    this.#assignDecisionOutcome("interaction", {
      shareFraction,
      shareBaseline: shareResolution.baseShare,
      shareNeuralTarget:
        shareResolution.neuralTarget != null ? shareResolution.neuralTarget : null,
      shareNeuralMix: shareResolution.neuralMix ?? 0,
      shareNeuralSignal:
        shareResolution.neuralSignal != null ? shareResolution.neuralSignal : null,
    });

    return {
      type: "cooperate",
      initiator: {
        cell: this,
        row,
        col,
      },
      target: {
        row: targetRow,
        col: targetCol,
      },
      metadata: {
        shareFraction,
      },
    };
  }

  #resolveCooperationShareFraction({
    baseline = 0,
    selfEnergy = 0,
    partnerEnergy = 0,
    kinship = 0,
  } = {}) {
    const baseShare = clamp(Number.isFinite(baseline) ? baseline : 0, 0, 1);
    const outcome = this.#getDecisionOutcome("interaction");

    if (!outcome || outcome.usedNetwork !== true || outcome.action !== "cooperate") {
      return {
        share: baseShare,
        baseShare,
        neuralTarget: null,
        neuralMix: 0,
        neuralSignal: null,
      };
    }

    const probabilities =
      outcome.probabilities && typeof outcome.probabilities === "object"
        ? outcome.probabilities
        : null;
    const coopProbRaw = probabilities?.cooperate;
    const fightProbRaw = probabilities?.fight;
    const avoidProbRaw = probabilities?.avoid;
    let neuralSignal = Number.isFinite(coopProbRaw) ? clamp(coopProbRaw, 0, 1) : null;

    if (neuralSignal == null) {
      const logits =
        outcome.logits && typeof outcome.logits === "object" ? outcome.logits : null;
      const coopLogit = logits?.cooperate;

      if (Number.isFinite(coopLogit)) {
        const clamped = clamp(coopLogit, -12, 12);

        neuralSignal = 1 / (1 + Math.exp(-clamped));
      }
    }

    if (neuralSignal == null) {
      return {
        share: baseShare,
        baseShare,
        neuralTarget: null,
        neuralMix: 0,
        neuralSignal: null,
      };
    }

    const fightProb = Number.isFinite(fightProbRaw) ? clamp(fightProbRaw, 0, 1) : 0;
    const avoidProb = Number.isFinite(avoidProbRaw) ? clamp(avoidProbRaw, 0, 1) : 0;
    const competitorMax = Math.max(fightProb, avoidProb);
    const mix = clamp(0.35 + Math.max(0, neuralSignal - competitorMax) * 0.6, 0, 1);
    const kin = clamp(Number.isFinite(kinship) ? kinship : 0, 0, 1);
    const self = clamp(Number.isFinite(selfEnergy) ? selfEnergy : 0, 0, 1);
    const partner = clamp(Number.isFinite(partnerEnergy) ? partnerEnergy : 0, 0, 1);
    const energyDelta = clamp(partner - self, -1, 1);
    const needBoost = Math.max(0, energyDelta);
    const cautionDrag = Math.max(0, -energyDelta);
    const generosity = neuralSignal * (0.55 + kin * 0.35 + needBoost * 0.45);
    const target = clamp(generosity - cautionDrag * (1 - neuralSignal) * 0.25, 0, 1);
    const share = clamp(lerp(baseShare, target, mix), 0, 1);

    return {
      share,
      baseShare,
      neuralTarget: target,
      neuralMix: mix,
      neuralSignal,
    };
  }
}
