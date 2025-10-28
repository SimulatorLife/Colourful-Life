import DNA, { GENE_LOCI } from "./genome.js";
import Brain, { OUTPUT_GROUPS } from "./brain.js";
import { randomRange, clamp, clampFinite, lerp } from "./utils/math.js";
import { cloneTracePayload } from "./utils/object.js";
import { warnOnce } from "./utils/error.js";
import { accumulateEventModifiers } from "./events/eventModifiers.js";
import { createEventContext, defaultEventContext } from "./events/eventContext.js";
import {
  MAX_TILE_ENERGY,
  MUTATION_CHANCE_BASELINE,
  OFFSPRING_VIABILITY_BUFFER,
  REPRODUCTION_COOLDOWN_BASE,
} from "./config.js";

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

  const length = probabilities.length;
  const total = probabilities.reduce((sum, weight) => sum + weight, 0);

  if (!Number.isFinite(total) || total <= EPSILON) return null;

  const randomSource = typeof rng === "function" ? rng : Math.random;
  const threshold = randomSource() * total;
  let cumulative = 0;
  const selectedIndex = probabilities.findIndex((weight) => {
    cumulative += weight;

    return threshold <= cumulative + EPSILON;
  });

  if (selectedIndex !== -1) {
    return labels[selectedIndex] ?? selectedIndex;
  }

  const fallbackIndex = length - 1;

  return labels[fallbackIndex] ?? fallbackIndex;
}

function resolveEventContext(contextCandidate) {
  if (
    contextCandidate &&
    typeof contextCandidate.isEventAffecting === "function" &&
    typeof contextCandidate.getEventEffect === "function"
  ) {
    return contextCandidate;
  }

  if (contextCandidate && contextCandidate !== defaultEventContext) {
    return createEventContext(contextCandidate);
  }

  return defaultEventContext;
}

function resolveEffectCache(effectCacheCandidate) {
  if (
    effectCacheCandidate &&
    typeof effectCacheCandidate.get === "function" &&
    typeof effectCacheCandidate.set === "function"
  ) {
    return effectCacheCandidate;
  }

  return undefined;
}

export default class Cell {
  static chanceToMutate = MUTATION_CHANCE_BASELINE;
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
    this.combatLearningProfile =
      typeof this.dna.combatLearningProfile === "function"
        ? this.dna.combatLearningProfile()
        : null;
    this.eventAnticipationProfile =
      typeof this.dna.eventAnticipationProfile === "function"
        ? this.dna.eventAnticipationProfile()
        : null;
    this.opportunityProfile = this.neuralReinforcementProfile?.opportunity || null;
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
    this.reproductionReachProfile =
      typeof this.dna.reproductionReachProfile === "function"
        ? this.dna.reproductionReachProfile()
        : null;
    this.mateAffinityPlasticity =
      typeof this.dna.mateAffinityPlasticityProfile === "function"
        ? this.dna.mateAffinityPlasticityProfile()
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
    this._senescenceDebt = 0;
    this.resourceTrendAdaptation =
      typeof this.dna.resourceTrendAdaptation === "function"
        ? this.dna.resourceTrendAdaptation()
        : 0.35;
    this.foragingAdaptationProfile =
      typeof this.dna.foragingAdaptationProfile === "function"
        ? this.dna.foragingAdaptationProfile()
        : null;
    this._forageMemory = {
      scarcity: 0,
      crowd: 0,
      reserve: 0,
      reward: 0,
      efficiency: 0,
    };
    this._opportunitySignal = clamp(
      Number.isFinite(this.opportunityProfile?.baseline)
        ? this.opportunityProfile.baseline
        : 0,
      -1,
      1,
    );
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
    this._mateDiversityMemory = 0.5;
    this._mateNoveltyPressure = 0;
    this._mateDiversitySamples = 0;
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
    this._reproductionCooldown = 0;
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
    this.scarcityReliefProfile =
      typeof this.dna.scarcityReliefProfile === "function"
        ? this.dna.scarcityReliefProfile()
        : null;
    this.offspring = 0;
    this.fightsWon = 0;
    this.fightsLost = 0;
    this.matingAttempts = 0;
    this.matingSuccesses = 0;
    this.diverseMateScore = 0;
    this.similarityPenalty = 0;
    this.strategyPenalty = 0;
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
    const demandFracA = clamp(
      typeof parentA.dna?.offspringEnergyDemandFrac === "function"
        ? parentA.dna.offspringEnergyDemandFrac()
        : 0.22,
      0.05,
      0.85,
    );
    const demandFracB = clamp(
      typeof parentB.dna?.offspringEnergyDemandFrac === "function"
        ? parentB.dna.offspringEnergyDemandFrac()
        : 0.22,
      0.05,
      0.85,
    );
    const efficiencyA = clamp(
      typeof parentA.dna?.offspringEnergyTransferEfficiency === "function"
        ? parentA.dna.offspringEnergyTransferEfficiency()
        : 0.85,
      0.1,
      1,
    );
    const efficiencyB = clamp(
      typeof parentB.dna?.offspringEnergyTransferEfficiency === "function"
        ? parentB.dna.offspringEnergyTransferEfficiency()
        : 0.85,
      0.1,
      1,
    );
    const transferEfficiency = clamp((efficiencyA + efficiencyB) / 2, 0.1, 1);
    const viabilityFloor = Math.max(demandFracA, demandFracB);
    const viabilityBufferA = clamp(
      typeof parentA.dna?.offspringViabilityBuffer === "function"
        ? parentA.dna.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER)
        : OFFSPRING_VIABILITY_BUFFER,
      1,
      2,
    );
    const viabilityBufferB = clamp(
      typeof parentB.dna?.offspringViabilityBuffer === "function"
        ? parentB.dna.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER)
        : OFFSPRING_VIABILITY_BUFFER,
      1,
      2,
    );
    const viabilityBuffer = Math.max(viabilityBufferA, viabilityBufferB);
    // Require additional reserves beyond the pickier parent's floor.
    const viabilityThreshold = resolvedMaxTileEnergy * viabilityFloor * viabilityBuffer;
    const minimumTransfer = Math.max(transferEfficiency, 1e-6);
    const requiredTotalInvestment = viabilityThreshold / minimumTransfer;
    const fracFnA = parentA.dna?.parentalInvestmentFrac;
    const fracFnB = parentB.dna?.parentalInvestmentFrac;
    const investFracA = typeof fracFnA === "function" ? fracFnA.call(parentA.dna) : 0.4;
    const investFracB = typeof fracFnB === "function" ? fracFnB.call(parentB.dna) : 0.4;
    const weightSum = Math.max(1e-6, Math.abs(investFracA) + Math.abs(investFracB));
    const requiredShareA =
      requiredTotalInvestment * (Math.abs(investFracA) / weightSum);
    const requiredShareB =
      requiredTotalInvestment * (Math.abs(investFracB) / weightSum);
    const calculateInvestment = (
      parent,
      starvation,
      demandFrac,
      investFrac,
      requiredShare,
    ) => {
      const desiredBase = Math.max(
        0,
        Math.min(parent.energy, parent.energy * investFrac),
      );
      const targetEnergy = resolvedMaxTileEnergy * clampFinite(demandFrac, 0, 1, 0.22);
      const desired = Math.max(desiredBase, targetEnergy, requiredShare);
      const maxSpend = Math.max(0, parent.energy - starvation);

      return Math.min(desired, maxSpend);
    };
    const starvationA = parentA.starvationThreshold(resolvedMaxTileEnergy);
    const starvationB = parentB.starvationThreshold(resolvedMaxTileEnergy);
    const investA = calculateInvestment(
      parentA,
      starvationA,
      demandFracA,
      investFracA,
      requiredShareA,
    );
    const investB = calculateInvestment(
      parentB,
      starvationB,
      demandFracB,
      investFracB,
      requiredShareB,
    );

    if (investA <= 0 || investB <= 0) return null;

    const totalInvestment = investA + investB;
    const offspringEnergy = totalInvestment * transferEfficiency;

    if (offspringEnergy + EPSILON < viabilityThreshold) {
      return null;
    }

    parentA.energy = Math.max(0, parentA.energy - investA);
    parentB.energy = Math.max(0, parentB.energy - investB);
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
    if (typeof parentA.startReproductionCooldown === "function") {
      parentA.startReproductionCooldown();
    }
    if (typeof parentB.startReproductionCooldown === "function") {
      parentB.startReproductionCooldown();
    }

    return offspring;
  }

  similarityTo(other, options = undefined) {
    if (!other?.dna) return 0;

    return this.dna.similarity(other.dna, options);
  }

  getReproductionCooldown() {
    return Math.max(0, Math.round(this._reproductionCooldown || 0));
  }

  isReproductionCoolingDown() {
    return this.getReproductionCooldown() > 0;
  }

  startReproductionCooldown() {
    const baselineCandidate = Number.isFinite(REPRODUCTION_COOLDOWN_BASE)
      ? REPRODUCTION_COOLDOWN_BASE
      : 2;
    const baseline = Math.max(1, Math.round(baselineCandidate));
    const dnaCooldown =
      typeof this.dna?.reproductionCooldownTicks === "function"
        ? this.dna.reproductionCooldownTicks()
        : baseline;
    const normalized =
      Number.isFinite(dnaCooldown) && dnaCooldown > 0
        ? Math.round(dnaCooldown)
        : baseline;
    const duration = Math.max(baseline, normalized);

    this._reproductionCooldown = Math.max(this.getReproductionCooldown(), duration);
  }

  tickReproductionCooldown() {
    if (!this._reproductionCooldown) return;

    this._reproductionCooldown = Math.max(0, this._reproductionCooldown - 1);
  }

  reduceReproductionCooldown(amount = 0) {
    const relief = Math.max(0, Math.round(Number(amount)));

    if (!relief) return;

    this._reproductionCooldown = Math.max(0, this.getReproductionCooldown() - relief);
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
    let preferenceScore = similarPull + diversePull + curiosityBonus;

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
    let selectionWeight = Math.max(0.0001, weighted);

    const noveltyPressure = this.#resolveMateNoveltyPressure();

    if (noveltyPressure > 0.001) {
      const diversityMemory = this.#resolveMateDiversityMemory();
      const similarityOverlap = clamp(1 - Math.abs(diversity - diversityMemory), 0, 1);
      const noveltyGap = clamp(diversity - diversityMemory, 0, 1);
      const monotonyPenalty = similarityOverlap * noveltyPressure;
      const noveltyLift =
        noveltyGap * noveltyPressure * (0.3 + Math.max(0, appetite) * 0.4);
      const preferenceScale = clamp(1 - monotonyPenalty * 0.45, 0.2, 1.1);
      const weightScaleAdjusted = clamp(1 - monotonyPenalty * 0.55, 0.1, 1);

      preferenceScore =
        preferenceScore * preferenceScale +
        noveltyLift * (0.8 + Math.max(0, appetite) * 0.3);
      selectionWeight = Math.max(
        0.0001,
        selectionWeight * weightScaleAdjusted +
          noveltyLift * (0.6 + Math.max(0, appetite) * 0.4),
      );
      mate.noveltyPressure = noveltyPressure;
    }

    mate.similarity = similarity;
    mate.diversity = diversity;
    mate.appetite = appetite;
    mate.mateBias = bias;
    mate.curiosityBonus = curiosityBonus;
    mate.preferenceScore = preferenceScore;
    mate.selectionWeight = selectionWeight;

    return mate;
  }

  #resolveNeuralMateInfluence() {
    if (!this.#canUseNeuralPolicies()) return 0;

    const reinforcement = this.neuralReinforcementProfile || {};
    const samplingProfile = this.mateSamplingProfile || {};
    const reproductionWeight = clamp(
      Number.isFinite(reinforcement.reproductionWeight)
        ? reinforcement.reproductionWeight
        : 0.4,
      0,
      1.2,
    );
    const appetite = clamp(
      Number.isFinite(this.diversityAppetite) ? this.diversityAppetite : 0,
      0,
      1,
    );
    const samplingWeight = clamp(
      Number.isFinite(samplingProfile.neuralPreferenceWeight)
        ? samplingProfile.neuralPreferenceWeight
        : 0.6 + appetite * 0.25,
      0,
      1.5,
    );

    return clamp(reproductionWeight * samplingWeight, 0, 0.75);
  }

  #estimateNeuralMateAffinity(partner, context = {}) {
    if (!partner || !this.#canUseNeuralPolicies()) return null;

    const baseProbability = Number.isFinite(context.baseProbability)
      ? context.baseProbability
      : this.computeReproductionProbability(partner, context);
    const sensors = this.#reproductionSensors(partner, {
      ...context,
      baseProbability,
    });
    const preview = this.#previewBrainGroup("reproduction", sensors);

    if (!preview?.values) return null;

    const entries = OUTPUT_GROUPS.reproduction;
    const logits = entries.map(({ key }) => preview.values[key] ?? 0);
    const probs = softmax(logits);
    const acceptIndex = entries.findIndex((entry) => entry.key === "accept");
    const acceptProb = acceptIndex >= 0 ? clamp(probs[acceptIndex] ?? 0, 0, 1) : 0;
    const baseProb = clamp(
      Number.isFinite(baseProbability)
        ? baseProbability
        : (sensors.baseReproductionProbability ?? 0),
      0,
      1,
    );
    const { probability } = this.#blendReproductionProbability({
      baseProbability: baseProb,
      neuralProbability: acceptProb,
      sensors,
      evaluation: preview,
    });

    return probability;
  }

  scorePotentialMates(potentialMates = [], context = {}) {
    const scored = Array.isArray(this._mateScoreScratch)
      ? this._mateScoreScratch
      : (this._mateScoreScratch = []);

    scored.length = 0;

    if (!Array.isArray(potentialMates) || potentialMates.length === 0) {
      return scored;
    }

    const parentRow = Number.isFinite(context?.parentRow)
      ? context.parentRow
      : Number.isFinite(this.row)
        ? this.row
        : null;
    const parentCol = Number.isFinite(context?.parentCol)
      ? context.parentCol
      : Number.isFinite(this.col)
        ? this.col
        : null;
    const applyDistancePenalty = parentRow != null && parentCol != null;
    const neuralInfluence = this.#resolveNeuralMateInfluence();
    const applyNeuralLift = neuralInfluence > 0;
    const safeMinWeight = 0.0001;
    const shouldComputeBaseProbability =
      applyNeuralLift || Boolean(context?.precomputeBaseProbability);

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

      if (evaluated) {
        const target = evaluated.target;
        let baseProbability = null;

        if (!shouldComputeBaseProbability) {
          if (Object.hasOwn(evaluated, "baseReproductionProbability")) {
            evaluated.baseReproductionProbability = undefined;
          }

          if (Object.hasOwn(evaluated, "neuralAffinity")) {
            evaluated.neuralAffinity = undefined;
          }
        }

        if (target && shouldComputeBaseProbability) {
          const cachedBase = Number.isFinite(evaluated.baseReproductionProbability)
            ? evaluated.baseReproductionProbability
            : null;

          baseProbability = cachedBase;

          if (!Number.isFinite(baseProbability)) {
            const resolvedBase = this.computeReproductionProbability(target, context);

            if (Number.isFinite(resolvedBase)) {
              baseProbability = clamp(resolvedBase, 0, 1);
              evaluated.baseReproductionProbability = baseProbability;
            } else {
              baseProbability = null;
              evaluated.baseReproductionProbability = undefined;
            }
          }

          if (applyNeuralLift) {
            const neuralAffinity = this.#estimateNeuralMateAffinity(target, {
              ...context,
              baseProbability,
            });

            if (Number.isFinite(neuralAffinity)) {
              evaluated.neuralAffinity = clamp(neuralAffinity, 0, 1);
            } else if (Object.hasOwn(evaluated, "neuralAffinity")) {
              evaluated.neuralAffinity = undefined;
            }
          }
        }

        if (applyNeuralLift && Number.isFinite(evaluated?.neuralAffinity)) {
          const baseWeight = evaluated.selectionWeight;
          const normalizedBase = Number.isFinite(baseWeight)
            ? Math.max(safeMinWeight, baseWeight)
            : safeMinWeight;
          const neuralSignal = evaluated.neuralAffinity;
          const neuralLift = Math.max(
            safeMinWeight,
            normalizedBase * 0.5 + neuralSignal,
          );
          const blended = lerp(normalizedBase, neuralLift, neuralInfluence);

          evaluated.selectionWeight = Math.max(safeMinWeight, blended);
        }

        if (applyDistancePenalty) {
          const targetRow = Number.isFinite(mate.row)
            ? mate.row
            : Number.isFinite(mate.target?.row)
              ? mate.target.row
              : parentRow;
          const targetCol = Number.isFinite(mate.col)
            ? mate.col
            : Number.isFinite(mate.target?.col)
              ? mate.target.col
              : parentCol;
          const separation = Math.max(
            Math.abs(targetRow - parentRow),
            Math.abs(targetCol - parentCol),
          );

          if (Number.isFinite(separation) && separation > 1) {
            const offset = separation - 1;
            const weightScale = 1 / (1 + offset * 0.5);

            evaluated.selectionWeight = Math.max(
              0.0001,
              (evaluated.selectionWeight || 0.0001) * weightScale,
            );

            if (typeof evaluated.preferenceScore === "number") {
              evaluated.preferenceScore -= offset * 0.1;
            } else {
              evaluated.preferenceScore = -offset * 0.1;
            }
          }
        }

        scored.push(evaluated);
      }
    }

    return scored;
  }

  selectMateWeighted(potentialMates = [], context = {}, scoredCandidates = null) {
    const scored = Array.isArray(scoredCandidates)
      ? scoredCandidates
      : this.scorePotentialMates(potentialMates, context);
    const evaluated = scored.filter((m) => m && m.selectionWeight > 0 && m.target);

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
      const selected = evaluated.find((candidate) => {
        roll -= Math.max(0, candidate.selectionWeight);

        return roll <= 0;
      });

      chosen = selected ?? evaluated[evaluated.length - 1];
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

  findBestMate(potentialMates, context = {}, scoredCandidates = null) {
    if (!Array.isArray(potentialMates) || potentialMates.length === 0) return null;

    const scored = Array.isArray(scoredCandidates)
      ? scoredCandidates
      : this.scorePotentialMates(potentialMates, context);

    if (!Array.isArray(scored) || scored.length === 0) {
      return this.#fallbackMateSelection(potentialMates);
    }

    return this.#selectHighestPreferenceMate(scored);
  }

  #resolveMateDiversityMemory() {
    const stored = this._mateDiversityMemory;

    if (!Number.isFinite(stored)) {
      return 0.5;
    }

    return clamp(stored, 0, 1);
  }

  #resolveMateNoveltyPressure() {
    const stored = this._mateNoveltyPressure;

    if (!Number.isFinite(stored) || stored <= 0) {
      return 0;
    }

    return clamp(stored, 0, 1);
  }

  #updateMateDiversityDynamics({
    diversity = 0,
    success = false,
    penalized = false,
    penaltyMultiplier = 1,
    strategyPenaltyMultiplier = 1,
    diversityOpportunity = 0,
    diversityOpportunityWeight = 0,
    diversityOpportunityAvailability = 0,
    diversityOpportunityGap = 0,
    diversityOpportunityAlignment = 0,
    diversityOpportunityMultiplier = 1,
  } = {}) {
    const observed = clampFinite(diversity, 0, 1);
    const previousMean = this.#resolveMateDiversityMemory();
    const smoothing = success ? 0.6 : 0.75;
    const nextMean = previousMean * smoothing + observed * (1 - smoothing);

    this._mateDiversityMemory = nextMean;
    this._mateDiversitySamples = Math.min(
      Number.isFinite(this._mateDiversitySamples) ? this._mateDiversitySamples + 1 : 1,
      Number.MAX_SAFE_INTEGER,
    );

    const monotonyGap = clamp(0.45 - observed, 0, 1);
    const penaltyDrag = clamp(1 - (penaltyMultiplier ?? 1), 0, 1);
    const strategyDrag = clamp(1 - (strategyPenaltyMultiplier ?? 1), 0, 1);
    const opportunitySignal = clamp(
      Number.isFinite(diversityOpportunity) ? diversityOpportunity : 0,
      0,
      1,
    );
    const opportunityWeight = clamp(
      Number.isFinite(diversityOpportunityWeight) ? diversityOpportunityWeight : 0,
      0,
      1,
    );
    const opportunityAvailability = clamp(
      Number.isFinite(diversityOpportunityAvailability)
        ? diversityOpportunityAvailability
        : 0,
      0,
      1,
    );
    const opportunityGap = clamp(
      Number.isFinite(diversityOpportunityGap) ? diversityOpportunityGap : 0,
      0,
      1,
    );
    const opportunityAlignmentValue = clamp(
      Number.isFinite(diversityOpportunityAlignment)
        ? diversityOpportunityAlignment
        : opportunityAvailability > 0
          ? clamp(1 - opportunityGap, 0, 1)
          : 0,
      0,
      1,
    );
    const opportunityMultiplier = clamp(
      Number.isFinite(diversityOpportunityMultiplier)
        ? diversityOpportunityMultiplier
        : 1,
      0,
      2,
    );
    const opportunityStrength =
      opportunitySignal *
      (0.55 + opportunityWeight * 0.3 + opportunityAvailability * 0.25) *
      (1 - opportunityAlignmentValue * 0.4);
    const previousPressure = this.#resolveMateNoveltyPressure();
    const decay = success ? 0.78 : penalized ? 0.82 : 0.88;
    let nextPressure = previousPressure * decay;

    if (success || penalized) {
      const baseWeight = success ? 0.65 : 0.45;

      nextPressure += monotonyGap * (baseWeight + penaltyDrag * 0.35);
    } else {
      nextPressure += monotonyGap * 0.25;
    }

    if (penaltyDrag > 0) {
      nextPressure += penaltyDrag * (0.2 + monotonyGap * 0.3);
    }

    if (strategyDrag > 0) {
      nextPressure += strategyDrag * (0.25 + monotonyGap * 0.25);
    }

    if (opportunityStrength > 0) {
      const opportunityRamp =
        0.18 + monotonyGap * (0.28 + opportunityAvailability * 0.1);

      nextPressure += opportunityStrength * opportunityRamp;
    }

    const noveltyRelief = clamp(Math.max(0, observed - previousMean), 0, 1);

    if (noveltyRelief > 0) {
      const reliefScale = 0.5 + observed * 0.3 + opportunityAvailability * 0.2;

      nextPressure *= 1 - noveltyRelief * reliefScale;
    }

    if (opportunityAlignmentValue > 0) {
      const alignmentRelief =
        opportunityAlignmentValue * (0.22 + opportunityAvailability * 0.35);

      nextPressure *= 1 - clamp(alignmentRelief, 0, 0.75);
    }

    if (opportunityMultiplier > 1) {
      const multiplierRelief =
        Math.min(opportunityMultiplier - 1, 1) *
        (0.18 + opportunityAlignmentValue * 0.3 + opportunityAvailability * 0.2);

      nextPressure *= 1 - clamp(multiplierRelief, 0, 0.6);
    } else if (opportunityMultiplier < 1) {
      const multiplierDemand =
        (1 - opportunityMultiplier) * (0.12 + opportunityGap * 0.25);

      nextPressure += multiplierDemand;
    }

    this._mateNoveltyPressure = clamp(nextPressure, 0, 1);
  }

  #imprintMateAffinityExperience({
    diversity = 0,
    success = false,
    penalized = false,
    penaltyMultiplier = 1,
    behaviorComplementarity = 0,
    diversityOpportunity = 0,
    sensorVector = null,
    activationCount = 0,
  } = {}) {
    const brain = this.brain;

    if (
      !brain ||
      !brain.sensorPlasticity?.enabled ||
      typeof brain.applyExperienceImprint !== "function"
    ) {
      return;
    }

    const profile = this.mateAffinityPlasticity || {};
    const baseAssimilation = clamp(
      Number.isFinite(profile.assimilation) ? profile.assimilation : 0.28,
      0.01,
      0.9,
    );
    const successWeight = clamp(
      Number.isFinite(profile.successWeight) ? profile.successWeight : 0.6,
      0,
      1.5,
    );
    const penaltyWeight = clamp(
      Number.isFinite(profile.penaltyWeight) ? profile.penaltyWeight : 0.5,
      0,
      1.5,
    );
    const opportunityWeight = clamp(
      Number.isFinite(profile.opportunityWeight) ? profile.opportunityWeight : 0.4,
      0,
      1.5,
    );
    const complementWeight = clamp(
      Number.isFinite(profile.complementWeight) ? profile.complementWeight : 0.3,
      0,
      1.5,
    );
    const gainInfluence = clamp(
      Number.isFinite(profile.gainInfluence) ? profile.gainInfluence : 0.35,
      0,
      1,
    );

    const diversityClamped = clampFinite(diversity, 0, 1);
    const similarity = clamp(1 - diversityClamped, 0, 1);
    const complementarity = clamp(
      Number.isFinite(behaviorComplementarity) ? behaviorComplementarity : 0,
      0,
      1,
    );
    const opportunity = clamp(
      Number.isFinite(diversityOpportunity) ? diversityOpportunity : 0,
      0,
      1,
    );
    const penaltyMagnitude = penalized
      ? clamp(1 - (Number.isFinite(penaltyMultiplier) ? penaltyMultiplier : 1), 0, 1)
      : 0;

    const adjustments = [];

    if (success) {
      const assimilation = clamp(
        baseAssimilation * (0.6 + successWeight * 0.4),
        0.01,
        1,
      );
      const similarityTarget = clamp(similarity * 2 - 1, -1, 1);
      const similarityGainBlend = clamp(0.3 + successWeight * 0.3, 0, 1);

      adjustments.push({
        sensor: "partnerSimilarity",
        target: similarityTarget,
        assimilation,
        gainInfluence,
        gainBlend: similarityGainBlend,
      });
      adjustments.push({
        sensor: "mateSimilarity",
        target: similarityTarget,
        assimilation: assimilation * 0.85,
        gainInfluence,
        gainBlend: clamp(similarityGainBlend * 0.8, 0, 1),
      });
      adjustments.push({
        sensor: "allySimilarity",
        target: similarityTarget,
        assimilation: assimilation * 0.65,
        gainInfluence: gainInfluence * 0.5,
        gainBlend: clamp(similarityGainBlend * 0.5, 0, 1),
      });

      if (complementarity > 0 && complementWeight > 0) {
        adjustments.push({
          sensor: "allyFraction",
          target: clamp(complementarity * 2 - 1, -1, 1),
          assimilation: assimilation * complementWeight * 0.4,
          gainInfluence: gainInfluence * 0.45,
        });
      }
    }

    if (penaltyMagnitude > 0 && penaltyWeight > 0) {
      const assimilation = clamp(
        baseAssimilation * (0.4 + penaltyWeight * 0.5),
        0.01,
        1,
      );
      const penaltyShift = clamp(penaltyMagnitude * penaltyWeight, 0, 1);
      const penaltyTarget = clamp((similarity - penaltyShift) * 2 - 1, -1, 1);

      adjustments.push({
        sensor: "partnerSimilarity",
        target: penaltyTarget,
        assimilation,
        gainInfluence: gainInfluence * 0.6,
        gainShift: -penaltyShift * 0.35,
      });
      adjustments.push({
        sensor: "mateSimilarity",
        target: penaltyTarget,
        assimilation: assimilation * 0.9,
        gainInfluence: gainInfluence * 0.6,
      });
    }

    if ((success || opportunity > 0) && opportunityWeight > 0) {
      const assimilation = clamp(
        baseAssimilation * (0.45 + opportunityWeight * 0.55),
        0.01,
        1,
      );
      const target = clamp(opportunity * (success ? 1 : 0.6) * 2 - 1, -1, 1);

      adjustments.push({
        sensor: "opportunitySignal",
        target,
        assimilation,
        gainInfluence: gainInfluence * 0.5,
      });
    }

    if (adjustments.length === 0) return;

    brain.applyExperienceImprint({
      adjustments,
      assimilation: baseAssimilation,
      gainInfluence,
    });

    if (
      typeof brain.applySensorFeedback === "function" &&
      sensorVector &&
      typeof sensorVector.length === "number" &&
      sensorVector.length > 0
    ) {
      const activation = Number.isFinite(activationCount) ? activationCount : 0;
      const reward = success
        ? clamp(diversityClamped * (0.4 + successWeight * 0.3), -1, 1)
        : -penaltyMagnitude * (0.3 + penaltyWeight * 0.4);

      if (Math.abs(reward) > 1e-4) {
        brain.applySensorFeedback({
          sensorVector,
          activationCount: activation,
          rewardSignal: clamp(reward, -1, 1),
          energyCost: 0,
          fatigueDelta: 0,
          maxTileEnergy: MAX_TILE_ENERGY,
        });
      }
    }
  }

  recordForageOutcome({
    energyAfter = this.energy,
    intake = 0,
    expectedDemand = 0,
    availableEnergyBefore = 0,
    crowdPenalty = 1,
    density = 0,
    tileEnergyBefore = 0,
    tileEnergyAfter = 0,
    tileEnergyDelta = null,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const profile = this.foragingAdaptationProfile || {};
    const assimilation = clamp(
      Number.isFinite(profile.assimilation) ? profile.assimilation : 0.32,
      0.05,
      0.9,
    );
    const gainInfluence = clamp(
      Number.isFinite(profile.gainInfluence) ? profile.gainInfluence : 0.45,
      0,
      1,
    );
    const scarcityWeight = clamp(
      Number.isFinite(profile.scarcityWeight) ? profile.scarcityWeight : 0.6,
      0,
      1.6,
    );
    const crowdWeight = clamp(
      Number.isFinite(profile.crowdWeight) ? profile.crowdWeight : 0.5,
      0,
      1.5,
    );
    const reserveWeight = clamp(
      Number.isFinite(profile.reserveWeight) ? profile.reserveWeight : 0.4,
      0,
      1.4,
    );
    const fatigueWeight = clamp(
      Number.isFinite(profile.fatigueWeight) ? profile.fatigueWeight : 0.35,
      0,
      1.4,
    );
    const rewardWeight = clamp(
      Number.isFinite(profile.rewardWeight) ? profile.rewardWeight : 0.55,
      0,
      1.5,
    );
    const volatility = clamp(
      Number.isFinite(profile.volatility) ? profile.volatility : 0.35,
      0,
      1.2,
    );
    const retention = clamp(
      Number.isFinite(profile.retention) ? profile.retention : 0.85,
      0.2,
      0.99,
    );
    const capacity = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const normalizedIntake = clamp(
      Number.isFinite(intake) ? intake / capacity : 0,
      0,
      1,
    );
    const normalizedDemand = clamp(
      Number.isFinite(expectedDemand) ? expectedDemand / capacity : 0,
      0,
      1,
    );
    const normalizedAvailable = clamp(
      Number.isFinite(availableEnergyBefore) ? availableEnergyBefore / capacity : 0,
      0,
      1,
    );
    const normalizedEnergyAfter = clamp(
      Number.isFinite(energyAfter) ? energyAfter / capacity : 0,
      0,
      1,
    );
    const normalizedDensity = clamp(Number.isFinite(density) ? density : 0, 0, 1);
    const tileBefore = clamp(
      Number.isFinite(tileEnergyBefore) ? tileEnergyBefore : normalizedAvailable,
      0,
      1,
    );
    const tileAfter = clamp(
      Number.isFinite(tileEnergyAfter)
        ? tileEnergyAfter
        : Math.max(0, tileBefore - normalizedIntake),
      0,
      1,
    );
    const resolvedTileDelta = clamp(
      tileEnergyDelta == null || Number.isNaN(tileEnergyDelta)
        ? tileAfter - tileBefore
        : tileEnergyDelta,
      -1,
      1,
    );
    const scarcitySignal = clamp(1 - tileAfter, 0, 1);
    const crowdPenaltyNorm = clamp(
      Number.isFinite(crowdPenalty) ? crowdPenalty : 1,
      0,
      1,
    );
    const crowdPressure = clamp(1 - crowdPenaltyNorm, 0, 1);
    const reserveSignal = clamp(1 - normalizedEnergyAfter, 0, 1);
    const expectationGap =
      normalizedDemand > 0
        ? clamp(
            (normalizedDemand - normalizedIntake) / Math.max(0.0001, normalizedDemand),
            -1,
            1,
          )
        : normalizedIntake > 0
          ? -1
          : 0;
    const rewardSignal = clamp(-expectationGap, -1, 1);
    const efficiencySignal = clamp(
      normalizedDemand > 0
        ? normalizedIntake / Math.max(0.0001, normalizedDemand)
        : normalizedIntake > 0
          ? 1
          : 0,
      0,
      2,
    );
    const fatigueSignal = clamp(
      crowdPressure * 0.6 +
        Math.max(0, normalizedDemand - normalizedIntake) * 0.4 +
        reserveSignal * 0.3,
      0,
      1,
    );
    const memory =
      this._forageMemory ||
      (this._forageMemory = {
        scarcity: 0,
        crowd: 0,
        reserve: 0,
        reward: 0,
        efficiency: 0,
      });
    const degrade = (value) => lerp(value, 0, 1 - retention);

    memory.scarcity = degrade(memory.scarcity);
    memory.crowd = degrade(memory.crowd);
    memory.reserve = degrade(memory.reserve);
    memory.reward = degrade(memory.reward);
    memory.efficiency = degrade(
      Number.isFinite(memory.efficiency) ? memory.efficiency : 0,
    );

    const blend = (current, target, weight, min = -1, max = 1) =>
      clamp(lerp(current, target, clamp(weight, 0, 1)), min, max);

    memory.scarcity = blend(
      memory.scarcity,
      scarcitySignal,
      assimilation * (0.5 + scarcityWeight * 0.4),
      0,
      1,
    );
    memory.crowd = blend(
      memory.crowd,
      crowdPressure,
      assimilation * (0.5 + crowdWeight * 0.4),
      0,
      1,
    );
    memory.reserve = blend(
      memory.reserve,
      reserveSignal,
      assimilation * (0.45 + reserveWeight * 0.35),
      0,
      1,
    );
    memory.reward = blend(
      memory.reward,
      rewardSignal,
      assimilation * (0.4 + rewardWeight * 0.35),
    );
    memory.efficiency = blend(
      Number.isFinite(memory.efficiency) ? memory.efficiency : efficiencySignal,
      clamp(efficiencySignal, 0, 1.5),
      assimilation * (0.35 + rewardWeight * 0.3),
      0,
      1.5,
    );

    const resourceTrend = this.#updateResourceSignal({
      tileEnergy: tileAfter,
      tileEnergyDelta: resolvedTileDelta,
    });

    if (this._riskMemory) {
      const resourceAlpha = clamp(assimilation * (0.35 + scarcityWeight * 0.3), 0, 1);
      const confidenceAlpha = clamp(assimilation * (0.28 + rewardWeight * 0.25), 0, 1);
      const fatigueAlpha = clamp(assimilation * (0.3 + fatigueWeight * 0.3), 0, 1);
      const resourceImpact = clamp(
        -scarcitySignal * 0.55 - expectationGap * 0.45,
        -1,
        1,
      );
      const confidenceImpact = clamp(
        rewardSignal * 0.6 + clamp(efficiencySignal, 0, 1) * 0.3 - crowdPressure * 0.35,
        -1,
        1,
      );
      const fatigueImpact = clamp(fatigueSignal * 2 - 1, -1, 1);

      this._riskMemory.resource = lerp(
        this._riskMemory.resource,
        resourceImpact,
        resourceAlpha,
      );
      this._riskMemory.confidence = lerp(
        this._riskMemory.confidence,
        confidenceImpact,
        confidenceAlpha,
      );
      this._riskMemory.fatigue = lerp(
        this._riskMemory.fatigue,
        fatigueImpact,
        fatigueAlpha,
      );
    }

    const brain = this.brain;

    if (
      brain &&
      brain.sensorPlasticity?.enabled &&
      typeof brain.applyExperienceImprint === "function"
    ) {
      const adjustments = [];
      const baseAssimilation = clamp(
        assimilation * (0.4 + volatility * 0.3),
        0.02,
        0.9,
      );
      const gainBase = clamp(gainInfluence * (0.55 + volatility * 0.25), 0, 1);
      const energyTarget = clamp(normalizedEnergyAfter * 2 - 1, -1, 1);
      const densityTarget = clamp(normalizedDensity * 2 - 1, -1, 1);
      const fatigueTarget = clamp(
        this.#currentNeuralFatigue() +
          (fatigueSignal - 0.5) * (0.35 + fatigueWeight * 0.25),
        0,
        1,
      );

      adjustments.push({
        sensor: "resourceTrend",
        target: clamp(resourceTrend + rewardSignal * 0.5 - scarcitySignal * 0.4, -1, 1),
        assimilation: baseAssimilation,
        gainInfluence: clamp(gainBase * (0.6 + scarcityWeight * 0.25), 0, 1),
        gainShift: clamp(
          rewardSignal * (0.3 + volatility * 0.2) - scarcitySignal * 0.2,
          -0.6,
          0.6,
        ),
      });

      adjustments.push({
        sensor: "effectiveDensity",
        target: densityTarget,
        assimilation: clamp(assimilation * (0.35 + crowdWeight * 0.4), 0.02, 0.8),
        gainInfluence: clamp(gainBase * (0.5 + crowdWeight * 0.3), 0, 1),
        gainShift: clamp(crowdPressure * (0.4 + volatility * 0.3), 0, 0.9),
      });

      adjustments.push({
        sensor: "energy",
        target: energyTarget,
        assimilation: clamp(assimilation * (0.3 + reserveWeight * 0.3), 0.01, 0.6),
        gainInfluence: clamp(gainBase * (0.4 + reserveWeight * 0.3), 0, 1),
      });

      if (fatigueWeight > 0.01) {
        adjustments.push({
          sensor: "neuralFatigue",
          target: clamp(fatigueTarget * 2 - 1, -1, 1),
          assimilation: clamp(assimilation * (0.25 + fatigueWeight * 0.3), 0.01, 0.55),
          gainInfluence: clamp(gainBase * (0.4 + fatigueWeight * 0.2), 0, 1),
        });
      }

      brain.applyExperienceImprint({
        adjustments,
        assimilation: baseAssimilation,
        gainInfluence: gainBase,
      });
    }
  }

  recordCombatOutcome({
    success = false,
    kinship = null,
    intensity = 1,
    winChance = null,
    energyCost = 0,
  } = {}) {
    const brain = this.brain;

    if (
      !brain ||
      typeof brain.applyExperienceImprint !== "function" ||
      !brain.sensorPlasticity?.enabled
    ) {
      return;
    }

    const profile = this.combatLearningProfile || {};
    const baseAssimilation = clamp(
      Number.isFinite(profile.baseAssimilation) ? profile.baseAssimilation : 0.28,
      0.05,
      0.9,
    );
    const successAmplifier = clamp(
      Number.isFinite(profile.successAmplifier) ? profile.successAmplifier : 0.55,
      0.1,
      1.5,
    );
    const failureAmplifier = clamp(
      Number.isFinite(profile.failureAmplifier) ? profile.failureAmplifier : 0.65,
      0.1,
      1.5,
    );
    const gainInfluence = clamp(
      Number.isFinite(profile.gainInfluence) ? profile.gainInfluence : 0.4,
      0,
      1,
    );
    const kinshipPenaltyWeight = clamp(
      Number.isFinite(profile.kinshipPenaltyWeight)
        ? profile.kinshipPenaltyWeight
        : 0.3,
      0,
      1.2,
    );
    const threatWeight = clamp(
      Number.isFinite(profile.threatWeight) ? profile.threatWeight : 0.6,
      0,
      1.4,
    );
    const weaknessWeight = clamp(
      Number.isFinite(profile.weaknessWeight) ? profile.weaknessWeight : 0.6,
      0,
      1.4,
    );
    const attritionWeight = clamp(
      Number.isFinite(profile.attritionWeight) ? profile.attritionWeight : 0.5,
      0,
      1.2,
    );
    const proximityWeight = clamp(
      Number.isFinite(profile.proximityWeight) ? profile.proximityWeight : 0.45,
      0,
      1.2,
    );
    const riskFlexWeight = clamp(
      Number.isFinite(profile.riskFlexWeight) ? profile.riskFlexWeight : 0.55,
      0,
      1.3,
    );

    const intensityScale = clamp(Number.isFinite(intensity) ? intensity : 1, 0, 2);
    const expectation = clamp(Number.isFinite(winChance) ? winChance : 0.5, 0, 1);
    const kinshipClamped = clamp(Number.isFinite(kinship) ? kinship : 0, 0, 1);
    const kinPenalty = kinshipClamped * kinshipPenaltyWeight;
    const successBias = clamp(1 - expectation, 0, 1);
    const failurePressure = clamp(expectation + kinPenalty, 0, 2);

    const assimilationFactor = success
      ? clamp(
          baseAssimilation *
            (0.65 + successAmplifier * 0.35) *
            (0.7 + intensityScale * 0.15),
          0.05,
          0.95,
        )
      : clamp(
          baseAssimilation *
            (0.65 + failureAmplifier * 0.35) *
            (0.7 + intensityScale * 0.15),
          0.05,
          0.95,
        );

    const gainBase = clamp(gainInfluence * (0.65 + intensityScale * 0.1), 0, 1);

    const targetingContext = this._decisionContextIndex?.get("targeting") ?? null;
    const interactionContext = this._decisionContextIndex?.get("interaction") ?? null;

    const readSensor = (key, context) => {
      if (!context) return Number.NaN;
      const index = Brain.sensorIndex(key);

      if (!Number.isFinite(index)) return Number.NaN;

      const vector = context.sensorVector;

      if (vector && typeof vector.length === "number" && index < vector.length) {
        const value = vector[index];

        if (Number.isFinite(value)) {
          return clamp(value, -1, 1);
        }
      }

      if (context.sensors && Number.isFinite(context.sensors[key])) {
        return clamp(context.sensors[key], -1, 1);
      }

      return Number.NaN;
    };

    const adjustments = [];

    const adjustTowards = (key, weight, targetValue) => {
      if (!Number.isFinite(weight) || weight <= 0) return;
      if (!Number.isFinite(targetValue)) return;

      adjustments.push({
        sensor: key,
        target: clamp(targetValue, -1, 1),
        assimilation: clamp(assimilationFactor * (0.5 + weight * 0.4), 0.03, 0.95),
        gainInfluence: clamp(gainBase * (0.4 + weight * 0.5), 0, 1),
      });
    };

    const weaknessValue = readSensor("targetWeakness", targetingContext);

    if (Number.isFinite(weaknessValue) && weaknessWeight > 0) {
      const opportunityBoost = success
        ? (0.25 + successBias * 0.35 + intensityScale * 0.2) * 0.5
        : (0.3 + failurePressure * 0.2) * 0.5;
      const desired = weaknessValue + (1 - weaknessValue) * opportunityBoost;

      adjustTowards("targetWeakness", weaknessWeight, desired);
    }

    const threatValue = readSensor("targetThreat", targetingContext);

    if (Number.isFinite(threatValue) && threatWeight > 0) {
      const threatAdjustment = success
        ? threatValue + (successBias * 0.2 - kinPenalty * 0.25) * threatWeight * 0.3
        : threatValue - (Math.abs(threatValue) + 0.25) * (0.35 + failurePressure * 0.3);

      adjustTowards("targetThreat", threatWeight, threatAdjustment);
    }

    const attritionValue = readSensor("targetAttrition", targetingContext);

    if (Number.isFinite(attritionValue) && attritionWeight > 0) {
      const attritionAdjustment = success
        ? attritionValue + successBias * attritionWeight * 0.2
        : attritionValue -
          (Math.abs(attritionValue) + 0.2) * (0.3 + failurePressure * 0.25);

      adjustTowards("targetAttrition", attritionWeight, attritionAdjustment);
    }

    const proximityValue = readSensor("targetProximity", targetingContext);

    if (Number.isFinite(proximityValue) && proximityWeight > 0) {
      const proximityAdjustment = success
        ? proximityValue + successBias * proximityWeight * 0.15
        : proximityValue -
          (Math.abs(proximityValue) + 0.15) * (0.25 + failurePressure * 0.2);

      adjustTowards("targetProximity", proximityWeight, proximityAdjustment);
    }

    const riskValueRaw = readSensor("riskTolerance", interactionContext);
    const riskValue = Number.isFinite(riskValueRaw)
      ? riskValueRaw
      : clamp(this.#resolveRiskTolerance(), -1, 1);

    if (riskFlexWeight > 0) {
      const riskAdjustment = success
        ? riskValue +
          Math.max(0, (0.12 + successBias * 0.18 - kinPenalty * 0.2) * riskFlexWeight)
        : riskValue - (0.18 + failurePressure * 0.3) * riskFlexWeight;

      adjustTowards("riskTolerance", riskFlexWeight, riskAdjustment);
    }

    if (adjustments.length === 0) return;

    brain.applyExperienceImprint({
      adjustments,
      assimilation: assimilationFactor,
      gainInfluence: gainBase,
    });

    if (typeof brain.applySensorFeedback === "function") {
      const rewardContext = interactionContext || targetingContext;
      const sensorVector = rewardContext?.sensorVector;

      if (sensorVector && sensorVector.length > 0) {
        const rewardBase = success
          ? (0.32 + successBias * 0.4 - kinPenalty * 0.25) *
            (0.7 + intensityScale * 0.3)
          : -(0.38 + failurePressure * 0.35 + kinPenalty * 0.25) *
            (0.7 + intensityScale * 0.3);
        const rewardSignal = clamp(rewardBase, -1, 1);
        const activationCount = Number.isFinite(rewardContext?.activationCount)
          ? rewardContext.activationCount
          : 0;
        const normalizedEnergyCost = Number.isFinite(energyCost)
          ? Math.max(0, energyCost)
          : 0;

        if (Math.abs(rewardSignal) > 1e-4) {
          brain.applySensorFeedback({
            group: rewardContext.group,
            sensorVector,
            activationCount,
            energyCost: normalizedEnergyCost,
            fatigueDelta: 0,
            rewardSignal,
            maxTileEnergy: MAX_TILE_ENERGY,
          });
        }
      }
    }
  }

  recordMatingOutcome({
    diversity = 0,
    success = false,
    penalized = false,
    penaltyMultiplier = 1,
    strategyPenaltyMultiplier = 1,
    behaviorComplementarity = 0,
    diversityOpportunity = 0,
    diversityOpportunityWeight = 0,
    diversityOpportunityAvailability = 0,
    diversityOpportunityGap = 0,
    diversityOpportunityAlignment = 0,
    diversityOpportunityMultiplier = 1,
  } = {}) {
    this.matingAttempts = (this.matingAttempts || 0) + 1;

    if (success) {
      this.matingSuccesses = (this.matingSuccesses || 0) + 1;
      this.diverseMateScore =
        (this.diverseMateScore || 0) + clamp(diversity ?? 0, 0, 1);
      this.complementaryMateScore =
        (this.complementaryMateScore || 0) + clamp(behaviorComplementarity ?? 0, 0, 1);
    }

    const penaltyDrag = clamp(1 - (penaltyMultiplier ?? 1), 0, 1);

    if (penalized && penaltyDrag > 0) {
      this.similarityPenalty = (this.similarityPenalty || 0) + penaltyDrag;
    }

    const strategyDrag = clamp(1 - (strategyPenaltyMultiplier ?? 1), 0, 1);

    if (strategyDrag > 0) {
      this.strategyPenalty = (this.strategyPenalty || 0) + strategyDrag;
    }

    const opportunitySignal = clamp(
      Number.isFinite(diversityOpportunity) ? diversityOpportunity : 0,
      0,
      1,
    );
    const opportunityWeightValue = clamp(
      Number.isFinite(diversityOpportunityWeight) ? diversityOpportunityWeight : 0,
      0,
      1,
    );
    const opportunityAvailabilityValue = clamp(
      Number.isFinite(diversityOpportunityAvailability)
        ? diversityOpportunityAvailability
        : 0,
      0,
      1,
    );
    const opportunityGapValue = clamp(
      Number.isFinite(diversityOpportunityGap) ? diversityOpportunityGap : 0,
      0,
      1,
    );
    const opportunityAlignmentValue = clamp(
      Number.isFinite(diversityOpportunityAlignment)
        ? diversityOpportunityAlignment
        : opportunityAvailabilityValue > 0
          ? clamp(1 - opportunityGapValue, 0, 1)
          : 0,
      0,
      1,
    );
    const opportunityMultiplierValue = clamp(
      Number.isFinite(diversityOpportunityMultiplier)
        ? diversityOpportunityMultiplier
        : 1,
      0,
      2,
    );
    const opportunityPresent =
      opportunitySignal > 0 ||
      opportunityAvailabilityValue > 0 ||
      opportunityWeightValue > 0 ||
      opportunityGapValue > 0 ||
      opportunityMultiplierValue !== 1;

    if (opportunityPresent) {
      const weightedPresence =
        opportunitySignal * 0.45 +
        opportunityAvailabilityValue * 0.35 +
        opportunityWeightValue * 0.2;
      const gapDemand = opportunityGapValue * 0.15;
      const multiplierDemand =
        opportunityMultiplierValue > 1
          ? Math.min(opportunityMultiplierValue - 1, 1) * 0.25
          : (1 - opportunityMultiplierValue) * 0.2;
      const sampleWeight = clamp(
        weightedPresence + gapDemand + multiplierDemand,
        0.05,
        1,
      );

      this.diversityOpportunitySamples =
        (this.diversityOpportunitySamples || 0) + sampleWeight;

      const alignmentContribution =
        opportunityAlignmentValue * sampleWeight * (success ? 1 : 0.5);

      if (alignmentContribution > 0) {
        this.diversityOpportunityAlignmentScore =
          (this.diversityOpportunityAlignmentScore || 0) + alignmentContribution;
      }

      let neglect = 0;

      if (!success) {
        neglect += (1 - opportunityAlignmentValue) * sampleWeight;
      } else if (opportunityAlignmentValue < 0.75 && opportunityGapValue > 0) {
        neglect += (1 - opportunityAlignmentValue) * opportunityGapValue * sampleWeight;
      }

      if (penaltyDrag > 0) {
        neglect += penaltyDrag * 0.5 * sampleWeight;
      }

      if (strategyDrag > 0) {
        neglect += strategyDrag * 0.35 * sampleWeight;
      }

      if (neglect > 0) {
        this.diversityOpportunityNeglectScore =
          (this.diversityOpportunityNeglectScore || 0) + neglect;
      }
    }

    this.#updateMateDiversityDynamics({
      diversity,
      success,
      penalized,
      penaltyMultiplier,
      strategyPenaltyMultiplier,
      diversityOpportunity,
      diversityOpportunityWeight,
      diversityOpportunityAvailability,
      diversityOpportunityGap,
      diversityOpportunityAlignment,
      diversityOpportunityMultiplier,
    });

    const reproductionContext = this._decisionContextIndex?.get("reproduction");

    this.#imprintMateAffinityExperience({
      diversity,
      success,
      penalized,
      penaltyMultiplier,
      behaviorComplementarity,
      diversityOpportunity,
      sensorVector: reproductionContext?.sensorVector ?? null,
      activationCount: reproductionContext?.activationCount ?? 0,
    });
  }

  getMateNoveltyPressure() {
    return this.#resolveMateNoveltyPressure();
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
      trace: evaluation.trace ?? null,
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
    const normalizedBefore = clamp(
      (Number.isFinite(energyBefore) ? energyBefore : 0) / capacity,
      0,
      1,
    );
    const normalizedAfter = clamp(
      (Number.isFinite(energyAfter) ? energyAfter : 0) / capacity,
      0,
      1,
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
    const energyMidpoint = (normalizedBefore + normalizedAfter) / 2;
    const energyScarcity = clamp(1 - energyMidpoint, 0, 1);
    const survivalInstinct = clamp(profile.survivalInstinct ?? 0.5, 0, 1.5);
    const fertilityUrge = clamp(
      profile.fertilityUrge ?? profile.reproductionWeight ?? 0,
      0,
      1.5,
    );
    const survivalEnergyWeight =
      (profile.energyDeltaWeight ?? 0) * (1 + survivalInstinct * energyScarcity);
    const survivalCognitiveWeight =
      (profile.cognitiveCostWeight ?? 0) *
      (1 + survivalInstinct * energyScarcity * 0.5);

    let reward =
      normalizedEnergyDelta * survivalEnergyWeight -
      cognitiveCost * survivalCognitiveWeight +
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

      if (outcome.action === "rest") {
        reward += energyScarcity * survivalInstinct * (profile.restBoostWeight ?? 0.5);
      }
    } else if (group === "interaction") {
      const action = outcome.action;

      if (action && profile.interactionActions) {
        const pref = profile.interactionActions[action];

        if (Number.isFinite(pref)) {
          reward += (pref - 1 / 3) * (profile.interactionAlignmentWeight ?? 0);
        }
      }

      if (action === "fight" && energyScarcity > 0) {
        reward -= energyScarcity * survivalInstinct * 0.35;
      }
    } else if (group === "reproduction") {
      const probability = clamp(outcome.probability ?? 0, 0, 1);
      const baseProbability = clamp(
        outcome.baseProbability ?? sensors.baseReproductionProbability ?? 0,
        0,
        1,
      );
      const reproductionWeight = profile.reproductionWeight ?? 0;
      const reproductionEnergyFactor = clamp(
        0.45 +
          energyMidpoint * 0.55 +
          fertilityUrge * 0.25 -
          energyScarcity * survivalInstinct * 0.3,
        0.1,
        2,
      );

      reward +=
        (probability - baseProbability) * reproductionWeight * reproductionEnergyFactor;
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

    this.#updateOpportunitySignal({
      decisions,
      energyBefore,
      energyAfter,
      maxTileEnergy,
    });

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

  #normalizeSigned(value) {
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
    const resourceTrend = this.#normalizeSigned(resourceInfo.value);

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
    const momentumSignal = this.#normalizeSigned(momentumInfo.value);

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

    if (
      this.brain &&
      this.brain.sensorPlasticity?.enabled &&
      typeof this.brain.applyExperienceImprint === "function"
    ) {
      const baseAssimilation = clamp(assimilation * 0.35, 0.015, 0.45);
      const resourceMemory = clamp(
        Number.isFinite(this._riskMemory.resource) ? this._riskMemory.resource : 0,
        -1,
        1,
      );
      const scarcityMemory = clamp(-resourceMemory, -1, 1);
      const eventMemory = clamp(
        Number.isFinite(this._riskMemory.event) ? this._riskMemory.event : 0,
        0,
        1,
      );
      const confidenceMemory = clamp(
        Number.isFinite(this._riskMemory.confidence) ? this._riskMemory.confidence : 0,
        -1,
        1,
      );
      const fatigueMemory = clamp(
        Number.isFinite(this._riskMemory.fatigue) ? this._riskMemory.fatigue : 0,
        -1,
        1,
      );
      const adjustments = [];

      if (Math.abs(resourceMemory) > 0.05) {
        const resourceAssimilation = clamp(
          Math.max(baseAssimilation, resourceAlpha * 0.6),
          0.015,
          0.6,
        );
        const energyAssimilation = clamp(
          Math.max(baseAssimilation * 0.8, resourceAlpha * 0.45),
          0.01,
          0.5,
        );
        const energyUnit = clamp(0.5 + resourceMemory * 0.3, 0, 1);

        adjustments.push({
          sensor: "resourceTrend",
          target: resourceMemory,
          assimilation: resourceAssimilation,
        });
        adjustments.push({
          sensor: "energy",
          target: clamp(energyUnit * 2 - 1, -1, 1),
          assimilation: energyAssimilation,
        });
      }

      if (eventMemory > 0.05) {
        const eventAssimilation = clamp(
          Math.max(baseAssimilation * 0.85, eventAlpha * 0.65),
          0.01,
          0.5,
        );

        adjustments.push({
          sensor: "eventPressure",
          target: clamp(eventMemory * 2 - 1, -1, 1),
          assimilation: eventAssimilation,
        });
      }

      if (Math.abs(confidenceMemory) > 0.05) {
        const baseRisk = clamp(
          Number.isFinite(this.baseRiskTolerance) ? this.baseRiskTolerance : 0.5,
          0,
          1,
        );
        const adjustedRisk = clamp(
          baseRisk + confidenceMemory * 0.35 - Math.max(0, scarcityMemory) * 0.25,
          0,
          1,
        );
        const riskAssimilation = clamp(
          Math.max(baseAssimilation, confidenceAlpha * 0.55),
          0.015,
          0.5,
        );
        const opportunityAssimilation = clamp(
          Math.max(baseAssimilation * 0.7, confidenceAlpha * 0.45),
          0.01,
          0.45,
        );
        const momentumAssimilation = clamp(
          Math.max(baseAssimilation * 0.6, confidenceAlpha * 0.4),
          0.01,
          0.4,
        );

        adjustments.push({
          sensor: "riskTolerance",
          target: clamp(adjustedRisk * 2 - 1, -1, 1),
          assimilation: riskAssimilation,
        });
        adjustments.push({
          sensor: "opportunitySignal",
          target: clamp(confidenceMemory - scarcityMemory * 0.25, -1, 1),
          assimilation: opportunityAssimilation,
        });
        adjustments.push({
          sensor: "interactionMomentum",
          target: clamp(confidenceMemory * 0.6, -1, 1),
          assimilation: momentumAssimilation,
        });
      }

      if (Math.abs(fatigueMemory) > 0.05) {
        const fatigueAssimilation = clamp(
          Math.max(baseAssimilation * 0.8, fatigueAlpha * 0.5),
          0.01,
          0.45,
        );
        const fatigueUnit = clamp(0.5 + fatigueMemory * 0.25, 0, 1);

        adjustments.push({
          sensor: "neuralFatigue",
          target: clamp(fatigueUnit * 2 - 1, -1, 1),
          assimilation: fatigueAssimilation,
        });
      }

      if (adjustments.length > 0) {
        const scarcityDriveWeight = clamp(
          Number.isFinite(profile.scarcityDrive) ? profile.scarcityDrive : 0.35,
          0,
          1.5,
        );
        const eventWeight = clamp(
          Number.isFinite(profile.eventWeight) ? profile.eventWeight : 0.5,
          0,
          1.5,
        );
        const confidenceWeight = clamp(
          Number.isFinite(profile.confidenceWeight) ? profile.confidenceWeight : 0.3,
          0,
          1.2,
        );
        const fatigueWeight = clamp(
          Number.isFinite(profile.fatigueWeight) ? profile.fatigueWeight : 0.35,
          0,
          1.2,
        );
        const gainInfluence = clamp(
          (Math.abs(resourceMemory) * scarcityDriveWeight +
            eventMemory * eventWeight +
            Math.abs(confidenceMemory) * confidenceWeight +
            Math.abs(fatigueMemory) * fatigueWeight) /
            2.5,
          0,
          1,
        );

        this.brain.applyExperienceImprint({
          adjustments,
          assimilation: baseAssimilation,
          gainInfluence,
        });
      }
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

  #currentOpportunitySignal() {
    return clamp(
      Number.isFinite(this._opportunitySignal) ? this._opportunitySignal : 0,
      -1,
      1,
    );
  }

  #updateOpportunitySignal({
    decisions = [],
    energyBefore = this.energy,
    energyAfter = this.energy,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const profile = this.opportunityProfile;

    if (!profile) return;

    const assimilation = clamp(
      Number.isFinite(profile.assimilation) ? profile.assimilation : 0,
      0,
      1,
    );
    const decay = clamp(Number.isFinite(profile.decay) ? profile.decay : 0, 0, 1);
    const positiveWeight = clamp(
      Number.isFinite(profile.positiveWeight) ? profile.positiveWeight : 0.6,
      0.1,
      2,
    );
    const negativeWeight = clamp(
      Number.isFinite(profile.negativeWeight) ? profile.negativeWeight : 0.6,
      0.1,
      2,
    );
    const volatility = clamp(
      Number.isFinite(profile.volatility) ? profile.volatility : 0.3,
      0,
      2,
    );
    const baseline = clamp(
      Number.isFinite(profile.baseline) ? profile.baseline : 0,
      -1,
      1,
    );
    const synergyWeight = clamp(
      Number.isFinite(profile.synergyWeight) ? profile.synergyWeight : 0.3,
      0,
      1,
    );
    const groupWeights =
      profile.groupWeights && typeof profile.groupWeights === "object"
        ? profile.groupWeights
        : null;

    const current = clamp(
      Number.isFinite(this._opportunitySignal) ? this._opportunitySignal : baseline,
      -1,
      1,
    );
    const drifted = lerp(current, baseline, decay);

    let weightedSignal = 0;
    let totalWeight = 0;

    for (let i = 0; i < decisions.length; i++) {
      const decision = decisions[i];

      if (!decision || typeof decision !== "object") continue;

      const reward = Number.isFinite(decision.outcome?.rewardSignal)
        ? clamp(decision.outcome.rewardSignal, -1, 1)
        : 0;

      if (reward === 0) continue;

      const activationCount = Math.max(1, Number(decision.activationCount) || 0);
      let weight = 0.4;

      if (
        groupWeights &&
        decision.group &&
        typeof groupWeights[decision.group] === "number"
      ) {
        weight = clamp(groupWeights[decision.group], 0.05, 2);
      }

      const amplitude = reward > 0 ? positiveWeight : negativeWeight;
      const activationInfluence =
        1 + Math.max(0, activationCount - 1) * Math.min(volatility, 1) * 0.2;
      const scaledReward = clamp(reward * amplitude, -2, 2);
      const influence = Math.max(Math.abs(scaledReward), 0.05);
      const combinedWeight = weight * activationInfluence * influence;

      weightedSignal += scaledReward * combinedWeight;
      totalWeight += combinedWeight;
    }

    const normalized = totalWeight > 0 ? clamp(weightedSignal / totalWeight, -1, 1) : 0;
    const rewardTarget = clamp(drifted + normalized, -1, 1);
    const rewardAdjusted = lerp(drifted, rewardTarget, assimilation);

    const capacity = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const energyDelta = clamp(
      ((Number.isFinite(energyAfter) ? energyAfter : 0) -
        (Number.isFinite(energyBefore) ? energyBefore : 0)) /
        capacity,
      -1,
      1,
    );
    const energyTarget = clamp(rewardAdjusted + energyDelta, -1, 1);
    const finalSignal = lerp(rewardAdjusted, energyTarget, synergyWeight);

    this._opportunitySignal = clamp(finalSignal, -1, 1);
  }

  _reinforceEventAnticipation({
    previousPressure = 0,
    nextPressure = 0,
    pressurePeak = 0,
    energyDrain = 0,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const brain = this.brain;
    const hasImprint = typeof brain?.applyExperienceImprint === "function";
    const hasFeedback = typeof brain?.applySensorFeedback === "function";

    if (!hasImprint && !hasFeedback) {
      return;
    }

    const profile = this.eventAnticipationProfile || {};
    const assimilation = clamp(
      Number.isFinite(profile.assimilation) ? profile.assimilation : 0.35,
      0.01,
      1,
    );
    const reliefAssimilation = clamp(
      Number.isFinite(profile.relief) ? profile.relief : assimilation * 0.6,
      0.01,
      1,
    );
    const gainInfluence = clamp(
      Number.isFinite(profile.gainInfluence) ? profile.gainInfluence : 0.25,
      0,
      1,
    );
    const volatility = clamp(
      Number.isFinite(profile.volatility) ? profile.volatility : 0.4,
      0,
      1.5,
    );
    const baseline = clamp(
      Number.isFinite(profile.baseline) ? profile.baseline : 0,
      0,
      1,
    );
    const rewardScale = clamp(
      Number.isFinite(profile.rewardScale) ? profile.rewardScale : 0.5,
      0,
      2,
    );
    const fatigueWeight = clamp(
      Number.isFinite(profile.fatigueWeight) ? profile.fatigueWeight : 0.3,
      0,
      1.5,
    );

    const delta = clamp(nextPressure - previousPressure, -1, 1);
    const intensity = clamp(
      delta >= 0
        ? Math.max(delta, Math.max(0, pressurePeak - previousPressure))
        : Math.abs(delta),
      0,
      1.5,
    );
    const assimilationFactor = delta >= 0 ? assimilation : reliefAssimilation;

    if (hasImprint && assimilationFactor > 0) {
      const adjustments = [];
      const unitTarget = clamp(
        delta >= 0
          ? Math.min(1, nextPressure + intensity * volatility * 0.4)
          : Math.max(0, nextPressure - intensity * volatility * 0.3),
        0,
        1,
      );
      const directionalGain = delta >= 0 ? volatility : -volatility * 0.6;

      adjustments.push({
        sensor: "eventPressure",
        target: clamp(unitTarget * 2 - 1, -1, 1),
        assimilation: assimilationFactor,
        gainInfluence,
        gainShift: directionalGain * intensity * 0.35,
      });

      if (delta < 0 && baseline > 0) {
        adjustments.push({
          sensor: "eventPressure",
          target: clamp(baseline * 2 - 1, -1, 1),
          assimilation: Math.min(1, reliefAssimilation * 0.5),
          gainInfluence: gainInfluence * 0.5,
          gainBlend: 0.35,
        });
      }

      const capacity = Math.max(
        1e-4,
        Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
          ? maxTileEnergy
          : MAX_TILE_ENERGY || 1,
      );
      const drain = Math.max(0, Number.isFinite(energyDrain) ? energyDrain : 0);
      const normalizedDrain = clamp(drain / capacity, 0, 2);

      if (normalizedDrain > 0) {
        const trendShift = clamp(-normalizedDrain * (0.4 + volatility * 0.2), -1, 0);

        adjustments.push({
          sensor: "resourceTrend",
          target: trendShift,
          assimilation: Math.min(1, assimilationFactor * (0.5 + normalizedDrain * 0.4)),
          gainInfluence: Math.min(1, gainInfluence + normalizedDrain * 0.25),
          gainShift: -normalizedDrain * volatility * 0.2,
        });
      }

      brain.applyExperienceImprint({
        adjustments,
        assimilation: assimilationFactor,
        gainInfluence,
      });
    }

    if (hasFeedback) {
      const capacity = Math.max(
        1e-4,
        Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
          ? maxTileEnergy
          : MAX_TILE_ENERGY || 1,
      );
      const drain = Math.max(0, Number.isFinite(energyDrain) ? energyDrain : 0);
      const normalizedDrain = clamp(drain / capacity, 0, 2);
      const sensorVector = new Float32Array(Brain.SENSOR_COUNT);

      sensorVector[0] = 1;

      const setSensor = (key, value) => {
        const index = Brain.sensorIndex(key);

        if (Number.isFinite(index) && index >= 0 && index < sensorVector.length) {
          sensorVector[index] = clamp(value ?? 0, -1, 1);
        }
      };

      setSensor("eventPressure", clamp(nextPressure, 0, 1));
      setSensor("resourceTrend", clamp(this._resourceSignal ?? 0, -1, 1));

      const baselineFatigue = clamp(
        Number.isFinite(this.neuralFatigueProfile?.baseline)
          ? this.neuralFatigueProfile.baseline
          : 0.35,
        0,
        1,
      );
      const fatigue = clamp(
        Number.isFinite(this._neuralFatigue) ? this._neuralFatigue : baselineFatigue,
        0,
        1,
      );

      setSensor("neuralFatigue", fatigue);

      const reward = clamp(
        (delta >= 0 ? -1 : 1) * intensity * rewardScale - normalizedDrain * rewardScale,
        -2,
        2,
      );
      const fatigueDelta = -normalizedDrain * fatigueWeight;

      brain.applySensorFeedback({
        sensorVector,
        activationCount: Number.isFinite(brain.lastActivationCount)
          ? brain.lastActivationCount
          : 0,
        energyCost: drain,
        fatigueDelta,
        rewardSignal: reward,
        maxTileEnergy,
      });
    }
  }

  resolveTrait(traitName) {
    if (traitName === "riskTolerance") {
      return this.#resolveRiskTolerance();
    }

    return null;
  }

  #summarizeTargetSimilarity(list = []) {
    if (!Array.isArray(list) || list.length === 0) {
      return { similarity: 0, count: 0 };
    }

    let total = 0;
    let count = 0;

    for (let i = 0; i < list.length; i += 1) {
      const entry = list[i];
      const target = entry?.target;

      if (!target) continue;

      const similarity = this.#safeSimilarityTo(target, {
        context: "similarity summary aggregation",
        fallback: Number.NaN,
      });

      if (!Number.isFinite(similarity)) continue;

      total += similarity;
      count += 1;
    }

    return {
      similarity: count > 0 ? total / count : 0,
      count,
    };
  }

  #resolveDiversitySignalFromSummaries(...summaries) {
    let similarityTotal = 0;
    let sampleTotal = 0;

    for (let i = 0; i < summaries.length; i += 1) {
      const summary = summaries[i];

      if (!summary) continue;

      const count = Number.isFinite(summary.count) ? summary.count : 0;

      if (count <= 0) continue;

      const similarity = Number.isFinite(summary.similarity)
        ? clamp(summary.similarity, 0, 1)
        : 0;

      similarityTotal += similarity * count;
      sampleTotal += count;
    }

    if (sampleTotal <= 0) {
      return 0;
    }

    const averageSimilarity = similarityTotal / sampleTotal;

    return clamp(1 - averageSimilarity, 0, 1);
  }

  #estimateNeighborDiversity(neighbors = []) {
    if (!Array.isArray(neighbors) || neighbors.length === 0) {
      return 0;
    }

    let diversityTotal = 0;
    let sampleTotal = 0;

    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];

      if (!neighbor || neighbor.blocked) continue;

      const kinship = Number.isFinite(neighbor.kinship)
        ? clamp(neighbor.kinship, 0, 1)
        : null;

      if (kinship == null) continue;

      diversityTotal += 1 - kinship;
      sampleTotal += 1;
    }

    if (sampleTotal === 0) {
      return 0;
    }

    return clamp(diversityTotal / sampleTotal, 0, 1);
  }

  #averageSimilarity(list = []) {
    const summary = this.#summarizeTargetSimilarity(list);

    return summary.similarity;
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

  #estimateDiversityOpportunitySignal() {
    const samples = Number.isFinite(this.diversityOpportunitySamples)
      ? this.diversityOpportunitySamples
      : 0;

    if (samples <= 0) {
      return 0;
    }

    const alignment = clamp(
      Number.isFinite(this.diversityOpportunityAlignmentScore)
        ? this.diversityOpportunityAlignmentScore / samples
        : 0,
      0,
      1,
    );
    const neglect = clamp(
      Number.isFinite(this.diversityOpportunityNeglectScore)
        ? this.diversityOpportunityNeglectScore / samples
        : 0,
      0,
      1,
    );
    const presence = clamp(samples / (samples + 4), 0, 1);

    return clamp(alignment * 0.7 + presence * 0.2 - neglect * 0.3, 0, 1);
  }

  #resolveDiversityDrive({
    availableDiversity = null,
    diversityOpportunity = null,
    noveltyPressure = null,
  } = {}) {
    const appetite = clamp(
      Number.isFinite(this.diversityAppetite) ? this.diversityAppetite : 0,
      0,
      1,
    );
    const memory = clamp(this.#resolveMateDiversityMemory(), 0, 1);
    const observed = clamp(
      Number.isFinite(availableDiversity) ? availableDiversity : memory,
      0,
      1,
    );
    const novelty = clamp(
      Number.isFinite(noveltyPressure)
        ? noveltyPressure
        : this.#resolveMateNoveltyPressure(),
      0,
      1,
    );
    const opportunity = clamp(
      Number.isFinite(diversityOpportunity)
        ? diversityOpportunity
        : this.#estimateDiversityOpportunitySignal(),
      0,
      1,
    );
    const bias = clamp(
      Number.isFinite(this.matePreferenceBias) ? this.matePreferenceBias : 0,
      -1,
      1,
    );
    const kinLean = Math.max(0, bias);
    const curiosityLean = clamp(appetite + Math.max(0, -bias) * 0.6, 0, 1.6);
    const desire = clamp(
      curiosityLean * (0.55 + novelty * 0.25) + opportunity * (0.3 + novelty * 0.2),
      0,
      1.4,
    );
    const comfort = clamp(
      memory * (0.5 + kinLean * 0.3) + observed * (0.35 + kinLean * 0.25),
      0,
      1.4,
    );
    const drive = clamp((desire - comfort) * (1 + curiosityLean * 0.15), -1.2, 1.2);

    return clamp(drive, -1, 1);
  }

  getDiversityDrive(context = {}) {
    return this.#resolveDiversityDrive(context);
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
    const allySummary = this.#summarizeTargetSimilarity(society);
    const enemySummary = this.#summarizeTargetSimilarity(enemies);
    const mateSummary = this.#summarizeTargetSimilarity(mates);
    const allySimilarity = allySummary.similarity;
    const enemySimilarity = enemySummary.similarity;
    const mateSimilarity = mateSummary.similarity;
    const localDiversity = this.#resolveDiversitySignalFromSummaries(
      allySummary,
      enemySummary,
      mateSummary,
    );
    const riskTolerance = this.#resolveRiskTolerance();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const neuralFatigue = this.#currentNeuralFatigue();
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: localDiversity,
    });

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      allyFraction: allyFrac,
      enemyFraction: enemyFrac,
      mateFraction: mateFrac,
      allySimilarity,
      enemySimilarity,
      mateSimilarity,
      diversityDrive,
      ageFraction: ageFrac,
      riskTolerance,
      interactionMomentum,
      eventPressure,
      resourceTrend,
      neuralFatigue,
      scarcityMemory,
      confidenceMemory,
      opportunitySignal: this.#currentOpportunitySignal(),
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
    const outcome = this.#getDecisionOutcome("movement");
    let neuralSignal = null;
    let neuralCompetitor = 0;
    let neuralMix = 0;
    let neuralAmplifier = 1;

    if (outcome && outcome.usedBrain) {
      const { probabilities, logits } = outcome;

      if (probabilities && typeof probabilities === "object") {
        for (const [key, value] of Object.entries(probabilities)) {
          const normalized = Number.isFinite(value) ? clamp(value, 0, 1) : null;

          if (key === "rest") {
            if (normalized != null) neuralSignal = normalized;
          } else if (normalized != null && normalized > neuralCompetitor) {
            neuralCompetitor = normalized;
          }
        }
      }

      if (neuralSignal == null && logits && typeof logits === "object") {
        const restLogit = Number(logits.rest);

        if (Number.isFinite(restLogit)) {
          const clamped = clamp(restLogit, -12, 12);

          neuralSignal = 1 / (1 + Math.exp(-clamped));
        }
      }

      if (neuralSignal != null) {
        const intentAdvantage = neuralSignal - neuralCompetitor;
        const positiveAdvantage = intentAdvantage > 0 ? intentAdvantage : 0;

        neuralMix = clamp(0.35 + positiveAdvantage * 0.5, 0.1, 1);
        neuralAmplifier = clamp(
          0.6 + neuralSignal * 0.8 + positiveAdvantage * 0.6,
          0.3,
          1.8,
        );
      }
    }

    const boosted =
      neuralSignal != null
        ? lerp(baseBoost, baseBoost * neuralAmplifier, neuralMix)
        : baseBoost;
    const boost = clamp(boosted, 0, 1.5);
    const carry = clamp(
      (Number.isFinite(this._pendingRestRecovery) ? this._pendingRestRecovery : 0) +
        boost,
      0,
      3,
    );

    this._pendingRestRecovery = carry;

    this.#assignDecisionOutcome("movement", {
      restBaseBoost: baseBoost,
      restBoost: boost,
      restCarry: carry,
      restNeed,
      restSupport,
      restDensityRelief: densityRelief,
      restNeuralSignal: neuralSignal,
      restNeuralCompetitor: neuralSignal != null ? neuralCompetitor : null,
      restNeuralMix: neuralSignal != null ? neuralMix : 0,
      restNeuralAmplifier: neuralSignal != null ? neuralAmplifier : 1,
    });

    return boost;
  }

  #resolveExploreExploitIntent(
    decision,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
      energyScanAvailable = false,
    } = {},
  ) {
    const density = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const energyCap =
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1;
    const energyFrac = clamp((this.energy ?? 0) / energyCap, 0, 1);
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : energyFrac;
    const scarcity = clamp(1 - tileLevel, 0, 1);
    const trend = clamp(tileEnergyDelta ?? 0, -1, 1);
    const fatigue = this.#currentNeuralFatigue();
    const riskTolerance = this.#resolveRiskTolerance();
    let baseIntent =
      0.45 +
      scarcity * 0.35 +
      (1 - density) * 0.1 +
      Math.max(0, -trend) * 0.1 +
      riskTolerance * 0.1 -
      fatigue * 0.25;

    baseIntent = clamp(baseIntent, 0.05, 0.95);

    let neuralSignal = null;
    let neuralAdvantage = 0;
    let neuralIntent = null;
    const movementOutcome = this.#getDecisionOutcome("movement");

    if (decision?.usedBrain && movementOutcome) {
      let probabilities =
        movementOutcome.probabilities &&
        typeof movementOutcome.probabilities === "object"
          ? movementOutcome.probabilities
          : null;

      if (!probabilities && movementOutcome.logits) {
        const entries = OUTPUT_GROUPS.movement;
        const logits = entries.map(({ key }) => {
          const value = Number(movementOutcome.logits?.[key]);

          return Number.isFinite(value) ? value : 0;
        });
        const labels = entries.map(({ key }) => key);
        const normalized = softmax(logits);

        probabilities = labels.reduce((acc, label, index) => {
          acc[label] = normalized[index] ?? 0;

          return acc;
        }, {});
      }

      if (probabilities) {
        const clampProb = (key) => clamp(Number(probabilities[key]) || 0, 0, 1);
        const exploreProb = clampProb("explore");
        const restProb = clampProb("rest");
        const pursueProb = clampProb("pursue");
        const avoidProb = clampProb("avoid");
        const cohereProb = clampProb("cohere");

        neuralSignal = exploreProb;
        const rival = Math.max(restProb, pursueProb, avoidProb, cohereProb);

        neuralAdvantage = Math.max(0, exploreProb - rival);
        neuralIntent = clamp(
          exploreProb * (0.65 + neuralAdvantage * 0.5) + (1 - restProb) * 0.2,
          0,
          1,
        );
      }
    }

    const neuralWeight =
      neuralIntent != null ? clamp(0.5 + neuralAdvantage * 0.35, 0, 1) : 0;
    const finalIntent =
      neuralIntent != null ? lerp(baseIntent, neuralIntent, neuralWeight) : baseIntent;
    const availableIntent = energyScanAvailable ? finalIntent : 0;
    const rng = this.resolveRng("movementExploitIntent");
    const shouldAttempt = energyScanAvailable && rng() < availableIntent;

    this.#assignDecisionOutcome("movement", {
      exploreExploitBase: baseIntent,
      exploreExploitIntent: finalIntent,
      exploreExploitNeural: neuralSignal,
      exploreExploitAdvantage: neuralAdvantage,
      exploreExploitScanAvailable: energyScanAvailable,
      exploreExploitPlanned: shouldAttempt,
      exploreExploitExecuted: false,
      exploreExploitSucceeded: false,
      exploreExploitDirection: null,
    });

    return {
      shouldAttempt,
      probability: finalIntent,
      baseIntent,
      neuralSignal,
      neuralAdvantage,
    };
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
    const enemySummary = this.#summarizeTargetSimilarity(enemies);
    const allySummary = this.#summarizeTargetSimilarity(allies);
    const enemySimilarity = enemySummary.similarity;
    const allySimilarity = allySummary.similarity;
    const localDiversity = this.#resolveDiversitySignalFromSummaries(
      enemySummary,
      allySummary,
    );
    const riskTolerance = this.#resolveRiskTolerance();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const neuralFatigue = this.#currentNeuralFatigue();
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: localDiversity,
    });

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      enemyFraction: enemyFrac,
      allyFraction: allyFrac,
      enemySimilarity,
      allySimilarity,
      diversityDrive,
      ageFraction: ageFrac,
      riskTolerance,
      interactionMomentum,
      eventPressure,
      resourceTrend,
      neuralFatigue,
      opportunitySignal: this.#currentOpportunitySignal(),
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
    const partnerDiversity = clamp(1 - similarity, 0, 1);
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: partnerDiversity,
    });

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
      opportunitySignal: this.#currentOpportunitySignal(),
      diversityDrive,
    };
  }

  #cooperationSensors(
    partner,
    { selfEnergy = 0, partnerEnergy = 0, kinship = null } = {},
  ) {
    const energy = clamp(Number.isFinite(selfEnergy) ? selfEnergy : 0, 0, 1);
    const partnerNorm = clamp(
      Number.isFinite(partnerEnergy) ? partnerEnergy : energy,
      0,
      1,
    );
    const similarity =
      kinship != null && Number.isFinite(kinship)
        ? clamp(kinship, 0, 1)
        : clamp(
            this.#safeSimilarityTo(partner, {
              context: "cooperation sensor similarity",
              fallback: 0,
            }),
            0,
            1,
          );
    const partnerAgeFrac = partner?.lifespan
      ? clamp(partner.age / partner.lifespan, 0, 1)
      : 0;
    const selfSenescence = clamp(
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0,
      0,
      2,
    );
    const partnerSenescence = clamp(
      partner && typeof partner.dna?.senescenceRate === "function"
        ? partner.dna.senescenceRate()
        : 0,
      0,
      2,
    );
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();
    const opportunitySignal = this.#currentOpportunitySignal();
    const partnerDiversity = clamp(1 - similarity, 0, 1);
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: partnerDiversity,
    });

    return {
      energy,
      partnerEnergy: partnerNorm,
      partnerSimilarity: similarity,
      partnerAgeFraction: partnerAgeFrac,
      selfSenescence,
      partnerSenescence,
      riskTolerance: this.#resolveRiskTolerance(),
      interactionMomentum: this.#resolveInteractionMomentum(),
      eventPressure: clamp(this.lastEventPressure || 0, 0, 1),
      resourceTrend: clamp(this._resourceSignal ?? 0, -1, 1),
      neuralFatigue: this.#currentNeuralFatigue(),
      scarcityMemory,
      confidenceMemory,
      opportunitySignal,
      allyFraction: 1,
      enemyFraction: 0,
      mateFraction: 0,
      allySimilarity: similarity,
      enemySimilarity: 0,
      mateSimilarity: similarity,
      effectiveDensity: 0,
      diversityDrive,
    };
  }

  #resolveReproductionNeuralBlend({
    baseProbability = 0,
    neuralProbability = 0,
    sensors = {},
    evaluation = null,
  } = {}) {
    const geneFraction = (locus, fallback = 0.5) => {
      if (typeof this.dna?.geneFraction === "function") {
        const value = this.dna.geneFraction(locus);

        if (Number.isFinite(value)) {
          return clamp(value, 0, 1);
        }
      }

      return clamp(fallback, 0, 1);
    };
    const reinforcement = this.neuralReinforcementProfile || {};
    const plasticity = this.neuralPlasticityProfile || {};
    const neuralGene = geneFraction(GENE_LOCI.NEURAL);
    const strategyGene = geneFraction(GENE_LOCI.STRATEGY);
    const fertilityGene = geneFraction(GENE_LOCI.FERTILITY);
    const parentalGene = geneFraction(GENE_LOCI.PARENTAL);
    const reinforcementWeight = clamp(
      Number.isFinite(reinforcement.reproductionWeight)
        ? reinforcement.reproductionWeight
        : 0.4,
      0.05,
      1.1,
    );
    const reinforcementSignal = reinforcementWeight / 1.1;
    let weight =
      0.2 +
      neuralGene * 0.2 +
      strategyGene * 0.12 +
      fertilityGene * 0.1 +
      parentalGene * 0.08 +
      reinforcementSignal * 0.3;

    weight = clamp(weight, 0.12, 0.88);

    const evaluationActivation = Number.isFinite(evaluation?.activationCount)
      ? evaluation.activationCount
      : 0;
    const neuronBase =
      Number.isFinite(this.neurons) && this.neurons > 0 ? this.neurons : 24;
    const normalizedActivation = clamp(
      evaluationActivation / Math.max(1, neuronBase),
      0,
      1,
    );

    if (normalizedActivation > 0) {
      weight *= 1 + normalizedActivation * 0.3;
    }

    const resolvedSensors = sensors && typeof sensors === "object" ? sensors : {};
    const neuralFatigue = clamp(
      Number.isFinite(resolvedSensors.neuralFatigue)
        ? resolvedSensors.neuralFatigue
        : this.#currentNeuralFatigue(),
      0,
      1,
    );
    const fatiguePenalty = clamp(
      1 - neuralFatigue * (0.45 - 0.15 * neuralGene),
      0.25,
      1,
    );

    weight *= fatiguePenalty;

    const scarcityMemory = clamp(
      Number.isFinite(resolvedSensors.scarcityMemory)
        ? resolvedSensors.scarcityMemory
        : 0,
      -1,
      1,
    );

    if (scarcityMemory > 0) {
      weight *= clamp(
        1 - scarcityMemory * (0.25 + 0.15 * (1 - fertilityGene)),
        0.35,
        1,
      );
    } else if (scarcityMemory < 0) {
      weight *= 1 + -scarcityMemory * 0.08 * fertilityGene;
    }

    const confidenceMemory = clamp(
      Number.isFinite(resolvedSensors.confidenceMemory)
        ? resolvedSensors.confidenceMemory
        : 0,
      -1,
      1,
    );

    weight *= clamp(1 + confidenceMemory * 0.18, 0.65, 1.45);

    const opportunitySignal = clamp(
      Number.isFinite(resolvedSensors.opportunitySignal)
        ? resolvedSensors.opportunitySignal
        : this.#currentOpportunitySignal(),
      -1,
      1,
    );

    weight *= clamp(1 + opportunitySignal * (0.2 + 0.1 * strategyGene), 0.5, 1.6);

    const diversityDrive = clamp(
      Number.isFinite(resolvedSensors.diversityDrive)
        ? resolvedSensors.diversityDrive
        : this.#resolveDiversityDrive(),
      -1,
      1,
    );

    if (diversityDrive > 0) {
      weight *= 1 + diversityDrive * (0.12 + fertilityGene * 0.1);
    } else if (diversityDrive < 0) {
      weight *= 1 + diversityDrive * (0.14 + parentalGene * 0.08);
    }

    const resourceTrend = clamp(
      Number.isFinite(resolvedSensors.resourceTrend)
        ? resolvedSensors.resourceTrend
        : 0,
      -1,
      1,
    );

    if (resourceTrend < 0) {
      weight *= 1 - Math.abs(resourceTrend) * 0.18;
    }

    const assimilation = clamp(
      Number.isFinite(plasticity.learningRate) ? plasticity.learningRate * 0.8 : 0.18,
      0.05,
      0.6,
    );
    const neuralDelta = clamp(neuralProbability - baseProbability, -1, 1);

    if (neuralDelta > 0) {
      weight += neuralDelta * assimilation * (0.5 + confidenceMemory * 0.2);
    } else if (neuralDelta < 0) {
      const scarcityPenalty = 0.3 + clamp(scarcityMemory, 0, 1) * 0.2;

      weight += neuralDelta * assimilation * scarcityPenalty;
    }

    weight = clamp(weight, 0.05, 0.95);

    return { weight, neuralDelta };
  }

  #blendReproductionProbability({
    baseProbability = 0,
    neuralProbability = 0,
    sensors = {},
    evaluation = null,
  } = {}) {
    const safeBase = clamp(
      Number.isFinite(baseProbability) ? baseProbability : 0,
      0,
      1,
    );
    const safeNeural = clamp(
      Number.isFinite(neuralProbability) ? neuralProbability : 0,
      0,
      1,
    );
    const resolvedSensors = sensors && typeof sensors === "object" ? sensors : {};
    const { weight, neuralDelta } = this.#resolveReproductionNeuralBlend({
      baseProbability: safeBase,
      neuralProbability: safeNeural,
      sensors: resolvedSensors,
      evaluation,
    });
    const probability = clamp(safeBase * (1 - weight) + safeNeural * weight, 0, 1);

    return { probability, weight, neuralDelta };
  }

  #resolveCooperationNeuralWeight({
    sensors = {},
    evaluation = null,
    preference = 0,
    balanceLean = 0,
  } = {}) {
    const geneFraction = (locus, fallback = 0.5) => {
      if (typeof this.dna?.geneFraction === "function") {
        const value = this.dna.geneFraction(locus);

        if (Number.isFinite(value)) {
          return clamp(value, 0, 1);
        }
      }

      return clamp(fallback, 0, 1);
    };

    const neuralGene = geneFraction(GENE_LOCI.NEURAL, 0.5);
    const cooperationGene = geneFraction(GENE_LOCI.COOPERATION, 0.5);
    const parentalGene = geneFraction(GENE_LOCI.PARENTAL, 0.5);
    const strategyGene = geneFraction(GENE_LOCI.STRATEGY, 0.5);
    const recoveryGene = geneFraction(GENE_LOCI.RECOVERY, 0.5);
    const reinforcement = this.neuralReinforcementProfile || {};
    const socialDriveProfile = this.riskMemoryProfile || {};
    const interactionAlignment = clamp(
      Number.isFinite(reinforcement.interactionAlignmentWeight)
        ? reinforcement.interactionAlignmentWeight
        : 0.3,
      0,
      1.3,
    );
    const socialDrive = clamp(
      Number.isFinite(reinforcement.socialWeight)
        ? reinforcement.socialWeight
        : Number.isFinite(socialDriveProfile.socialWeight)
          ? socialDriveProfile.socialWeight
          : 0.4,
      0.05,
      1.4,
    );

    let weight =
      0.18 +
      neuralGene * 0.2 +
      cooperationGene * 0.26 +
      parentalGene * 0.18 +
      strategyGene * 0.12 +
      interactionAlignment * 0.18 +
      socialDrive * 0.22;

    const activationCount = Number.isFinite(evaluation?.activationCount)
      ? evaluation.activationCount
      : 0;
    const baselineNeurons = Math.max(
      1,
      Number.isFinite(this.neurons) && this.neurons > 0 ? this.neurons : 24,
    );
    const normalizedActivation = clamp(
      activationCount / Math.max(1, baselineNeurons),
      0,
      1,
    );

    if (normalizedActivation > 0) {
      weight *= 1 + normalizedActivation * 0.22;
    }

    const resolvedSensors = sensors && typeof sensors === "object" ? sensors : {};
    const neuralFatigue = clamp(
      Number.isFinite(resolvedSensors.neuralFatigue)
        ? resolvedSensors.neuralFatigue
        : this.#currentNeuralFatigue(),
      0,
      1,
    );
    const fatiguePenalty = clamp(
      1 - neuralFatigue * (0.4 - recoveryGene * 0.15),
      0.3,
      1,
    );

    weight *= fatiguePenalty;

    const scarcityMemory = clamp(
      Number.isFinite(resolvedSensors.scarcityMemory)
        ? resolvedSensors.scarcityMemory
        : 0,
      -1,
      1,
    );

    if (scarcityMemory > 0) {
      weight *= 1 - scarcityMemory * 0.2;
    }

    const confidenceMemory = clamp(
      Number.isFinite(resolvedSensors.confidenceMemory)
        ? resolvedSensors.confidenceMemory
        : 0,
      -1,
      1,
    );

    if (confidenceMemory < 0) {
      weight *= 1 + Math.abs(confidenceMemory) * 0.1;
    }

    const opportunitySignal = clamp(
      Number.isFinite(resolvedSensors.opportunitySignal)
        ? resolvedSensors.opportunitySignal
        : 0,
      -1,
      1,
    );

    if (opportunitySignal > 0) {
      weight *= 1 + opportunitySignal * 0.08;
    }

    const directionStrength = clamp(
      Math.abs(preference) + Math.abs(balanceLean) * 0.5,
      0,
      1,
    );

    weight *= clamp(0.6 + directionStrength * 0.4, 0.3, 1.2);

    if (!Number.isFinite(weight)) {
      return { weight: 0 };
    }

    return { weight: clamp(weight, 0, 0.9) };
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
      opportunitySignal: this.#currentOpportunitySignal(),
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

  #previewBrainGroup(group, sensors) {
    if (!this.#canUseNeuralPolicies()) return null;

    const result = this.brain.evaluateGroup(group, sensors, { trace: false });

    if (!result || !result.values) return null;

    return result;
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

  getSenescenceDebt() {
    const debt = this._senescenceDebt;

    if (!Number.isFinite(debt) || debt <= 0) {
      return 0;
    }

    return debt;
  }

  resolveSenescenceElasticity({
    localDensity = 0,
    energyFraction = null,
    scarcitySignal = 0,
  } = {}) {
    const longevityGene =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.SENESCENCE)
        : 0.5;
    const longevity = clamp(Number.isFinite(longevityGene) ? longevityGene : 0.5, 0, 1);
    const resilience = clamp(this.dna?.recoveryRate?.() ?? 0.35, 0, 1);
    const adaptation = clamp(this.resourceTrendAdaptation ?? 0.35, 0, 1);
    const vitality = clamp(resilience * 0.65 + adaptation * 0.35, 0, 1);
    const density = clamp(Number.isFinite(localDensity) ? localDensity : 0, 0, 1);
    const scarcity = clamp(Number.isFinite(scarcitySignal) ? scarcitySignal : 0, 0, 1);
    const fallbackCap =
      Number.isFinite(MAX_TILE_ENERGY) && MAX_TILE_ENERGY > 0 ? MAX_TILE_ENERGY : 1;
    const normalizedEnergy = clamp(
      Number.isFinite(energyFraction)
        ? energyFraction
        : (Number.isFinite(this.energy) ? this.energy : 0) / fallbackCap,
      0,
      1,
    );
    const stress = clamp(
      0.35 + density * 0.35 + scarcity * 0.3 + (1 - normalizedEnergy) * 0.45,
      0.15,
      1.4,
    );
    const baseElasticity = 2 + longevity * 1.6 + vitality * 1.1;
    const stressDrag = 1 - Math.min(0.75, stress * (0.4 + (1 - vitality) * 0.35));

    return clamp(baseElasticity * stressDrag, 1.2, 4.6);
  }

  updateSenescenceDebt({
    ageFraction = this.getAgeFraction({ clamp: false }),
    energyFraction = null,
    localDensity = 0,
    scarcitySignal = 0,
    eventPressure = this.lastEventPressure ?? 0,
  } = {}) {
    const fallbackCap =
      Number.isFinite(MAX_TILE_ENERGY) && MAX_TILE_ENERGY > 0 ? MAX_TILE_ENERGY : 1;
    const normalizedEnergy = clamp(
      Number.isFinite(energyFraction)
        ? energyFraction
        : (Number.isFinite(this.energy) ? this.energy : 0) / fallbackCap,
      0,
      1,
    );
    const normalizedAge = Math.max(0, Number.isFinite(ageFraction) ? ageFraction : 0);
    const density = clamp(Number.isFinite(localDensity) ? localDensity : 0, 0, 1);
    const scarcity = clamp(Number.isFinite(scarcitySignal) ? scarcitySignal : 0, 0, 1);
    const pressure = clamp(Number.isFinite(eventPressure) ? eventPressure : 0, 0, 1);
    const senescenceRate = clamp(
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0.25,
      0.05,
      1.25,
    );
    const resilience = clamp(this.dna?.recoveryRate?.() ?? 0.35, 0, 1);
    const adaptation = clamp(this.resourceTrendAdaptation ?? 0.35, 0, 1);
    const vitality = clamp(resilience * 0.65 + adaptation * 0.35, 0, 1);
    const baseStress =
      (1 - normalizedEnergy) * (0.5 + senescenceRate * 0.25) +
      density * 0.35 +
      scarcity * 0.3 +
      pressure * 0.25;
    const mitigation = 0.25 + vitality * 0.45;

    if (normalizedAge > 1) {
      const overAge = normalizedAge - 1;
      const elasticity = this.resolveSenescenceElasticity({
        localDensity,
        energyFraction: normalizedEnergy,
        scarcitySignal,
      });
      const normalizedOver = overAge / Math.max(1, elasticity - 1);
      const growthDriver = Math.max(
        0,
        baseStress + senescenceRate * 0.4 - mitigation * 0.6,
      );
      const gain = overAge * (0.45 + senescenceRate) * (0.4 + growthDriver);
      const compounding =
        (1 + Math.log1p(Math.max(0, this._senescenceDebt ?? 0)) * 0.15) *
        (0.6 + normalizedOver * 0.8);
      const delta = Math.max(0, gain * compounding);

      this._senescenceDebt = (this._senescenceDebt ?? 0) + delta;
    } else {
      const reliefBase = Math.max(0, mitigation - baseStress * 0.35);
      const relief = (1 - normalizedAge) * (0.2 + reliefBase * 0.5);
      const decay = relief + Math.max(0, vitality * 0.1);

      this._senescenceDebt = Math.max(0, (this._senescenceDebt ?? 0) - decay);
    }

    return this._senescenceDebt;
  }

  getSenescenceAgeFraction() {
    if (!Number.isFinite(this.lifespan) || this.lifespan <= 0) return 0;

    return this.age / this.lifespan;
  }

  getAgeFraction({ clamp: shouldClamp = true } = {}) {
    const fraction = this.getSenescenceAgeFraction();

    if (!shouldClamp) {
      return fraction;
    }

    return clamp(fraction, 0, 1);
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
    const ageFracRaw = this.getAgeFraction({ clamp: false });
    const ageElasticity = this.resolveSenescenceElasticity();
    const ageFrac = clamp(ageFracRaw, 0, Math.max(1.2, ageElasticity));

    if (ageFrac <= 0) return 1;

    const senescence =
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0;
    const basePull = 0.12 + Math.max(0, senescence);
    const linear = 1 + ageFrac * basePull;
    const curvature = 1 + ageFrac * ageFrac * (0.25 + Math.max(0, senescence) * 1.1);
    const debt = this.getSenescenceDebt();
    const debtPressure = 1 + Math.log1p(debt) * 0.2;
    const overshootDrag =
      1 + Math.max(0, ageFracRaw - 1) * (0.35 + Math.max(0, senescence) * 0.5);
    const combined = linear * curvature * debtPressure * overshootDrag;
    const loadFactor = clampFinite(load, 0, 3, 1);

    return 1 + (combined - 1) * loadFactor;
  }

  computeSenescenceHazard({
    ageFraction = this.getAgeFraction(),
    energyFraction = null,
    localDensity = 0,
    densityEffectMultiplier = 1,
    eventPressure = this.lastEventPressure ?? 0,
    crowdingPreference = this.baseCrowdingTolerance ?? 0.5,
    scarcitySignal = 0,
  } = {}) {
    const fallbackEnergyCap =
      Number.isFinite(MAX_TILE_ENERGY) && MAX_TILE_ENERGY > 0 ? MAX_TILE_ENERGY : 1;
    const normalizedEnergy = clamp(
      Number.isFinite(energyFraction)
        ? energyFraction
        : (Number.isFinite(this.energy) ? this.energy : 0) / fallbackEnergyCap,
      0,
      1,
    );
    const elasticity = this.resolveSenescenceElasticity({
      localDensity,
      energyFraction: normalizedEnergy,
      scarcitySignal,
    });
    const normalizedAge = clamp(
      Number.isFinite(ageFraction)
        ? ageFraction
        : this.getAgeFraction({ clamp: false }),
      0,
      Math.max(1.2, elasticity),
    );

    if (normalizedAge <= 0) {
      return 0;
    }

    const densityScale = Number.isFinite(densityEffectMultiplier)
      ? densityEffectMultiplier
      : 1;
    const normalizedDensity = clamp(
      (Number.isFinite(localDensity) ? localDensity : 0) * densityScale,
      0,
      1,
    );
    const comfort = clamp(
      Number.isFinite(crowdingPreference)
        ? crowdingPreference
        : (this.baseCrowdingTolerance ?? 0.5),
      0,
      1,
    );
    const scarcity = clamp(Number.isFinite(scarcitySignal) ? scarcitySignal : 0, 0, 1);
    const densityStress = Math.max(0, normalizedDensity - comfort);
    const energyStress = 1 - normalizedEnergy;
    const pressureStress = clamp(
      Number.isFinite(eventPressure) ? eventPressure : 0,
      0,
      1,
    );
    const senescence = clamp(
      typeof this.dna?.senescenceRate === "function" ? this.dna.senescenceRate() : 0.25,
      0,
      2,
    );
    const resilience = clamp(this.dna?.recoveryRate?.() ?? 0.35, 0, 1);
    const adaptation = clamp(this.resourceTrendAdaptation ?? 0.35, 0, 1);
    const vitality = clamp(resilience * 0.65 + adaptation * 0.35, 0, 1);
    const baseCurve = (normalizedAge - 0.85) * (5 + senescence * 4);
    const overshoot = Math.max(0, normalizedAge - 1);
    const overshootCurve = overshoot * (6 + senescence * 5);
    const stressCurve =
      energyStress * (1.5 - vitality * 1.05) +
      densityStress * (1.3 - vitality * 0.85) +
      pressureStress * (1.4 - vitality * 0.7) +
      scarcity * (1.1 - vitality * 0.6);
    const mitigation = vitality * 1.25;
    const debtPressure =
      Math.log1p(this.getSenescenceDebt()) * (0.55 + senescence * 0.45);
    const hazardInput =
      baseCurve + overshootCurve + stressCurve + debtPressure - mitigation - 1.1;
    const logisticInput = clamp(hazardInput, -12, 12);
    const hazard = 1 / (1 + Math.exp(-logisticInput));

    return clamp(hazard, 0, 1);
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
    const { probabilities: probabilitiesByKey, logits: logitsByKey } = labels.reduce(
      (acc, key, index) => {
        acc.probabilities[key] = probs[index] ?? 0;
        acc.logits[key] = logits[index] ?? 0;

        return acc;
      },
      { probabilities: {}, logits: {} },
    );

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

  decideRandomMove(context = {}) {
    // Blend DNA predispositions with environmental feedback so fallback movement
    // emerges from the same pressures that shape neural policies.
    const {
      localDensity = 0,
      densityEffectMultiplier = 1,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = context ?? {};
    const g = this.movementGenes || { wandering: 0.33, pursuit: 0.33, cautious: 0.34 };
    const wandering = Math.max(0, g.wandering);
    const pursuit = Math.max(0, g.pursuit);
    const cautious = Math.max(0, g.cautious);
    const total = wandering + pursuit + cautious || 1;
    const cautiousFrac = cautious / total;
    const roamingFrac = (wandering + pursuit) / total;
    const pursuitFrac = pursuit / total;
    const effDensity = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const crowdComfort = clamp(
      Number.isFinite(this._crowdingTolerance)
        ? this._crowdingTolerance
        : Number.isFinite(this.baseCrowdingTolerance)
          ? this.baseCrowdingTolerance
          : 0.5,
      0,
      1,
    );
    const crowdPressure = effDensity > crowdComfort ? effDensity - crowdComfort : 0;
    const crowdRelief = effDensity < crowdComfort ? crowdComfort - effDensity : 0;
    const energyCap =
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1;
    const energyFrac = clamp((this.energy ?? 0) / energyCap, 0, 1);
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : energyFrac;
    const scarcity = clamp(1 - tileLevel, 0, 1);
    const trend = clamp(tileEnergyDelta ?? 0, -1, 1);
    const fatigue = this.#currentNeuralFatigue();
    const riskTolerance = this.#resolveRiskTolerance();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const restProfile = this.neuralFatigueProfile || {};
    const restThreshold = clamp(
      Number.isFinite(restProfile.restThreshold) ? restProfile.restThreshold : 0.45,
      0,
      1,
    );
    const restSupport =
      energyFrac > restThreshold
        ? clamp((energyFrac - restThreshold) / Math.max(0.001, 1 - restThreshold), 0, 1)
        : 0;
    const resourceAdaptation = clamp(this.resourceTrendAdaptation ?? 0.35, 0, 1);
    const resourceSignal = clamp(this._resourceSignal ?? 0, -1, 1);
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();

    let stayWeight =
      cautiousFrac * 0.35 +
      fatigue * (0.5 + cautiousFrac * 0.3) +
      scarcity * (0.25 + (1 - riskTolerance) * 0.35) +
      crowdPressure * (0.4 + cautiousFrac * 0.25) +
      eventPressure * (0.2 + cautiousFrac * 0.2) +
      restSupport * (0.25 + cautiousFrac * 0.35);

    if (scarcityMemory > 0) stayWeight += scarcityMemory * 0.3;
    if (confidenceMemory < 0) stayWeight += -confidenceMemory * 0.25;
    if (resourceSignal < 0) {
      stayWeight += Math.abs(resourceSignal) * (0.25 + cautiousFrac * 0.25);
    }

    let moveWeight =
      roamingFrac * (0.35 + riskTolerance * 0.3) +
      pursuitFrac * 0.15 +
      crowdRelief * (0.3 + roamingFrac * 0.3) +
      Math.max(0, -scarcityMemory) * 0.25 +
      Math.max(0, confidenceMemory) * 0.3 +
      (1 - fatigue) * (0.25 + roamingFrac * 0.2) +
      energyFrac * (0.2 + riskTolerance * 0.2) +
      Math.max(0, trend) * (0.25 + resourceAdaptation * 0.3);

    if (resourceSignal > 0) {
      moveWeight += resourceSignal * (0.2 + roamingFrac * 0.2);
    }

    const baseline = clamp(0.1 + 0.8 * cautiousFrac, 0.05, 0.95);
    const combined = stayWeight + moveWeight;
    let pStay = combined > 0 ? stayWeight / combined : baseline;

    pStay = clamp(lerp(baseline, pStay, 0.65), 0.05, 0.95);
    const rng = this.resolveRng("movementRandom");
    const stayRoll = rng();

    if (stayRoll < pStay) return { dr: 0, dc: 0 };

    const directionRoll = rng();
    const scoredDirections = this.#scoreFallbackMovementDirections({
      neighbors: Array.isArray(context?.neighbors) ? context.neighbors : null,
      crowdPressure,
      crowdRelief,
      resourceSignal,
      scarcity,
      trend,
      tileLevel,
      energyFrac,
      riskTolerance,
      resourceAdaptation,
      cautiousFrac,
      roamingFrac,
      pursuitFrac,
    });

    if (Array.isArray(scoredDirections) && scoredDirections.length > 0) {
      let total = 0;

      for (let i = 0; i < scoredDirections.length; i += 1) {
        total += scoredDirections[i].weight;
      }

      if (total > 0) {
        const target = directionRoll * total;
        let acc = 0;

        for (let i = 0; i < scoredDirections.length; i += 1) {
          acc += scoredDirections[i].weight;

          if (target <= acc) {
            const { dr, dc } = scoredDirections[i];

            return { dr, dc };
          }
        }

        const fallback = scoredDirections[scoredDirections.length - 1];

        return { dr: fallback.dr, dc: fallback.dc };
      }
    }

    // Otherwise pick one of 4 directions uniformly
    switch ((directionRoll * 4) | 0) {
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

  #scoreFallbackMovementDirections({
    neighbors,
    crowdPressure = 0,
    crowdRelief = 0,
    resourceSignal = 0,
    scarcity = 0,
    trend = 0,
    tileLevel = 0,
    energyFrac = 0,
    riskTolerance = 0.5,
    resourceAdaptation = 0,
    cautiousFrac = 0.33,
    roamingFrac = 0.67,
    pursuitFrac = 0.33,
  } = {}) {
    if (!Array.isArray(neighbors) || neighbors.length === 0) {
      return null;
    }

    const hunger = 1 - clamp(energyFrac, 0, 1);
    const normalizedTile = clamp(tileLevel ?? 0, 0, 1);
    const resourceDrive = clamp(this.resourceTrendAdaptation ?? 0.35, 0, 1);
    const neighborDiversity = this.#estimateNeighborDiversity(neighbors);
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: neighborDiversity,
    });
    const diversity = clamp((diversityDrive + 1) / 2, 0, 1);
    const results = [];

    for (let i = 0; i < neighbors.length; i += 1) {
      const neighbor = neighbors[i];

      if (!neighbor) continue;

      const dr = Number.isFinite(neighbor.dr) ? neighbor.dr : 0;
      const dc = Number.isFinite(neighbor.dc) ? neighbor.dc : 0;

      if (neighbor.blocked) {
        results.push({ dr, dc, weight: 0 });

        continue;
      }

      let weight =
        0.2 +
        roamingFrac * 0.3 +
        riskTolerance * 0.25 +
        hunger * 0.1 +
        Math.max(0, -scarcity) * 0.05;

      if (neighbor.occupied) {
        const kinship = clamp(
          Number.isFinite(neighbor.kinship) ? neighbor.kinship : 0,
          0,
          1,
        );
        const socialLift = kinship * (0.25 + diversity * 0.3 + crowdRelief * 0.2);
        const cautionPenalty =
          (1 - kinship) * (0.45 + cautiousFrac * 0.5 + crowdPressure * 0.35);
        const pursuitLift = pursuitFrac * (1 - kinship) * 0.2;

        weight += socialLift - cautionPenalty + pursuitLift;
      } else {
        weight += 0.2 + crowdRelief * (0.35 + roamingFrac * 0.25);
      }

      if (Number.isFinite(neighbor.energy)) {
        const neighborEnergy = clamp(neighbor.energy, 0, 1);
        const delta = neighborEnergy - normalizedTile;

        if (delta > 0) {
          weight += delta * (0.5 + resourceDrive * 0.5 + roamingFrac * 0.25);
        } else if (delta < 0) {
          weight += delta * (0.35 + cautiousFrac * 0.4);
        }
      }

      if (Number.isFinite(neighbor.energyDelta) && neighbor.energyDelta !== 0) {
        const deltaTrend = clamp(neighbor.energyDelta, -1, 1);

        weight += deltaTrend * (0.3 + resourceAdaptation * 0.35);
      }

      if (resourceSignal !== 0) {
        weight += resourceSignal * (0.08 + roamingFrac * 0.12);
      }

      if (trend !== 0) {
        weight += trend * 0.05;
      }

      weight = Math.max(weight, 0);

      if (weight > 0) {
        results.push({ dr, dc, weight });
      }
    }

    return results.length > 0 ? results : null;
  }

  #buildMovementContext({
    gridArr,
    row,
    col,
    rows,
    cols,
    localDensity = 0,
    densityEffectMultiplier = 1,
    tileEnergy = null,
    tileEnergyDelta = 0,
    maxTileEnergy = MAX_TILE_ENERGY,
    getEnergyAt,
    getEnergyDeltaAt,
    isTileBlocked,
  } = {}) {
    const context = {
      localDensity,
      densityEffectMultiplier,
      tileEnergy,
      tileEnergyDelta,
      maxTileEnergy,
    };

    if (!Array.isArray(gridArr) || rows == null || cols == null) {
      return context;
    }

    const directions = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];

    const neighbors = directions.map(({ dr, dc }) => {
      const rr = Number.isFinite(row) ? row + dr : null;
      const cc = Number.isFinite(col) ? col + dc : null;
      const outOfBounds =
        rr == null || cc == null || rr < 0 || cc < 0 || rr >= rows || cc >= cols;
      const blocked =
        outOfBounds || (typeof isTileBlocked === "function" && isTileBlocked(rr, cc));
      const occupant =
        !outOfBounds && Array.isArray(gridArr?.[rr]) ? (gridArr[rr][cc] ?? null) : null;
      const kinship =
        occupant && typeof this.similarityTo === "function"
          ? clamp(this.similarityTo(occupant), 0, 1)
          : null;
      const energy =
        !outOfBounds && typeof getEnergyAt === "function" ? getEnergyAt(rr, cc) : null;
      const energyDelta =
        !outOfBounds && typeof getEnergyDeltaAt === "function"
          ? getEnergyDeltaAt(rr, cc)
          : null;

      return {
        dr,
        dc,
        blocked,
        occupied: Boolean(occupant),
        kinship,
        energy: Number.isFinite(energy) ? energy : null,
        energyDelta: Number.isFinite(energyDelta) ? energyDelta : null,
      };
    });

    context.neighbors = neighbors;

    return context;
  }

  #resolveScarcityRelief(energyFraction) {
    const normalized = clamp(
      Number.isFinite(energyFraction) ? energyFraction : 0,
      0,
      1,
    );

    if (typeof this.dna?.energyScarcityRelief === "function") {
      return this.dna.energyScarcityRelief(normalized, this.scarcityReliefProfile);
    }

    return 0.15 + normalized * 0.85;
  }

  resolveHarvestDemand({
    baseRate = 0,
    crowdPenalty = 1,
    availableEnergy = 0,
    maxTileEnergy = MAX_TILE_ENERGY,
    minCap = 0,
    maxCap = 1,
    localDensity = 0,
    densityEffectMultiplier = 1,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const safeMinCap = clampFinite(minCap, 0, 1, 0);
    const safeMaxCapCandidate = clampFinite(maxCap, safeMinCap, 1, safeMinCap);
    const safeMaxCap = Math.max(safeMinCap, safeMaxCapCandidate);
    const capacity = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const normalizedEnergy = clamp(
      Number.isFinite(this.energy) ? this.energy / capacity : 0,
      0,
      1,
    );
    const hunger = 1 - normalizedEnergy;
    const scarcity = clamp(
      tileEnergy != null && Number.isFinite(tileEnergy) ? 1 - tileEnergy : hunger,
      0,
      1,
    );
    const declinePressure = clamp(
      -(Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0),
      0,
      1,
    );
    const densityMultiplier = Number.isFinite(densityEffectMultiplier)
      ? densityEffectMultiplier
      : 1;
    const effDensity = clamp(
      (Number.isFinite(localDensity) ? localDensity : 0) * densityMultiplier,
      0,
      1,
    );
    const comfort = clamp(
      Number.isFinite(this._crowdingTolerance)
        ? this._crowdingTolerance
        : Number.isFinite(this.baseCrowdingTolerance)
          ? this.baseCrowdingTolerance
          : 0.5,
      0,
      1,
    );
    const crowdPressure = Math.max(0, effDensity - comfort);
    const crowdRelief = Math.max(0, comfort - effDensity);
    const metabolism = clamp(
      Number.isFinite(this.metabolism) ? this.metabolism : 0.35,
      0.05,
      3,
    );
    const metabolicPull = 1 + hunger * (0.6 + metabolism * 0.35);
    const scarcityDrive = clamp(
      this.neuralReinforcementProfile?.scarcityDrive ??
        this.resourceTrendAdaptation ??
        0.35,
      0,
      1.5,
    );
    const scarcityPressure =
      1 +
      scarcity * (0.45 + scarcityDrive * 0.35) +
      declinePressure * (0.2 + scarcityDrive * 0.15);
    const opportunity = this.#currentOpportunitySignal();
    const opportunism =
      1 +
      Math.max(0, opportunity) * (0.18 + hunger * 0.22) -
      Math.max(0, -opportunity) * 0.12;
    const densityAdjustment =
      1 +
      crowdRelief * (0.2 + scarcity * 0.2) -
      crowdPressure * (0.18 + (this.metabolicCrowdingTax || 0) * 0.22);
    const availableNorm = capacity > 0 ? clamp(availableEnergy / capacity, 0, 1) : 0;
    const anticipation = clamp(
      hunger * 0.35 + declinePressure * 0.45 + availableNorm * 0.3,
      0,
      1.5,
    );
    const adaptive = 1 + anticipation * 0.35;
    const expectation = clampFinite(baseRate, 0, safeMaxCap);
    const baseline = expectation * clampFinite(crowdPenalty, 0, 3);
    let demand =
      baseline *
      metabolicPull *
      scarcityPressure *
      opportunism *
      densityAdjustment *
      adaptive;

    demand = clampFinite(demand, safeMinCap, safeMaxCap);

    const starvationThreshold = this.starvationThreshold(capacity);

    if (this.energy < starvationThreshold) {
      const deficit = clamp((starvationThreshold - this.energy) / capacity, 0, 1);
      const urgency = 1 + deficit * (0.4 + scarcity * 0.4 + declinePressure * 0.3);

      demand = clampFinite(demand * urgency, safeMinCap, safeMaxCap);
    }

    return demand;
  }

  #calculateMetabolicEnergyLoss(effectiveDensity, maxTileEnergy = MAX_TILE_ENERGY) {
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
    const capacity = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const energyFraction = clamp(
      Number.isFinite(this.energy) ? this.energy / capacity : 0,
      0,
      1,
    );
    const scarcityRelief = this.#resolveScarcityRelief(energyFraction);

    return baseLoss * lossScale * agingPenalty * scarcityRelief;
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

  manageEnergy(
    row,
    col,
    { localDensity, densityEffectMultiplier, maxTileEnergy, scarcityRelief = 1 },
  ) {
    const effectiveDensity = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const energyLoss = this.#calculateMetabolicEnergyLoss(
      effectiveDensity,
      maxTileEnergy,
    );
    const { baselineCost, dynamicCost, cognitiveLoss, dynamicLoad, baselineNeurons } =
      this.#calculateCognitiveCosts(effectiveDensity);
    const energyBefore = this.energy;
    const scarcityReliefInput = Number.isFinite(scarcityRelief) ? scarcityRelief : 1;
    const scarcityFactor = clamp(0.3 + scarcityReliefInput * 0.7, 0.3, 1);
    const adjustedEnergyLoss = energyLoss * scarcityFactor;

    this.energy -= adjustedEnergyLoss + cognitiveLoss;
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
      energyLoss: adjustedEnergyLoss,
      cognitiveLoss,
      baselineCost,
      dynamicCost,
      dynamicLoad,
      baselineNeurons,
      totalLoss: adjustedEnergyLoss + cognitiveLoss,
      neuralFatigueSnapshot: fatigueSnapshot,
      maxTileEnergy,
    });

    this._neuralLoad = 0;
    const starvationThreshold = this.starvationThreshold(maxTileEnergy);

    return this.energy <= starvationThreshold;
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
    const expectation = clampFinite(baseRate, 0, 1.5);
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

  getCrowdingPreference({ fallback = 0.5 } = {}) {
    const baseline = Number.isFinite(this.baseCrowdingTolerance)
      ? this.baseCrowdingTolerance
      : fallback;
    const adapted = Number.isFinite(this._crowdingTolerance)
      ? this._crowdingTolerance
      : baseline;

    return clamp(adapted, 0, 1);
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
      getEnergyDeltaAt,
      tryMove,
      isTileBlocked,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = {},
  ) {
    const strategy = this.#legacyChooseMovementStrategy(
      localDensity,
      densityEffectMultiplier,
    );
    const movementContext = this.#buildMovementContext({
      gridArr,
      row,
      col,
      rows,
      cols,
      localDensity,
      densityEffectMultiplier,
      tileEnergy,
      tileEnergyDelta,
      maxTileEnergy,
      getEnergyAt,
      getEnergyDeltaAt,
      isTileBlocked,
    });

    if (strategy === "pursuit") {
      const target =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (target)
        return moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

      return moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
    }
    if (strategy === "cautious") {
      const threat =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (threat) {
        const { shouldRetreat } = this.#legacyResolveCautiousResponse(threat, {
          row,
          col,
          localDensity,
          densityEffectMultiplier,
          tileEnergy,
          tileEnergyDelta,
          maxTileEnergy,
          mates,
          enemies,
          society,
        });

        if (shouldRetreat) {
          if (typeof moveAwayFromTarget === "function") {
            return moveAwayFromTarget(
              gridArr,
              row,
              col,
              threat.row,
              threat.col,
              rows,
              cols,
            );
          }

          return moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
        }
      }
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

        return moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
      }
    }

    return moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
  }

  #legacyResolveCautiousResponse(
    threat,
    {
      row,
      col,
      localDensity = 0,
      densityEffectMultiplier = 1,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
      mates = [],
      enemies = [],
      society = [],
    } = {},
  ) {
    if (!threat) {
      return { shouldRetreat: false, probability: 0 };
    }

    const baseline = this.#computeLegacyRetreatImpulse(threat, {
      row,
      col,
      localDensity,
      densityEffectMultiplier,
      tileEnergy,
      tileEnergyDelta,
      maxTileEnergy,
    });
    const neural = this.#neuralCautiousRetreatImpulse({
      threat,
      row,
      col,
      localDensity,
      densityEffectMultiplier,
      tileEnergy,
      tileEnergyDelta,
      maxTileEnergy,
      mates,
      enemies,
      society,
      baseline,
    });

    let probability = baseline.probability;
    let neuralDetails = null;

    if (neural) {
      const weight = clamp(Number.isFinite(neural.weight) ? neural.weight : 0.5, 0, 1);

      probability = lerp(probability, neural.probability, weight);
      neuralDetails = { ...neural, weight };
    }

    probability = clampFinite(probability, 0, 1);

    const rng = this.resolveRng("legacyCautiousRetreat");
    const roll = typeof rng === "function" ? rng() : Math.random();
    const shouldRetreat = Number.isFinite(roll)
      ? roll < probability
      : probability >= 0.5;

    if (neuralDetails) {
      this.#assignDecisionOutcome("movement", {
        cautiousRetreat: {
          baselineProbability: baseline.probability,
          probability,
          neuralProbability: neuralDetails.probability,
          neuralWeight: neuralDetails.weight,
          neuralAdvantage: neuralDetails.advantage,
        },
      });
    }

    return { shouldRetreat, probability };
  }

  #computeLegacyRetreatImpulse(
    threat,
    {
      row,
      col,
      localDensity = 0,
      densityEffectMultiplier = 1,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = {},
  ) {
    if (!threat) {
      return { probability: 0, metrics: null };
    }

    const occupantRow = Number.isFinite(row) ? row : this.row;
    const occupantCol = Number.isFinite(col) ? col : this.col;
    const densityMultiplier = Number.isFinite(densityEffectMultiplier)
      ? densityEffectMultiplier
      : 1;
    const effectiveDensity = clamp(
      (Number.isFinite(localDensity) ? localDensity : 0) * densityMultiplier,
      0,
      1,
    );
    const energyCap = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const normalizeEnergy = (value) =>
      clamp(Number.isFinite(value) ? value / energyCap : 0, 0, 1);
    const selfEnergy = normalizeEnergy(this.energy);
    const threatEnergy = normalizeEnergy(threat?.energy);
    const energyDelta = clamp(threatEnergy - selfEnergy, -1, 1);
    const normalizedTileEnergy = clamp(
      Number.isFinite(tileEnergy) ? tileEnergy : selfEnergy,
      0,
      1,
    );
    const tileDecline = clamp(
      -(Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0),
      0,
      1,
    );
    const scarcitySignal = clamp(1 - selfEnergy + tileDecline * 0.6, 0, 1.6);
    const riskTolerance = this.#resolveRiskTolerance();
    const resilience = clamp(this.dna?.recoveryRate?.() ?? 0.35, 0, 1);
    const strategyGene = (() => {
      if (typeof this.dna?.geneFraction === "function") {
        const raw = this.dna.geneFraction(GENE_LOCI.STRATEGY);

        if (Number.isFinite(raw)) {
          return clamp(raw, 0, 1);
        }
      }

      return Number.isFinite(this.strategy) ? clamp(this.strategy, 0, 1) : 0.5;
    })();
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);
    const distance =
      Number.isFinite(threat?.row) && Number.isFinite(threat?.col)
        ? Math.max(
            Math.abs(threat.row - occupantRow),
            Math.abs(threat.col - occupantCol),
          )
        : Number.POSITIVE_INFINITY;
    const proximity =
      Number.isFinite(distance) && distance < Number.POSITIVE_INFINITY
        ? 1 / (1 + distance)
        : 0;
    const proximityPressure = clamp(
      proximity * (0.45 + effectiveDensity * 0.3),
      0,
      1.2,
    );
    const cautionDrive = clamp(
      0.35 +
        (1 - riskTolerance) * 0.6 +
        strategyGene * 0.25 +
        (1 - resilience) * 0.25 +
        eventPressure * 0.3 +
        effectiveDensity * 0.2,
      0.1,
      1.8,
    );
    const threatDrive = clamp(
      0.25 +
        energyDelta * 0.65 +
        proximityPressure +
        scarcitySignal * 0.25 +
        eventPressure * 0.35,
      0,
      1.8,
    );
    const resourceAnchor = clamp(
      0.3 +
        normalizedTileEnergy * 0.5 +
        (1 - tileDecline) * 0.4 +
        Math.max(0, -energyDelta) * 0.4,
      0,
      1.6,
    );
    const confidence = clamp(
      0.25 + riskTolerance * 0.5 + resilience * 0.45 + (1 - scarcitySignal) * 0.35,
      0.1,
      1.7,
    );
    const retreatScore = cautionDrive * (0.4 + threatDrive);
    const holdScore = resourceAnchor * confidence;
    const retreatProbability = clamp(
      0.25 + retreatScore * 0.55 - holdScore * 0.35,
      0,
      1,
    );

    return {
      probability: retreatProbability,
      metrics: {
        cautionDrive,
        threatDrive,
        resourceAnchor,
        confidence,
        retreatScore,
        holdScore,
        scarcitySignal,
        energyDelta,
        proximityPressure,
        eventPressure,
      },
    };
  }

  #neuralCautiousRetreatImpulse({
    threat,
    localDensity = 0,
    densityEffectMultiplier = 1,
    mates = [],
    enemies = [],
    society = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
    baseline = null,
  } = {}) {
    if (!threat || !this.#canUseNeuralPolicies()) {
      return null;
    }

    const sensors = this.#movementSensors({
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    });
    const preview = this.#previewBrainGroup("movement", sensors);

    if (!preview?.values) {
      return null;
    }

    const entries = OUTPUT_GROUPS.movement;
    const logits = entries.map(({ key }) => Number(preview.values[key]) || 0);
    const probabilities = softmax(logits);
    const indexOf = (label) => entries.findIndex((entry) => entry.key === label);
    const clampProb = (idx) => (idx >= 0 ? clamp(probabilities[idx] ?? 0, 0, 1) : 0);
    const avoidIndex = indexOf("avoid");
    const avoidProb = clampProb(avoidIndex);

    if (avoidIndex < 0) {
      return null;
    }

    let competitorMax = 0;

    for (let i = 0; i < probabilities.length; i++) {
      if (i === avoidIndex) continue;

      const candidate = clamp(probabilities[i] ?? 0, 0, 1);

      if (candidate > competitorMax) {
        competitorMax = candidate;
      }
    }

    const advantage = Math.max(0, avoidProb - competitorMax);
    const restProb = clampProb(indexOf("rest"));
    const pursueProb = clampProb(indexOf("pursue"));
    const exploreProb = clampProb(indexOf("explore"));
    const severity = (() => {
      const metrics = baseline?.metrics || {};
      const threatDrive = Number.isFinite(metrics.threatDrive)
        ? clamp(metrics.threatDrive, 0, 2)
        : 0;
      const proximityPressure = Number.isFinite(metrics.proximityPressure)
        ? clamp(metrics.proximityPressure, 0, 1.5)
        : 0;
      const energyDelta = Number.isFinite(metrics.energyDelta)
        ? clamp(Math.max(0, metrics.energyDelta), 0, 1)
        : 0;
      const eventPressure = Number.isFinite(metrics.eventPressure)
        ? clamp(metrics.eventPressure, 0, 1)
        : clamp(this.lastEventPressure || 0, 0, 1);

      return clamp(
        threatDrive * 0.35 +
          proximityPressure * 0.35 +
          energyDelta * 0.3 +
          eventPressure * 0.25,
        0,
        1.6,
      );
    })();
    const neuralFatigue = this.#currentNeuralFatigue();
    const scarcityMemory = clamp(Math.max(0, sensors.scarcityMemory ?? 0), 0, 1);
    let neuralProbability = avoidProb * (0.65 + advantage * 0.55);

    neuralProbability += severity * 0.25;
    neuralProbability += neuralFatigue * 0.12 + scarcityMemory * 0.1;
    neuralProbability -= restProb * 0.18 + pursueProb * 0.22 + exploreProb * 0.08;
    neuralProbability = clamp(neuralProbability, 0, 1);

    const weight = clamp(0.45 + advantage * 0.35 + severity * 0.25, 0.2, 0.95);

    return {
      probability: neuralProbability,
      weight,
      advantage,
      avoidProbability: avoidProb,
      competitorProbability: competitorMax,
      restProbability: restProb,
      pursueProbability: pursueProb,
      exploreProbability: exploreProb,
    };
  }

  #resolveAvoidRetreatTarget({
    row = this.row,
    col = this.col,
    mates = [],
    enemies = [],
    society = [],
    localDensity = 0,
    densityEffectMultiplier = 1,
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    if (!this.#canUseNeuralPolicies()) return null;

    const movementOutcome = this.#getDecisionOutcome("movement");

    if (
      !movementOutcome ||
      movementOutcome.usedNetwork !== true ||
      movementOutcome.action !== "avoid"
    ) {
      return null;
    }

    const probabilities =
      movementOutcome.probabilities && typeof movementOutcome.probabilities === "object"
        ? movementOutcome.probabilities
        : null;

    if (!probabilities) return null;

    const avoidProb = clamp(Number(probabilities.avoid) || 0, 0, 1);
    const restProb = clamp(Number(probabilities.rest) || 0, 0, 1);
    const pursueProb = clamp(Number(probabilities.pursue) || 0, 0, 1);
    const exploreProb = clamp(Number(probabilities.explore) || 0, 0, 1);
    const cohereProb = clamp(Number(probabilities.cohere) || 0, 0, 1);
    const competitorMax = Math.max(restProb, pursueProb, exploreProb, cohereProb);
    const neuralAdvantage = Math.max(0, avoidProb - competitorMax);
    const neuralWeight = clamp(0.25 + avoidProb * 0.5 + neuralAdvantage * 0.4, 0, 1);

    const effectiveMultiplier = Number.isFinite(densityEffectMultiplier)
      ? densityEffectMultiplier
      : 1;
    const effDensity = clamp(
      Number.isFinite(localDensity) ? localDensity * effectiveMultiplier : 0,
      0,
      1,
    );
    const crowdComfort = clamp(
      Number.isFinite(this._crowdingTolerance)
        ? this._crowdingTolerance
        : Number.isFinite(this.baseCrowdingTolerance)
          ? this.baseCrowdingTolerance
          : 0.5,
      0,
      1,
    );
    const crowdPressure = Math.max(0, effDensity - crowdComfort);
    const originRow = Number.isFinite(row)
      ? row
      : Number.isFinite(this.row)
        ? this.row
        : 0;
    const originCol = Number.isFinite(col)
      ? col
      : Number.isFinite(this.col)
        ? this.col
        : 0;
    const energyCap = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const selfEnergy = clamp(
      (Number.isFinite(this.energy) ? this.energy : 0) / energyCap,
      0,
      2,
    );

    let best = null;
    let bestScore = -Infinity;

    const evaluateCandidate = (entry, type) => {
      if (!entry || typeof entry !== "object") return null;

      const target = entry.target ?? null;

      if (!target) return null;

      const targetRow = Number.isFinite(entry.row)
        ? entry.row
        : Number.isFinite(target.row)
          ? target.row
          : null;
      const targetCol = Number.isFinite(entry.col)
        ? entry.col
        : Number.isFinite(target.col)
          ? target.col
          : null;

      if (!Number.isFinite(targetRow) || !Number.isFinite(targetCol)) {
        return null;
      }

      const distance = Math.max(
        Math.abs(targetRow - originRow),
        Math.abs(targetCol - originCol),
      );
      const proximity = clamp(1 / (1 + distance), 0, 1);
      const normalizedEnergy = clamp(
        Number.isFinite(target.energy) ? target.energy / energyCap : 0,
        0,
        2,
      );
      const energyDelta = clamp(normalizedEnergy - selfEnergy, -1, 1);
      const similarity = clamp(
        this.#safeSimilarityTo(target, {
          context: `movement avoid focus similarity (${type})`,
          fallback: type === "enemy" ? 0 : 0.6,
        }),
        0,
        1,
      );

      let typeBias = 0.6;

      if (type === "enemy") {
        typeBias = 1;
      } else if (type === "mate") {
        typeBias = 0.7;
      }

      const proximityStress = proximity * (0.45 + neuralWeight * 0.3);
      let threatSignal = 0;

      if (type === "enemy") {
        const hostility = 1 - similarity;

        threatSignal =
          Math.max(0, energyDelta) * (0.6 + neuralWeight * 0.4) +
          hostility * (0.35 + neuralAdvantage * 0.3);
      } else {
        threatSignal =
          crowdPressure * (0.5 + neuralWeight * 0.35) +
          similarity * 0.2 +
          Math.max(0, -energyDelta) * 0.1;
      }

      const score = typeBias * (threatSignal + proximityStress + neuralAdvantage * 0.2);

      if (!(score > bestScore)) {
        return null;
      }

      return {
        row: targetRow,
        col: targetCol,
        entry,
        type,
        score,
        metrics: {
          distance,
          proximity,
          energyDelta,
          similarity,
          threatSignal,
        },
      };
    };

    const considerList = (list, type) => {
      if (!Array.isArray(list) || list.length === 0) return;

      for (let i = 0; i < list.length; i++) {
        const candidate = evaluateCandidate(list[i], type);

        if (!candidate) continue;

        best = candidate;
        bestScore = candidate.score;
      }
    };

    considerList(enemies, "enemy");
    considerList(mates, "mate");
    considerList(society, "ally");

    if (!best) return null;

    return {
      row: best.row,
      col: best.col,
      entry: best.entry,
      type: best.type,
      source: `neural:${best.type}`,
      score: best.score,
      metrics: best.metrics,
      neural: {
        avoidProbability: avoidProb,
        competitorMax,
        advantage: neuralAdvantage,
        weight: neuralWeight,
      },
    };
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
      getEnergyDeltaAt,
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
    const movementContext = this.#buildMovementContext({
      gridArr,
      row,
      col,
      rows,
      cols,
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
      getEnergyAt,
      getEnergyDeltaAt,
      isTileBlocked,
    });
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

    const exploitPlan = this.#resolveExploreExploitIntent(decision, {
      ...movementContext,
      energyScanAvailable: typeof getEnergyAt === "function",
    });
    const chosen = decision.action;
    const nearestEnemy = this.#nearest(enemies, row, col);
    const nearestMate = this.#nearest(mates, row, col);
    const nearestAlly = this.#nearest(society, row, col);

    const attemptEnergyExploit = () => {
      if (!exploitPlan?.shouldAttempt) return false;
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

      if (!bestDir) {
        this.#assignDecisionOutcome("movement", {
          exploreExploitExecuted: false,
          exploreExploitDirection: null,
          exploreExploitSucceeded: false,
        });

        return false;
      }

      let moved = false;

      if (typeof tryMove === "function") {
        moved = Boolean(tryMove(gridArr, row, col, bestDir.dr, bestDir.dc, rows, cols));

        if (moved) {
          this.#assignDecisionOutcome("movement", {
            exploreExploitExecuted: true,
            exploreExploitDirection: { dr: bestDir.dr, dc: bestDir.dc },
            exploreExploitSucceeded: true,
          });

          return true;
        }
      }

      if (typeof moveRandomly === "function") {
        moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
      }

      this.#assignDecisionOutcome("movement", {
        exploreExploitExecuted: true,
        exploreExploitDirection: { dr: bestDir.dr, dc: bestDir.dc },
        exploreExploitSucceeded: false,
      });

      return true;
    };

    switch (chosen) {
      case "rest":
        this.#queueRestRecovery({ localDensity, densityEffectMultiplier });

        return;
      case "pursue": {
        let targetedEnemy = null;

        if (
          Array.isArray(enemies) &&
          enemies.length > 0 &&
          typeof this.chooseEnemyTarget === "function"
        ) {
          targetedEnemy = this.chooseEnemyTarget(enemies, {
            maxTileEnergy: movementContext.maxTileEnergy,
          });
        }

        let target = targetedEnemy || nearestEnemy || nearestMate || nearestAlly;
        let source = null;

        if (targetedEnemy) {
          const targetingOutcome = this.#getDecisionOutcome("targeting");
          const usedTargetingNetwork = Boolean(targetingOutcome?.usedNetwork);

          source = usedTargetingNetwork ? "neuralTargeting" : "targeting";

          const summary = this.#summarizePursuitTarget(target, {
            origin: source,
            row,
            col,
          });

          if (summary && typeof moveToTarget === "function") {
            moveToTarget(gridArr, row, col, summary.row, summary.col, rows, cols);

            this.#assignDecisionOutcome("movement", {
              pursueTarget: summary,
              pursueUsedTargetingNetwork: usedTargetingNetwork,
            });

            return;
          }

          // If the neural target could not be resolved, fall back to other options.
          target = null;
        }

        if (!target && nearestEnemy) {
          target = nearestEnemy;
          source = "nearestEnemy";
        } else if (!target && nearestMate) {
          target = nearestMate;
          source = "nearestMate";
        } else if (!target && nearestAlly) {
          target = nearestAlly;
          source = "nearestAlly";
        }

        if (target && typeof moveToTarget === "function") {
          const summary = this.#summarizePursuitTarget(target, {
            origin: source,
            row,
            col,
          });

          if (summary) {
            moveToTarget(gridArr, row, col, summary.row, summary.col, rows, cols);

            this.#assignDecisionOutcome("movement", {
              pursueTarget: summary,
              pursueUsedTargetingNetwork: false,
            });

            return;
          }
        }

        break;
      }
      case "avoid": {
        let focus = null;

        if (decision.usedBrain) {
          focus = this.#resolveAvoidRetreatTarget({
            row,
            col,
            mates,
            enemies,
            society,
            localDensity,
            densityEffectMultiplier,
            maxTileEnergy: movementContext.maxTileEnergy,
          });
        }

        const fallbackThreat = nearestEnemy || nearestMate || nearestAlly;
        let targetRow = focus?.row;
        let targetCol = focus?.col;

        if (!Number.isFinite(targetRow) || !Number.isFinite(targetCol)) {
          const candidateRow = Number.isFinite(fallbackThreat?.row)
            ? fallbackThreat.row
            : Number.isFinite(fallbackThreat?.target?.row)
              ? fallbackThreat.target.row
              : null;
          const candidateCol = Number.isFinite(fallbackThreat?.col)
            ? fallbackThreat.col
            : Number.isFinite(fallbackThreat?.target?.col)
              ? fallbackThreat.target.col
              : null;

          targetRow = Number.isFinite(targetRow) ? targetRow : candidateRow;
          targetCol = Number.isFinite(targetCol) ? targetCol : candidateCol;
        }

        if (
          Number.isFinite(targetRow) &&
          Number.isFinite(targetCol) &&
          typeof moveAwayFromTarget === "function"
        ) {
          moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols);

          if (focus) {
            const metrics = focus.metrics || {};

            this.#assignDecisionOutcome("movement", {
              avoidFocus: {
                source: focus.source,
                type: focus.type,
                row: Number.isFinite(focus.row) ? focus.row : null,
                col: Number.isFinite(focus.col) ? focus.col : null,
                neuralScore: focus.score,
                neuralAdvantage: focus.neural?.advantage ?? null,
                neuralWeight: focus.neural?.weight ?? null,
                avoidProbability: focus.neural?.avoidProbability ?? null,
                competitorMax: focus.neural?.competitorMax ?? null,
                metrics: {
                  distance: Number.isFinite(metrics.distance) ? metrics.distance : null,
                  proximity: Number.isFinite(metrics.proximity)
                    ? metrics.proximity
                    : null,
                  energyDelta: Number.isFinite(metrics.energyDelta)
                    ? metrics.energyDelta
                    : null,
                  similarity: Number.isFinite(metrics.similarity)
                    ? metrics.similarity
                    : null,
                  threatSignal: Number.isFinite(metrics.threatSignal)
                    ? metrics.threatSignal
                    : null,
                },
              },
            });
          }

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
      moveRandomly(gridArr, row, col, this, rows, cols, movementContext);
    }
  }

  #summarizePursuitTarget(targetEntry, { origin = null, row, col } = {}) {
    if (!targetEntry) return null;

    const resolvedRow = Number.isFinite(targetEntry?.row)
      ? targetEntry.row
      : Number.isFinite(targetEntry?.target?.row)
        ? targetEntry.target.row
        : null;
    const resolvedCol = Number.isFinite(targetEntry?.col)
      ? targetEntry.col
      : Number.isFinite(targetEntry?.target?.col)
        ? targetEntry.target.col
        : null;

    if (!Number.isFinite(resolvedRow) || !Number.isFinite(resolvedCol)) {
      return null;
    }

    const originRow = Number.isFinite(row) ? row : this.row;
    const originCol = Number.isFinite(col) ? col : this.col;
    const summary = {
      row: resolvedRow,
      col: resolvedCol,
    };

    if (typeof origin === "string" && origin.length > 0) {
      summary.source = origin;
    }

    if (Number.isFinite(originRow) && Number.isFinite(originCol)) {
      const distance = Math.max(
        Math.abs(resolvedRow - originRow),
        Math.abs(resolvedCol - originCol),
      );

      if (Number.isFinite(distance)) {
        summary.distance = distance;
      }
    }

    const targetCell = targetEntry?.target ?? null;

    if (targetCell) {
      if (Number.isFinite(targetCell.energy)) {
        summary.energy = targetCell.energy;
      }

      const similarity = this.#safeSimilarityTo(targetCell, {
        context: "movement pursue target similarity",
        fallback: null,
      });

      if (Number.isFinite(similarity)) {
        summary.similarity = clamp(similarity, 0, 1);
      }
    }

    return summary;
  }

  getReproductionReach({
    localDensity = 0,
    tileEnergy = 0.5,
    tileEnergyDelta = 0,
    partner = null,
    partnerSimilarity = null,
  } = {}) {
    const profile = this.reproductionReachProfile || {};
    let minReach = Number.isFinite(profile.min) ? profile.min : 0.85;
    let maxReach = Number.isFinite(profile.max) ? profile.max : 1.6;

    if (!(maxReach >= minReach)) {
      maxReach = minReach;
    }
    minReach = clamp(minReach, 0.4, 3);
    maxReach = clamp(maxReach, minReach, 4);
    let reach = Number.isFinite(profile.base) ? profile.base : 1;

    reach = clamp(reach, minReach, maxReach);

    const density = clamp(Number.isFinite(localDensity) ? localDensity : 0, 0, 1);
    const energy = clamp(Number.isFinite(tileEnergy) ? tileEnergy : 0, 0, 1);
    const trend = clamp(Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0, -1, 1);
    const densityPenalty = clamp(profile.densityPenalty ?? 0.45, 0, 1.5);
    const energyBonus = clamp(profile.energyBonus ?? 0.35, 0, 1.5);
    const scarcityBoost = clamp(profile.scarcityBoost ?? 0.25, 0, 1);
    const affinityWeight = clamp(profile.affinityWeight ?? 0.18, 0, 0.8);

    reach -= density * densityPenalty;
    reach += (energy - 0.5) * energyBonus;

    if (trend < 0) {
      reach += -trend * scarcityBoost;
    }

    if (affinityWeight > 0) {
      const similarity =
        partnerSimilarity != null && Number.isFinite(partnerSimilarity)
          ? clamp(partnerSimilarity, 0, 1)
          : this.#safeSimilarityTo(partner, {
              context: "reproduction reach partner similarity",
              fallback: 0.5,
            });

      reach += (similarity - 0.5) * affinityWeight;
    }

    return clamp(reach, minReach, maxReach);
  }

  /**
   * Estimates how far this organism can meaningfully interact with others for
   * the given action. The range blends encoded interaction genes with
   * risk-taking tendencies, cooperative drives, and environmental feedback so
   * that heightened aggression or social investment naturally extends a cell's
   * reach while crowding pressure reins it in.
   *
   * @param {string} action - Interaction type being attempted (e.g. "fight" or
   *   "cooperate").
   * @param {Object} [context]
   * @param {number} [context.localDensity=0] - Local crowding signal.
   * @param {number} [context.densityEffectMultiplier=1] - Additional density
   *   scaling.
   * @param {number|null} [context.tileEnergy=null] - Normalized tile energy at
   *   the organism's location when available.
   * @param {number} [context.tileEnergyDelta=0] - Recent energy delta for the
   *   tile used as a scarcity/abundance cue.
   * @param {number} [context.maxTileEnergy=MAX_TILE_ENERGY] - Global tile
   *   energy cap for normalizing fallback measurements.
   * @returns {number} Effective interaction reach in tile units.
   */
  getInteractionReach(
    action,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      tileEnergy = null,
      tileEnergyDelta = 0,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = {},
  ) {
    const normalizedAction = typeof action === "string" ? action.toLowerCase() : "";

    if (!normalizedAction) {
      return 1;
    }

    const multiplier =
      Number.isFinite(densityEffectMultiplier) && densityEffectMultiplier > 0
        ? densityEffectMultiplier
        : 1;
    const effectiveDensity = clamp(
      Number.isFinite(localDensity) ? localDensity * multiplier : 0,
      0,
      1,
    );
    const energyCap =
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1;
    const normalizedEnergy =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : clamp((this.energy ?? 0) / energyCap, 0, 1);
    const trend = clamp(Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0, -1, 1);
    const genes = this.interactionGenes || {
      avoid: 0.33,
      fight: 0.33,
      cooperate: 0.34,
    };

    if (normalizedAction === "fight") {
      const aggression = clamp(genes.fight ?? 0.33, 0, 1);
      const risk = clamp(this.#resolveRiskTolerance(), 0, 1);
      const focus =
        typeof this.dna?.conflictFocus === "function" ? this.dna.conflictFocus() : null;
      const proximityBias = clamp(focus?.proximity ?? 0.35, 0.1, 1.6);
      let reach =
        1 +
        aggression * 0.85 +
        risk * 0.55 +
        Math.max(0, normalizedEnergy - 0.5) * 0.45 +
        Math.max(0, trend) * 0.25;

      reach += 0.7 - proximityBias * 0.3;
      reach -= effectiveDensity * 0.35;

      return clamp(reach, 0.75, 3.2);
    }

    if (normalizedAction === "cooperate") {
      const cooperative = clamp(genes.cooperate ?? 0.34, 0, 1);
      const comfort = clamp(
        Number.isFinite(this._crowdingTolerance)
          ? this._crowdingTolerance
          : Number.isFinite(this.baseCrowdingTolerance)
            ? this.baseCrowdingTolerance
            : 0.5,
        0,
        1,
      );
      const crowdPressure = effectiveDensity > comfort ? effectiveDensity - comfort : 0;
      const crowdRelief = effectiveDensity < comfort ? comfort - effectiveDensity : 0;
      const shareDriveRaw =
        typeof this.dna?.cooperateShareFrac === "function"
          ? this.dna.cooperateShareFrac({ energyDelta: trend, kinship: 0.5 })
          : cooperative;
      const shareDrive = clamp(shareDriveRaw ?? cooperative, 0, 1);
      let reach =
        1 +
        cooperative * 0.9 +
        shareDrive * 0.6 +
        crowdRelief * 0.45 +
        Math.max(0, normalizedEnergy - 0.4) * 0.35;

      reach -= crowdPressure * 0.5;

      return clamp(reach, 0.8, 3.2);
    }

    return 1;
  }

  populationScarcityDrive({
    scarcity = 0,
    baseProbability = 0.5,
    partner = null,
    population = 0,
    minPopulation = 0,
  } = {}) {
    const scarcityClamped = clamp(Number.isFinite(scarcity) ? scarcity : 0, 0, 1);

    if (scarcityClamped <= 0) {
      return 1;
    }

    const baseProb = clamp(
      Number.isFinite(baseProbability) ? baseProbability : 0.5,
      0,
      1,
    );
    const fertility =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.FERTILITY)
        : 0.5;
    const parental =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.PARENTAL)
        : 0.5;
    const cohesion =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.COHESION)
        : 0.5;
    const exploration =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.EXPLORATION)
        : 0.5;
    const risk =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.RISK)
        : 0.5;
    const partnerSupport =
      partner && typeof partner?.dna?.geneFraction === "function"
        ? clamp(
            0.25 +
              0.3 * partner.dna.geneFraction(GENE_LOCI.PARENTAL) +
              0.2 * partner.dna.geneFraction(GENE_LOCI.COHESION),
            0.1,
            0.95,
          )
        : 0.35;

    const cooperativePull = clamp(
      0.35 + 0.4 * cohesion + 0.25 * parental + partnerSupport * 0.3,
      0.25,
      1.2,
    );
    const fertilityDrive = clamp(0.3 + 0.5 * fertility, 0.2, 1.1);
    const explorationPush = clamp(0.2 + 0.45 * exploration, 0.1, 0.85);
    const deficitBoost = (() => {
      const popCount = Number.isFinite(population) ? population : 0;
      const minPop =
        Number.isFinite(minPopulation) && minPopulation > 0 ? minPopulation : 0;

      if (minPop <= 0) {
        return 1;
      }

      const deficit = clamp((minPop - popCount) / minPop, 0, 1);

      return 0.75 + deficit * 0.5;
    })();

    const scarcityImpulse = scarcityClamped * (0.4 + (1 - baseProb) * 0.6);
    const urgency =
      scarcityImpulse *
      deficitBoost *
      (cooperativePull * 0.6 + fertilityDrive * 0.25 + explorationPush * 0.15);
    const caution = clamp(0.35 + (1 - risk) * 0.55, 0.2, 0.9);
    const eagerness = clamp(urgency * (1 - caution), -0.35, 1.25);
    const heuristicDrive = clamp(1 + eagerness, 0.5, 1.9);

    if (!this.#canUseNeuralPolicies()) {
      return heuristicDrive;
    }

    const reproductionOutcome = this.#getDecisionOutcome("reproduction");
    const reproductionContext = this._decisionContextIndex?.get("reproduction") ?? null;

    if (!reproductionOutcome) {
      return heuristicDrive;
    }

    const safeNumber = (value, fallback = 0) =>
      Number.isFinite(value) ? value : fallback;

    const sensors =
      reproductionContext && reproductionContext.sensors
        ? reproductionContext.sensors
        : {};
    const readSensor = (key, fallback = 0) =>
      clamp(safeNumber(sensors?.[key], fallback), -1, 1);
    const baseSensorProbability = clamp(
      safeNumber(sensors?.baseReproductionProbability, baseProb),
      0,
      1,
    );
    const neuralProbability = clamp(
      safeNumber(
        reproductionOutcome.neuralProbability,
        reproductionOutcome.probability ?? baseSensorProbability,
      ),
      0,
      1,
    );
    const finalProbability = clamp(
      safeNumber(reproductionOutcome.probability, neuralProbability),
      0,
      1,
    );
    const neuralBlendWeight = clamp(
      safeNumber(reproductionOutcome.neuralBlendWeight, 0),
      0,
      1,
    );
    const neuralDelta = clamp(
      safeNumber(
        reproductionOutcome.neuralDelta,
        neuralProbability - baseSensorProbability,
      ),
      -1,
      1,
    );
    const probabilityLift = clamp(finalProbability - baseSensorProbability, -1, 1);
    const scarcityMemory = readSensor("scarcityMemory", 0);
    const confidenceMemory = readSensor("confidenceMemory", 0);
    const opportunitySignal = readSensor("opportunitySignal", 0);
    const neuralActivationTilt = (() => {
      const logits = reproductionOutcome.logits;

      if (!logits || typeof logits !== "object") {
        return 0;
      }

      const acceptLogit = safeNumber(logits.accept, 0);
      const declineLogit = safeNumber(logits.decline, 0);
      const delta = clamp(acceptLogit - declineLogit, -16, 16);

      return clamp(delta / 6, -1, 1);
    })();
    const scarcityTilt = clamp(
      scarcityClamped + Math.max(0, scarcityMemory) * 0.55,
      0,
      1.8,
    );
    const confidenceLift = clamp(0.5 + Math.max(0, confidenceMemory) * 0.4, 0.3, 1.4);
    const opportunityLift = clamp(1 + opportunitySignal * 0.25, 0.6, 1.4);
    const neuralImpulse = clamp(
      neuralDelta * (0.6 + neuralBlendWeight * 0.4) +
        probabilityLift * 0.35 +
        neuralActivationTilt * 0.25,
      -1,
      1,
    );
    const neuralDrive = clamp(
      1 + neuralImpulse * scarcityTilt * confidenceLift * opportunityLift,
      0.35,
      2.4,
    );
    const neuralMix = clamp(
      neuralBlendWeight * 0.6 + Math.abs(neuralImpulse) * 0.3,
      0,
      0.9,
    );
    const resolvedMix = reproductionOutcome.usedNetwork ? neuralMix : 0;
    const result = clamp(
      heuristicDrive * (1 - resolvedMix) + neuralDrive * resolvedMix,
      0.45,
      2.2,
    );

    this.#assignDecisionOutcome("reproduction", {
      scarcityDrive: {
        scarcity: scarcityClamped,
        heuristic: heuristicDrive,
        neuralDrive,
        result,
        neuralImpulse,
        neuralDelta,
        probabilityLift,
        neuralMix: resolvedMix,
        neuralWeight: neuralBlendWeight,
        baseProbability: baseProb,
        baseSensorProbability,
        finalProbability,
        neuralProbability,
        usedNetwork: Boolean(reproductionOutcome.usedNetwork),
        scarcityMemory,
        confidenceMemory,
        opportunitySignal,
      },
    });

    return result;
  }

  computeReproductionProbability(
    partner,
    {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy = MAX_TILE_ENERGY,
      tileEnergy = null,
      tileEnergyDelta = 0,
    } = {},
  ) {
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
    const energyCap = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const energyA = clamp(
      Number.isFinite(this.energy) ? this.energy / energyCap : 0,
      0,
      1,
    );
    const energyB = clamp(
      Number.isFinite(partner?.energy) ? partner.energy / energyCap : 0,
      0,
      1,
    );
    const energyMean = (energyA + energyB) / 2;
    const resourceAvailability = clamp(
      Number.isFinite(tileEnergy) ? tileEnergy : energyMean,
      0,
      1,
    );
    const resourceDecline = clamp(
      -(Number.isFinite(tileEnergyDelta) ? tileEnergyDelta : 0),
      0,
      1,
    );
    const fertilityA =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.FERTILITY)
        : 0.5;
    const fertilityB =
      typeof partner?.dna?.geneFraction === "function"
        ? partner.dna.geneFraction(GENE_LOCI.FERTILITY)
        : 0.5;
    const parentalA =
      typeof this.dna?.geneFraction === "function"
        ? this.dna.geneFraction(GENE_LOCI.PARENTAL)
        : 0.5;
    const parentalB =
      typeof partner?.dna?.geneFraction === "function"
        ? partner.dna.geneFraction(GENE_LOCI.PARENTAL)
        : 0.5;
    const fertilityDrive = clamp((fertilityA + fertilityB) / 2, 0, 1);
    const parentalDrive = clamp((parentalA + parentalB) / 2, 0, 1);
    const partnerSimilarity = clamp(
      this.#safeSimilarityTo(partner, {
        context: "reproduction probability similarity",
        fallback: 0.5,
      }),
      0,
      1,
    );
    const diversityDrive = this.#resolveDiversityDrive({
      availableDiversity: clamp(1 - partnerSimilarity, 0, 1),
    });
    const survivalInstinct = clamp(
      this.neuralReinforcementProfile?.survivalInstinct ?? 0.5,
      0,
      1.5,
    );
    const fertilityUrge = clamp(
      this.neuralReinforcementProfile?.fertilityUrge ?? fertilityDrive,
      0,
      1.5,
    );
    const energySupport = clamp(
      0.55 + energyMean * 0.45 + resourceAvailability * 0.25 - resourceDecline * 0.3,
      0.3,
      1.35,
    );
    const driveBoost = clamp(
      0.6 + fertilityDrive * 0.25 + parentalDrive * 0.2 + fertilityUrge * 0.1,
      0.4,
      1.35,
    );
    const scarcity = clamp(1 - energyMean, 0, 1);
    const cautionFactor = clamp(1 - scarcity * survivalInstinct * 0.28, 0.55, 1);
    const energyMultiplier = clamp(
      energySupport * driveBoost * cautionFactor,
      0.25,
      1.4,
    );
    const diversityMultiplier =
      diversityDrive >= 0
        ? clamp(1 + diversityDrive * (0.18 + fertilityDrive * 0.12), 0.65, 1.6)
        : clamp(1 + diversityDrive * (0.22 + parentalDrive * 0.1), 0.45, 1.2);
    const baseProbability = baseReproProb * reproMul * Math.max(0.2, senPenalty);
    const adjustedProbability =
      baseProbability * energyMultiplier * diversityMultiplier;

    return Math.min(0.95, Math.max(0.01, adjustedProbability));
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
    const outputs = this.#evaluateBrainGroup("reproduction", sensors);

    if (!outputs) {
      return { probability: baseProbability, usedNetwork: false };
    }

    const entries = OUTPUT_GROUPS.reproduction;
    const logits = entries.map(({ key }) => outputs[key] ?? 0);
    const probs = softmax(logits);
    const acceptIndex = entries.findIndex((entry) => entry.key === "accept");
    const yes = acceptIndex >= 0 ? clamp(probs[acceptIndex] ?? 0, 0, 1) : 0;
    const evaluation =
      this.brain?.lastEvaluation?.group === "reproduction"
        ? this.brain.lastEvaluation
        : null;
    const {
      probability,
      weight: neuralBlendWeight,
      neuralDelta,
    } = this.#blendReproductionProbability({
      baseProbability,
      neuralProbability: yes,
      sensors,
      evaluation,
    });

    this.#assignDecisionOutcome("reproduction", {
      probability,
      usedNetwork: true,
      baseProbability,
      neuralProbability: yes,
      neuralBlendWeight,
      neuralDelta,
      logits: entries.reduce((acc, { key }, idx) => {
        acc[key] = logits[idx] ?? 0;

        return acc;
      }, {}),
    });

    return { probability, usedNetwork: true };
  }

  resolveReproductionEnergyThreshold(
    partner,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      maxTileEnergy = MAX_TILE_ENERGY,
      baseProbability = null,
      tileEnergy = null,
      tileEnergyDelta = 0,
    } = {},
  ) {
    const energyCap = Math.max(
      1e-4,
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1,
    );
    const baseFraction = clamp(
      typeof this.dna?.reproductionThresholdFrac === "function"
        ? this.dna.reproductionThresholdFrac()
        : 0.4,
      0,
      1,
    );
    const baseEnergy = baseFraction * energyCap;

    if (!this.#canUseNeuralPolicies()) {
      return baseEnergy;
    }

    const clampProb = (value) => (Number.isFinite(value) ? clamp(value, 0, 1) : null);
    const clampSigned = (value) =>
      Number.isFinite(value) ? clamp(value, -1, 1) : null;
    const outcome = this.#getDecisionOutcome("reproduction");

    let baseProb = clampProb(baseProbability ?? outcome?.baseProbability ?? null);
    let neuralProb = clampProb(outcome?.neuralProbability ?? null);
    let finalProb = clampProb(outcome?.probability ?? null);
    let neuralDelta = clampSigned(outcome?.neuralDelta ?? null);
    let blendWeight = clampProb(outcome?.neuralBlendWeight ?? null);
    let evaluationSource = outcome?.usedNetwork ? "decision" : null;

    let previewSensors = null;

    if (!outcome || !outcome.usedNetwork) {
      const fallbackBase =
        baseProb != null
          ? baseProb
          : this.computeReproductionProbability(partner, {
              localDensity,
              densityEffectMultiplier,
              maxTileEnergy,
              tileEnergy,
              tileEnergyDelta,
            });

      previewSensors = this.#reproductionSensors(partner, {
        localDensity,
        densityEffectMultiplier,
        maxTileEnergy,
        baseProbability: fallbackBase,
        tileEnergy,
        tileEnergyDelta,
      });

      const preview = this.#previewBrainGroup("reproduction", previewSensors);

      if (preview?.values) {
        evaluationSource = "preview";
        const entries = OUTPUT_GROUPS.reproduction;
        const logits = entries.map(({ key }) => preview.values[key] ?? 0);
        const probabilities = softmax(logits);
        const acceptIndex = entries.findIndex((entry) => entry.key === "accept");

        if (acceptIndex >= 0) {
          neuralProb = clamp(probabilities[acceptIndex] ?? neuralProb ?? 0, 0, 1);
        }

        if (baseProb == null) {
          baseProb = clampProb(previewSensors.baseReproductionProbability ?? null);
        }
      }
    }

    if (baseProb == null) {
      baseProb = clampProb(
        this.computeReproductionProbability(partner, {
          localDensity,
          densityEffectMultiplier,
          maxTileEnergy,
          tileEnergy,
          tileEnergyDelta,
        }),
      );
    }

    const deltaCandidates = [];
    const finalDelta =
      finalProb != null && baseProb != null ? finalProb - baseProb : null;
    const neuralProbDelta =
      neuralProb != null && baseProb != null ? neuralProb - baseProb : null;

    if (neuralDelta != null) deltaCandidates.push(clampSigned(neuralDelta));
    if (finalDelta != null) deltaCandidates.push(clampSigned(finalDelta));
    if (neuralProbDelta != null) deltaCandidates.push(clampSigned(neuralProbDelta));

    let effectiveDelta = 0;

    if (deltaCandidates.length > 0) {
      effectiveDelta = deltaCandidates.reduce(
        (best, candidate) => (Math.abs(candidate) > Math.abs(best) ? candidate : best),
        deltaCandidates[0],
      );
    }

    const neuralConfidence = deltaCandidates.reduce(
      (max, value) => Math.max(max, Math.abs(value)),
      0,
    );
    const neuralWeight = Number.isFinite(blendWeight)
      ? clamp(blendWeight, 0, 1)
      : outcome?.usedNetwork
        ? 0.5
        : 0;
    const modulation = clamp(
      0.3 + neuralConfidence * 0.4 + neuralWeight * 0.3,
      0.2,
      0.9,
    );
    const adjustment = clamp(effectiveDelta * modulation, -0.6, 0.6);
    const rawFraction = baseFraction * (1 - adjustment);
    const adjustedFraction = (() => {
      if (rawFraction > baseFraction) {
        const maxIncrease = baseFraction + Math.min(0.15, baseFraction * 0.35);

        return clamp(Math.min(rawFraction, maxIncrease), 0, 0.95);
      }

      return clamp(rawFraction, 0, 0.95);
    })();
    const adjustedEnergy = adjustedFraction * energyCap;

    this.#assignDecisionOutcome("reproduction", {
      energyThreshold: {
        baseFraction,
        baseEnergy,
        adjustedFraction,
        adjustedEnergy,
        neuralBias: effectiveDelta,
        neuralConfidence,
        neuralWeight,
        source: evaluationSource ?? "baseline",
      },
    });

    return adjustedEnergy;
  }

  #fallbackInteractionDecision({
    localDensity = 0,
    densityEffectMultiplier = 1,
    enemies = [],
    allies = [],
    maxTileEnergy = MAX_TILE_ENERGY,
    tileEnergy = null,
    tileEnergyDelta = 0,
  } = {}) {
    const genes = this.interactionGenes || {
      avoid: 0.33,
      fight: 0.33,
      cooperate: 0.34,
    };
    const avoidBase = Math.max(0.0001, genes.avoid ?? 0);
    const fightBase = Math.max(0.0001, genes.fight ?? 0);
    const cooperateBase = Math.max(0.0001, genes.cooperate ?? 0);
    const effDensity = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const comfort = clamp(
      Number.isFinite(this._crowdingTolerance)
        ? this._crowdingTolerance
        : Number.isFinite(this.baseCrowdingTolerance)
          ? this.baseCrowdingTolerance
          : 0.5,
      0,
      1,
    );
    const crowdPressure = effDensity > comfort ? effDensity - comfort : 0;
    const crowdRelief = effDensity < comfort ? comfort - effDensity : 0;
    const energyCap =
      Number.isFinite(maxTileEnergy) && maxTileEnergy > 0
        ? maxTileEnergy
        : MAX_TILE_ENERGY || 1;
    const normalizedEnergy = clamp((this.energy ?? 0) / energyCap, 0, 1);
    const tileLevel =
      tileEnergy != null && Number.isFinite(tileEnergy)
        ? clamp(tileEnergy, 0, 1)
        : normalizedEnergy;
    const scarcity = clamp(1 - tileLevel, 0, 1);
    const energyTrend = clamp(tileEnergyDelta ?? 0, -1, 1);
    const riskTolerance = clamp(this.#resolveRiskTolerance(), 0, 1);
    const resilience = clamp(this.dna?.recoveryRate?.() ?? 0.35, 0, 1);
    const interactionMomentum = this.#resolveInteractionMomentum();
    const { scarcityMemory, confidenceMemory } = this.#riskMemorySensorValues();
    const allyCount = Array.isArray(allies) ? allies.length : 0;
    const enemyCount = Array.isArray(enemies) ? enemies.length : 0;
    const allyKinship = this.#averageSimilarity(allies);
    const allyPresence = allyCount > 0 ? clamp(allyCount / 4, 0, 1) : 0;
    const cooperativeDriveRaw =
      typeof this.dna?.cooperateShareFrac === "function"
        ? this.dna.cooperateShareFrac({
            energyDelta: energyTrend,
            kinship: allyKinship,
          })
        : 0.3;
    const cooperativeDrive = clamp(cooperativeDriveRaw, 0, 1);
    const currentRow = Number.isFinite(this.row) ? this.row : 0;
    const currentCol = Number.isFinite(this.col) ? this.col : 0;
    let enemyThreat = 0;
    let advantage = 0;

    if (enemyCount > 0) {
      let totalThreat = 0;
      let totalEnergy = 0;
      let considered = 0;

      for (const descriptor of enemies) {
        const target = descriptor?.target;

        if (!target) continue;

        const enemyEnergy = clamp(
          (Number.isFinite(target.energy) ? target.energy : 0) / energyCap,
          0,
          2,
        );
        const enemyRow = Number.isFinite(descriptor?.row)
          ? descriptor.row
          : Number.isFinite(target?.row)
            ? target.row
            : currentRow;
        const enemyCol = Number.isFinite(descriptor?.col)
          ? descriptor.col
          : Number.isFinite(target?.col)
            ? target.col
            : currentCol;
        const distance = Math.max(
          Math.abs(enemyRow - currentRow),
          Math.abs(enemyCol - currentCol),
        );
        const proximity = distance <= 0 ? 1 : 1 / Math.max(1, distance);
        const similarity = Number.isFinite(descriptor?.precomputedSimilarity)
          ? descriptor.precomputedSimilarity
          : this.#safeSimilarityTo(target, {
              context: "interaction fallback threat similarity",
              fallback: 0,
            });
        const hostility = clamp(
          1 - (Number.isFinite(similarity) ? similarity : 0),
          0,
          1,
        );

        totalEnergy += enemyEnergy;
        totalThreat += enemyEnergy * 0.6 + hostility * 0.4 + proximity * 0.5;
        considered++;
      }

      if (considered > 0) {
        const averageEnergy = totalEnergy / considered;

        advantage = clamp(normalizedEnergy - averageEnergy, -1, 1);
        enemyThreat = clamp(totalThreat / considered + enemyCount * 0.05, 0, 3);
      }
    }

    let avoidScore =
      avoidBase +
      enemyThreat * (0.5 + (1 - riskTolerance) * 0.4) +
      crowdPressure * (0.4 + (1 - riskTolerance) * 0.2) +
      scarcity * (0.35 + (1 - resilience) * 0.25) +
      Math.max(0, -advantage) * (0.45 + (1 - resilience) * 0.35);

    avoidScore += Math.max(0, -confidenceMemory) * 0.2;
    avoidScore += scarcityMemory * 0.3;
    avoidScore += Math.max(0, -energyTrend) * 0.15;
    avoidScore = Math.max(0.0001, avoidScore);

    let fightScore =
      fightBase +
      advantage * (0.7 + riskTolerance * 0.6) +
      riskTolerance * 0.3 +
      crowdRelief * 0.15 +
      (interactionMomentum > 0
        ? interactionMomentum * 0.4
        : interactionMomentum * 0.1) +
      Math.max(0, confidenceMemory) * 0.25 +
      Math.max(0, energyTrend) * 0.15;

    fightScore -=
      Math.max(0, enemyThreat - Math.max(0, advantage)) *
      (0.35 + (1 - resilience) * 0.2);
    fightScore = Math.max(0.0001, fightScore);

    let cooperateScore =
      cooperateBase +
      allyPresence * 0.35 +
      allyKinship * 0.5 +
      cooperativeDrive * 0.6 +
      crowdRelief * 0.35 +
      (1 - scarcity) * 0.4 +
      Math.max(0, -interactionMomentum) * 0.2;

    cooperateScore -= enemyThreat * 0.25;
    cooperateScore -= Math.max(0, crowdPressure) * 0.1;
    cooperateScore = Math.max(0.0001, cooperateScore);

    const totalScore = avoidScore + fightScore + cooperateScore;

    if (!(totalScore > 0)) {
      return {
        action: "avoid",
        probabilities: { avoid: 1, fight: 0, cooperate: 0 },
        scores: { avoid: avoidScore, fight: fightScore, cooperate: cooperateScore },
      };
    }

    const probabilities = {
      avoid: avoidScore / totalScore,
      fight: fightScore / totalScore,
      cooperate: cooperateScore / totalScore,
    };
    const fallbackRng = this.resolveRng(
      "interactionFallback",
      this.resolveRng("legacyInteractionChoice"),
    );
    const roll = randomRange(0, totalScore, fallbackRng);

    let action = "cooperate";

    if (roll < avoidScore) {
      action = "avoid";
    } else if (roll < avoidScore + fightScore) {
      action = "fight";
    }

    return {
      action,
      probabilities,
      scores: { avoid: avoidScore, fight: fightScore, cooperate: cooperateScore },
    };
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
      this.#fallbackInteractionDecision({
        localDensity,
        densityEffectMultiplier,
        enemies,
        allies,
        maxTileEnergy,
        tileEnergy,
        tileEnergyDelta,
      });
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

      labels.forEach((label, index) => {
        probabilitiesByKey[label] = probs[index] ?? 0;
      });

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

    const fallbackDecision = fallback();
    const fallbackAction = fallbackDecision?.action ?? null;
    const fallbackProbabilities =
      fallbackDecision?.probabilities &&
      typeof fallbackDecision.probabilities === "object"
        ? fallbackDecision.probabilities
        : fallbackAction
          ? {
              avoid: fallbackAction === "avoid" ? 1 : 0,
              fight: fallbackAction === "fight" ? 1 : 0,
              cooperate: fallbackAction === "cooperate" ? 1 : 0,
            }
          : null;

    this.#assignDecisionOutcome("interaction", {
      action: fallbackAction,
      usedNetwork: false,
      probabilities: fallbackProbabilities,
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

        Object.entries(fallbackNormalized).forEach(([key, fallbackValue]) => {
          const neuralValue = neuralNormalized[key] ?? fallbackValue;

          combinedNormalized[key] = lerp(fallbackValue, neuralValue, influence);
        });

        const combinedTotal = Object.values(combinedNormalized).reduce(
          (sum, value) => sum + value,
          0,
        );
        const scaling =
          combinedTotal > 0 ? fallbackTotal / combinedTotal : fallbackTotal;

        Object.entries(combinedNormalized).forEach(([key, value]) => {
          const normalized = combinedTotal > 0 ? value / combinedTotal : 0.25;

          combinedNormalized[key] = normalized;
          weights[key] = Math.max(0.0001, normalized * (scaling || 1));
        });

        decisionDetails = {
          usedNetwork: true,
          probabilities: probabilitiesByKey,
          logits: logitsByKey,
          weights: { ...combinedNormalized },
        };
      }
    }

    const bestCandidate = enemies.reduce(
      (bestAcc, enemy) => {
        if (!enemy || !enemy.target) {
          return bestAcc;
        }

        const row = enemy.row ?? enemy.target.row ?? this.row;
        const col = enemy.col ?? enemy.target.col ?? this.col;
        const dist = Math.max(Math.abs(row - this.row), Math.abs(col - this.col));
        const enemyEnergy = Number.isFinite(enemy.target.energy)
          ? enemy.target.energy
          : 0;
        const diff = clamp(((this.energy ?? 0) - enemyEnergy) / energyCap, -1, 1);
        const weakSignal = clamp(1 + diff, 0.05, 1.95);
        const strongSignal = clamp(1 - diff, 0.05, 1.95);
        const proximitySignal = clamp(
          1 / (1 + (Number.isFinite(dist) ? dist : 0)),
          0,
          1,
        );
        const attritionSignal = enemy.target.lifespan
          ? clamp((enemy.target.age ?? 0) / enemy.target.lifespan, 0, 1)
          : 0;
        const score =
          weights.weak * weakSignal +
          weights.strong * strongSignal +
          weights.proximity * proximitySignal +
          weights.attrition * attritionSignal;

        if (score <= bestAcc.score) {
          return bestAcc;
        }

        const similarity = clamp(
          this.#safeSimilarityTo(enemy.target, {
            context: "targeting decision similarity ranking",
            fallback: 0,
          }),
          0,
          1,
        );

        return {
          enemy,
          score,
          summary: {
            row: enemy.row,
            col: enemy.col,
            energy: enemyEnergy,
            distance: Number.isFinite(dist) ? dist : null,
            similarity,
            attrition: attritionSignal,
          },
        };
      },
      { enemy: null, score: -Infinity, summary: null },
    );

    let { enemy: best, summary: chosenSummary } = bestCandidate;

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
    options = {},
  ) {
    const events = Array.isArray(currentEvent)
      ? currentEvent
      : currentEvent
        ? [currentEvent]
        : [];
    const eventContext = resolveEventContext(options?.eventContext);
    const effectCache = resolveEffectCache(options?.effectCache);

    const { appliedEvents } = accumulateEventModifiers({
      events,
      row,
      col,
      eventStrengthMultiplier,
      isEventAffecting: eventContext.isEventAffecting,
      getEventEffect: eventContext.getEventEffect,
      effectCache,
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

    let totalDrain = 0;

    for (const { event, effect, strength } of appliedEvents) {
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
      let susceptibility = 1;

      if (typeof this.dna?.eventEnergyLossMultiplier === "function") {
        const eventType =
          typeof event?.eventType === "string" ? event.eventType : undefined;
        const multiplier = this.dna.eventEnergyLossMultiplier(eventType, {
          effect,
          strength: cellStrength,
          baseLoss: energyLoss,
        });

        if (Number.isFinite(multiplier) && multiplier > 0) {
          susceptibility = clamp(multiplier, 0.25, 2);
        }
      }

      const mitigatedImpact =
        energyLoss * cellStrength * susceptibility * (1 - resistance);

      const netDrain = mitigatedImpact * (1 - mitigation);

      this.energy -= netDrain;
      totalDrain += Math.max(0, netDrain);

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

    this._reinforceEventAnticipation({
      previousPressure,
      nextPressure: this.lastEventPressure,
      pressurePeak,
      energyDrain: totalDrain,
      maxTileEnergy,
    });
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
      partner,
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
    partner = null,
  } = {}) {
    const baseShare = clamp(Number.isFinite(baseline) ? baseline : 0, 0, 1);
    const sensors = this.#cooperationSensors(partner, {
      selfEnergy,
      partnerEnergy,
      kinship,
    });
    const values = this.#evaluateBrainGroup("cooperationShare", sensors);

    if (!values) {
      const fallback = this.#legacyCooperationShareFraction({
        baseShare,
        selfEnergy,
        partnerEnergy,
        kinship,
      });

      this.#assignDecisionOutcome("cooperationShare", {
        usedNetwork: false,
        baseShare,
        share: fallback.share,
        neuralTarget: fallback.neuralTarget ?? null,
        neuralMix: fallback.neuralMix ?? 0,
        neuralSignal: fallback.neuralSignal ?? null,
      });

      return fallback;
    }

    const entries = OUTPUT_GROUPS.cooperationShare;
    const logits = entries.map(({ key }) => values[key] ?? 0);
    const probabilities = softmax(logits);
    const logitsByKey = {};
    const probabilitiesByKey = {};

    for (let i = 0; i < entries.length; i++) {
      const { key } = entries[i];

      logitsByKey[key] = logits[i] ?? 0;
      probabilitiesByKey[key] = probabilities[i] ?? 0;
    }

    const conserveProb = clamp(probabilitiesByKey.conserve ?? 0, 0, 1);
    const reciprocateProb = clamp(probabilitiesByKey.reciprocate ?? 0, 0, 1);
    const amplifyProb = clamp(probabilitiesByKey.amplify ?? 0, 0, 1);
    const probabilitySummary = [
      { key: "conserve", probability: conserveProb },
      { key: "reciprocate", probability: reciprocateProb },
      { key: "amplify", probability: amplifyProb },
    ];
    const { dominantIntent, runnerUpIntent } = probabilitySummary.reduce(
      (acc, entry, index) => {
        if (index === 0) {
          acc.dominantIntent = entry;

          return acc;
        }

        if (entry.probability > acc.dominantIntent.probability) {
          acc.runnerUpIntent = acc.dominantIntent;
          acc.dominantIntent = entry;
        } else if (entry.probability > acc.runnerUpIntent.probability) {
          acc.runnerUpIntent = entry;
        }

        return acc;
      },
      {
        dominantIntent: { key: null, probability: 0 },
        runnerUpIntent: { key: null, probability: 0 },
      },
    );

    const preference = clamp(amplifyProb - conserveProb, -1, 1);
    const balanceLean = clamp(reciprocateProb - 1 / Math.max(1, entries.length), -1, 1);
    const kin = clamp(Number.isFinite(kinship) ? kinship : 0, 0, 1);
    const self = clamp(Number.isFinite(selfEnergy) ? selfEnergy : 0, 0, 1);
    const partnerNorm = clamp(
      Number.isFinite(partnerEnergy) ? partnerEnergy : self,
      0,
      1,
    );
    const energyDelta = clamp(partnerNorm - self, -1, 1);
    const selfNeed = Math.max(0, energyDelta);
    const partnerNeed = Math.max(0, -energyDelta);
    const opportunity = clamp(sensors.opportunitySignal ?? 0, -1, 1);
    const totalProbability = probabilitySummary.reduce(
      (sum, entry) => sum + entry.probability,
      0,
    );
    const conserveAnchor = clamp(
      baseShare * (0.35 + kin * 0.2) -
        selfNeed * (0.4 + (1 - kin) * 0.2) +
        partnerNeed * 0.12 -
        Math.min(0, opportunity) * 0.1,
      0,
      1,
    );
    const reciprocateAnchor = clamp(baseShare + (partnerNeed - selfNeed) * 0.35, 0, 1);
    const amplifyAnchor = clamp(
      baseShare +
        partnerNeed * (0.6 + kin * 0.3 + Math.max(0, opportunity) * 0.3) -
        selfNeed * 0.2 +
        Math.max(0, opportunity) * 0.2,
      0,
      1,
    );
    const anchorByKey = {
      conserve: conserveAnchor,
      reciprocate: reciprocateAnchor,
      amplify: amplifyAnchor,
    };
    let neuralTarget = baseShare;

    if (totalProbability > 1e-6) {
      let weightedTarget = 0;

      for (let i = 0; i < probabilitySummary.length; i++) {
        const entry = probabilitySummary[i];
        const anchor = anchorByKey[entry.key];

        weightedTarget += entry.probability * (anchor ?? baseShare);
      }

      neuralTarget = clamp(weightedTarget / totalProbability, 0, 1);
    }

    const neuralAdvantage = Math.max(
      0,
      dominantIntent.probability - runnerUpIntent.probability,
    );

    const evaluation =
      this.brain?.lastEvaluation?.group === "cooperationShare"
        ? this.brain.lastEvaluation
        : null;
    const { weight: neuralMix } = this.#resolveCooperationNeuralWeight({
      sensors,
      evaluation,
      preference,
      balanceLean,
    });
    const share = clamp(lerp(baseShare, neuralTarget, neuralMix), 0, 1);
    const neuralSignal = preference;

    this.#assignDecisionOutcome("cooperationShare", {
      usedNetwork: true,
      baseShare,
      share,
      neuralTarget,
      neuralMix,
      neuralSignal,
      neuralAnchors: anchorByKey,
      neuralDominant: dominantIntent?.key ?? null,
      neuralAdvantage,
      probabilities: probabilitiesByKey,
      logits: logitsByKey,
    });

    return {
      share,
      baseShare,
      neuralTarget,
      neuralMix,
      neuralSignal,
      neuralAnchors: anchorByKey,
      neuralDominant: dominantIntent?.key ?? null,
      neuralAdvantage,
    };
  }

  #legacyCooperationShareFraction({
    baseShare = 0,
    selfEnergy = 0,
    partnerEnergy = 0,
    kinship = 0,
  } = {}) {
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
