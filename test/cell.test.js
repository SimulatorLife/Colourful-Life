import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

let Cell;
let DNA;
let GENE_LOCI;
let clamp;
let clampFinite;
let lerp;
let randomRange;
let createRNG;
let InteractionSystem;
let Brain;
let OUTPUT_GROUPS;
let OFFSPRING_VIABILITY_BUFFER;
let REPRODUCTION_COOLDOWN_BASE;

function investmentFor(
  energy,
  investFrac,
  starvation,
  demandFrac,
  maxTileEnergy,
  requiredShare = 0,
) {
  const safeMax = Number.isFinite(maxTileEnergy)
    ? maxTileEnergy
    : (window.GridManager?.maxTileEnergy ?? 12);
  const targetEnergy = safeMax * clampFinite(demandFrac, 0, 1, 0.22);
  const desiredBase = Math.max(0, Math.min(energy, energy * investFrac));
  const desired = Math.max(desiredBase, targetEnergy, requiredShare);
  const maxSpend = Math.max(0, energy - starvation);

  return Math.min(desired, maxSpend);
}

function combinedTransferEfficiency(dnaA, dnaB) {
  const resolve = (dna) =>
    typeof dna?.offspringEnergyTransferEfficiency === "function"
      ? dna.offspringEnergyTransferEfficiency()
      : 0.85;
  const effA = clamp(resolve(dnaA), 0.1, 1);
  const effB = clamp(resolve(dnaB), 0.1, 1);

  return clamp((effA + effB) / 2, 0.1, 1);
}

function withMockedRandom(sequence, fn) {
  const original = Math.random;
  let index = 0;

  Math.random = () => {
    if (index >= sequence.length) {
      throw new Error(`Mocked Math.random exhausted after ${index} calls`);
    }

    return sequence[index++];
  };

  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function createReproductionBrainStub({
  accept = 4,
  decline = -2,
  activationCount = 6,
} = {}) {
  return {
    connectionCount: 1,
    evaluateGroup(group) {
      if (group !== "reproduction") {
        return null;
      }

      const values = { decline, accept };
      const sensors = new Float32Array(Brain.SENSOR_COUNT);
      const result = {
        values,
        activationCount,
        sensors,
        trace: { nodes: [] },
      };

      this.lastEvaluation = { ...result, group, values };

      return result;
    },
  };
}

function createInteractionBrainStub({ sequence = [] } = {}) {
  const entries = Array.isArray(sequence) && sequence.length > 0 ? sequence : [{}];
  let index = 0;

  return {
    connectionCount: 1,
    evaluateGroup(group, _sensors, options = {}) {
      if (group !== "interaction") {
        return null;
      }

      const config = entries[Math.min(index, entries.length - 1)] ?? {};

      index += 1;

      const probabilities = config.probabilities || {
        avoid: 1 / 3,
        fight: 1 / 3,
        cooperate: 1 / 3,
      };
      const safeProb = (value) => Math.max(1e-6, Number(value) || 0);
      const values = {
        avoid: Math.log(safeProb(probabilities.avoid)),
        fight: Math.log(safeProb(probabilities.fight)),
        cooperate: Math.log(safeProb(probabilities.cooperate)),
      };
      const sensors = new Float32Array(Brain.SENSOR_COUNT);
      const result = {
        values,
        activationCount: config.activationCount ?? 4,
        sensors,
        trace: options.trace === false ? null : { nodes: [] },
      };

      this.lastEvaluation = { ...result, group, values };

      return result;
    },
  };
}

test.before(async () => {
  ({ default: Cell } = await import("../src/cell.js"));
  ({ DNA, GENE_LOCI } = await import("../src/genome.js"));
  ({ clamp, clampFinite, lerp, randomRange, createRNG } = await import(
    "../src/utils/math.js"
  ));
  ({ default: InteractionSystem } = await import("../src/interactionSystem.js"));
  ({ default: Brain, OUTPUT_GROUPS } = await import("../src/brain.js"));
  ({ OFFSPRING_VIABILITY_BUFFER, REPRODUCTION_COOLDOWN_BASE } = await import(
    "../src/config.js"
  ));
  if (typeof global.window === "undefined") global.window = globalThis;
  if (!window.GridManager) window.GridManager = {};
  if (typeof window.GridManager.maxTileEnergy !== "number") {
    window.GridManager.maxTileEnergy = 12;
  }
});

function predictDeterministicOffspring(
  dnaA,
  dnaB,
  mutationChance,
  mutationRange,
  entropyRoll = 0,
  rngOverride = null,
) {
  const parentSeed = (dnaA.seed() ^ dnaB.seed()) >>> 0;
  const entropy = Math.floor(entropyRoll * 0xffffffff) >>> 0;
  const rng =
    typeof rngOverride === "function"
      ? rngOverride
      : createRNG((parentSeed ^ entropy) >>> 0);
  const blendA = typeof dnaA.crossoverMix === "function" ? dnaA.crossoverMix() : 0.5;
  const blendB = typeof dnaB.crossoverMix === "function" ? dnaB.crossoverMix() : 0.5;
  const blendProbability = clamp((blendA + blendB) / 2, 0, 1);
  const range = Math.max(0, mutationRange | 0);
  const geneCount = Math.max(dnaA.length ?? 0, dnaB.length ?? 0);

  const mixGene = (a, b) => {
    let value;

    if (rng() < blendProbability) {
      const weight = rng();

      value = Math.round(a * weight + b * (1 - weight));
    } else {
      value = rng() < 0.5 ? a : b;
    }

    if (rng() < mutationChance) {
      value += Math.floor(randomRange(-1, 1, rng) * range);
    }

    return Math.max(0, Math.min(255, value));
  };

  const genes = new Uint8Array(geneCount);

  for (let i = 0; i < geneCount; i++) {
    genes[i] = mixGene(dnaA.geneAt(i), dnaB.geneAt(i));
  }

  return genes;
}

test("startReproductionCooldown respects the environment baseline", () => {
  const dna = new DNA(0, 0, 0);
  const cell = new Cell(0, 0, dna, 6);
  const baseline = Math.max(1, Math.round(REPRODUCTION_COOLDOWN_BASE));

  cell._reproductionCooldown = 0;
  cell.dna.reproductionCooldownTicks = undefined;
  cell.startReproductionCooldown();

  assert.is(
    cell.getReproductionCooldown(),
    baseline,
    "fallback should honor the configured baseline",
  );

  cell._reproductionCooldown = 0;
  cell.dna.reproductionCooldownTicks = () => baseline - 1;
  cell.startReproductionCooldown();

  assert.is(
    cell.getReproductionCooldown(),
    baseline,
    "baseline should clamp DNA values that dip below the floor",
  );

  cell._reproductionCooldown = 0;
  const elevated = baseline + 3.6;

  cell.dna.reproductionCooldownTicks = () => elevated;
  cell.startReproductionCooldown();
  const expectedHigh = Math.max(baseline, Math.round(elevated));

  assert.is(
    cell.getReproductionCooldown(),
    expectedHigh,
    "DNA values above the floor should persist after rounding",
  );
});

test("manageEnergy applies DNA-driven metabolism and starvation rules", () => {
  const dna = new DNA(30, 200, 100);
  const initialEnergy = 5;
  const maxTileEnergy = 12;
  const cell = new Cell(2, 3, dna, initialEnergy);
  const context = {
    localDensity: 0.3,
    densityEffectMultiplier: 2,
    maxTileEnergy,
  };
  const effDensity = clamp(
    context.localDensity * context.densityEffectMultiplier,
    0,
    1,
  );
  const densityResponse = dna.densityResponses().energyLoss;
  const energyDensityMult = lerp(densityResponse.min, densityResponse.max, effDensity);
  const metabolism = cell.metabolism;
  const crowdPenalty = 1 + effDensity * (cell.metabolicCrowdingTax ?? 0);
  const baseLoss = dna.energyLossBase();
  const energyFraction = clamp(initialEnergy / maxTileEnergy, 0, 1);
  const scarcityRelief = dna.energyScarcityRelief(
    energyFraction,
    cell.scarcityReliefProfile,
  );
  const energyLoss =
    baseLoss *
    dna.baseEnergyLossScale() *
    (1 + metabolism) *
    energyDensityMult *
    crowdPenalty *
    cell.ageEnergyMultiplier() *
    scarcityRelief;
  const cognitiveLoss = dna.cognitiveCost(cell.neurons, cell.sight, effDensity);

  const starving = cell.manageEnergy(cell.row, cell.col, context);
  const expectedEnergy = initialEnergy - (energyLoss + cognitiveLoss);
  const starvationThreshold = dna.starvationThresholdFrac() * maxTileEnergy;

  approxEqual(cell.energy, expectedEnergy, 1e-12, "energy after management");
  assert.ok(cell.energy < initialEnergy, "energy should decrease");
  assert.is(starving, expectedEnergy <= starvationThreshold);
});

test("energy scarcity relief profile rewards efficient, cautious genomes", () => {
  const efficientDNA = new DNA(0, 0, 0);

  efficientDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 240;
  efficientDNA.genes[GENE_LOCI.RECOVERY] = 220;
  efficientDNA.genes[GENE_LOCI.RESIST_DROUGHT] = 210;
  efficientDNA.genes[GENE_LOCI.RESIST_HEAT] = 200;
  efficientDNA.genes[GENE_LOCI.PARENTAL] = 180;

  const recklessDNA = new DNA(0, 0, 0);

  recklessDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 20;
  recklessDNA.genes[GENE_LOCI.RISK] = 230;
  recklessDNA.genes[GENE_LOCI.MOVEMENT] = 210;

  const efficient = new Cell(0, 0, efficientDNA, 0.9);
  const reckless = new Cell(0, 0, recklessDNA, 0.9);
  const zeroComponents = () => ({ baseline: 0, dynamic: 0 });

  efficient.dna.cognitiveCostComponents = zeroComponents;
  efficient.dna.cognitiveCost = () => 0;
  reckless.dna.cognitiveCostComponents = zeroComponents;
  reckless.dna.cognitiveCost = () => 0;

  const baseLoss = 0.01;

  efficient.dna.energyLossBase = () => baseLoss;
  reckless.dna.energyLossBase = () => baseLoss;
  efficient.dna.baseEnergyLossScale = () => 1;
  reckless.dna.baseEnergyLossScale = () => 1;
  efficient.metabolism = reckless.metabolism = 0.4;
  efficient.metabolicCrowdingTax = reckless.metabolicCrowdingTax = 0.2;

  const maxTileEnergy = 10;
  const energyFraction = clamp(efficient.energy / maxTileEnergy, 0, 1);
  const efficientRelief = efficientDNA.energyScarcityRelief(
    energyFraction,
    efficient.scarcityReliefProfile,
  );
  const recklessRelief = recklessDNA.energyScarcityRelief(
    energyFraction,
    reckless.scarcityReliefProfile,
  );

  assert.ok(
    efficientRelief < recklessRelief,
    "efficient genomes should throttle metabolism harder under scarcity",
  );

  const context = { localDensity: 0.25, densityEffectMultiplier: 1, maxTileEnergy };
  const efficientBefore = efficient.energy;
  const recklessBefore = reckless.energy;

  efficient.manageEnergy(0, 0, context);
  reckless.manageEnergy(0, 0, context);

  const efficientLoss = efficientBefore - efficient.energy;
  const recklessLoss = recklessBefore - reckless.energy;

  assert.ok(
    efficientLoss < recklessLoss,
    "scarcity relief should reduce upkeep for thrifty genomes",
  );
});

test("DNA metabolic profile reduces crowd losses for crowd-tolerant genomes", () => {
  const tolerantDNA = new DNA(0, 0, 0);

  tolerantDNA.genes[GENE_LOCI.DENSITY] = 240;
  tolerantDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 200;

  const lonerDNA = new DNA(0, 0, 0);

  lonerDNA.genes[GENE_LOCI.DENSITY] = 10;
  lonerDNA.genes[GENE_LOCI.RISK] = 220;

  const tolerant = new Cell(0, 0, tolerantDNA, 6);
  const loner = new Cell(0, 0, lonerDNA, 6);
  const zeroCognitive = () => ({
    baseline: 0,
    dynamic: 0,
    total: 0,
    usageScale: 0,
    densityFactor: 1,
    base: 0,
  });

  tolerant.dna.cognitiveCostComponents = zeroCognitive;
  tolerant.dna.cognitiveCost = () => 0;
  loner.dna.cognitiveCostComponents = zeroCognitive;
  loner.dna.cognitiveCost = () => 0;

  const context = { localDensity: 0.85, densityEffectMultiplier: 1, maxTileEnergy: 10 };
  const tolerantBefore = tolerant.energy;
  const lonerBefore = loner.energy;

  tolerant.manageEnergy(0, 0, context);
  loner.manageEnergy(0, 0, context);

  const tolerantLoss = tolerantBefore - tolerant.energy;
  const lonerLoss = lonerBefore - loner.energy;

  assert.ok(
    tolerant.metabolicCrowdingTax < loner.metabolicCrowdingTax,
    "crowd-tuned DNA should reduce the crowding tax",
  );
  assert.ok(
    tolerantLoss <= lonerLoss + 1e-9,
    "crowd-tuned DNA should lose less energy under crowding",
  );
});

test("harvest crowding penalty blends DNA tolerance and environment signals", () => {
  const tolerantDNA = new DNA(0, 0, 0);

  tolerantDNA.genes[GENE_LOCI.DENSITY] = 255;
  tolerantDNA.genes[GENE_LOCI.EXPLORATION] = 220;
  tolerantDNA.genes[GENE_LOCI.COOPERATION] = 180;
  tolerantDNA.genes[GENE_LOCI.RISK] = 80;
  tolerantDNA.genes[GENE_LOCI.FORAGING] = 200;
  tolerantDNA.genes[GENE_LOCI.ENERGY_CAPACITY] = 200;

  const skittishDNA = new DNA(0, 0, 0);

  skittishDNA.genes[GENE_LOCI.DENSITY] = 10;
  skittishDNA.genes[GENE_LOCI.EXPLORATION] = 0;
  skittishDNA.genes[GENE_LOCI.COOPERATION] = 180;
  skittishDNA.genes[GENE_LOCI.RISK] = 80;
  skittishDNA.genes[GENE_LOCI.FORAGING] = 200;
  skittishDNA.genes[GENE_LOCI.ENERGY_CAPACITY] = 200;

  const tolerant = new Cell(0, 0, tolerantDNA, 2);
  const skittish = new Cell(0, 0, skittishDNA, 2);
  const crowdedContext = {
    density: 0.85,
    tileEnergy: 0.3,
    tileEnergyDelta: -0.4,
    baseRate: 0.45,
    availableEnergy: 0.8,
    maxTileEnergy: 5,
  };

  const tolerantPenalty = tolerant.resolveHarvestCrowdingPenalty(crowdedContext);
  const skittishPenalty = skittish.resolveHarvestCrowdingPenalty(crowdedContext);

  assert.ok(
    tolerantPenalty > skittishPenalty,
    "high density DNA should sustain more harvesting under crowding",
  );

  const tightenedPenalty = skittish.resolveHarvestCrowdingPenalty(crowdedContext);

  assert.ok(
    tightenedPenalty <= skittishPenalty + 1e-9,
    "repeated scarcity should not loosen skittish tolerance",
  );

  const reliefPenalty = skittish.resolveHarvestCrowdingPenalty({
    density: 0.1,
    tileEnergy: 0.9,
    tileEnergyDelta: 0.25,
    baseRate: 0.45,
    availableEnergy: 1,
    maxTileEnergy: 5,
  });

  assert.ok(
    reliefPenalty >= tightenedPenalty,
    "abundant, uncrowded tiles should restore harvesting capacity",
  );
});

test("harvest demand scales with hunger, scarcity, and opportunity cues", () => {
  const dna = new DNA(0, 0, 0);
  const cell = new Cell(0, 0, dna, 0.3);

  cell.metabolism = 0.4;
  cell.metabolicCrowdingTax = 0.2;
  cell.neuralReinforcementProfile = { scarcityDrive: 0.5 };
  cell.resourceTrendAdaptation = 0.4;
  cell.baseCrowdingTolerance = 0.5;
  cell._crowdingTolerance = 0.5;
  cell.dna.starvationThresholdFrac = () => 0.2;

  const demandContext = {
    baseRate: 0.2,
    crowdPenalty: 0.8,
    availableEnergy: 0.8,
    maxTileEnergy: 2,
    minCap: 0.1,
    maxCap: 0.45,
    localDensity: 0.3,
    densityEffectMultiplier: 1.1,
    tileEnergy: 0.45,
    tileEnergyDelta: 0.05,
  };

  const hungryDemand = cell.resolveHarvestDemand(demandContext);

  cell.energy = 1.6;
  const satiatedDemand = cell.resolveHarvestDemand(demandContext);

  assert.ok(
    hungryDemand > satiatedDemand,
    "hungrier organisms should request more energy than satiated ones",
  );

  cell.energy = 0.3;
  cell._opportunitySignal = 0.8;
  const opportunisticDemand = cell.resolveHarvestDemand(demandContext);

  cell._opportunitySignal = -0.8;
  const cautiousDemand = cell.resolveHarvestDemand(demandContext);

  assert.ok(
    opportunisticDemand > hungryDemand + 1e-6,
    "positive opportunity signals should amplify harvesting demand",
  );
  assert.ok(
    cautiousDemand <= hungryDemand + 1e-9,
    "negative opportunity signals should dampen harvesting demand",
  );

  assert.ok(
    opportunisticDemand <= demandContext.maxCap + 1e-9 &&
      cautiousDemand >= demandContext.minCap - 1e-9,
    "harvest demand should respect configured caps",
  );
});

test("movement sensors update DNA-tuned resource trend signal", () => {
  const dna = new DNA(120, 160, 200);

  dna.genes[GENE_LOCI.SENSE] = 200;
  dna.genes[GENE_LOCI.EXPLORATION] = 0;
  dna.genes[GENE_LOCI.RECOVERY] = 25;
  const initialEnergy = 2;
  const cell = new Cell(1, 1, dna, initialEnergy);
  const adaptation = dna.resourceTrendAdaptation();
  const baselineRate = clamp(adaptation * 0.25, 0.01, 0.6);
  const tileEnergy = 0.1;
  const tileEnergyDelta = -0.3;
  const priorBaseline = cell._resourceBaseline;
  const priorDelta = cell._resourceDelta;
  const expectedDelta = lerp(priorDelta, tileEnergyDelta, adaptation);
  const expectedBaseline = lerp(priorBaseline, tileEnergy, baselineRate);
  const expectedDivergence = clamp(tileEnergy - expectedBaseline, -1, 1);
  const expectedSignal = clamp(expectedDelta * 0.7 + expectedDivergence * 0.6, -1, 1);

  cell.chooseMovementStrategy({
    localDensity: 0.2,
    densityEffectMultiplier: 1,
    mates: [],
    enemies: [],
    society: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy,
    tileEnergyDelta,
  });

  approxEqual(cell._resourceDelta, expectedDelta, 1e-12, "resource delta smoothing");
  approxEqual(
    cell._resourceBaseline,
    expectedBaseline,
    1e-12,
    "resource baseline smoothing",
  );
  approxEqual(cell._resourceSignal, expectedSignal, 1e-12, "resource trend signal");
});

test("neural rest action queues DNA-driven fatigue recovery bonus", () => {
  const dna = new DNA(180, 90, 60);

  dna.genes[GENE_LOCI.RECOVERY] = 240;
  dna.genes[GENE_LOCI.NEURAL] = 220;
  dna.genes[GENE_LOCI.ACTIVITY] = 40;
  dna.genes[GENE_LOCI.PARENTAL] = 180;
  const initialEnergy = 8;
  const cell = new Cell(0, 0, dna, initialEnergy);

  cell.brain = {
    connectionCount: 1,
    evaluateGroup() {
      return {
        values: { rest: 5, pursue: 0, avoid: 0, cohere: 0, explore: 0 },
        activationCount: 1,
        sensors: new Array(Brain.SENSOR_COUNT).fill(0),
      };
    },
  };

  cell._neuralFatigue = 0.72;
  const fatigueBefore = cell.getNeuralFatigue();

  const grid = [[cell]];

  withMockedRandom([0], () =>
    cell.executeMovementStrategy(grid, 0, 0, [], [], [], {
      rows: 1,
      cols: 1,
      localDensity: 0.1,
      densityEffectMultiplier: 0.6,
      moveToTarget: () => {},
      moveAwayFromTarget: () => {},
      moveRandomly: () => {},
      getEnergyAt: () => 0,
      tryMove: () => false,
      isTileBlocked: () => false,
    }),
  );

  assert.ok(cell._pendingRestRecovery > 0, "rest should queue recovery boost");
  const queued = cell._pendingRestRecovery;
  const movementOutcome = cell._decisionContextIndex.get("movement")?.outcome ?? null;

  assert.ok(movementOutcome, "rest decision outcome should be tracked");
  assert.ok(
    Number.isFinite(movementOutcome.restNeuralSignal),
    "rest neural signal should be recorded",
  );
  assert.ok(
    Number.isFinite(movementOutcome.restNeuralAmplifier),
    "rest neural amplifier should be recorded",
  );

  const context = {
    localDensity: 0.1,
    densityEffectMultiplier: 0.6,
    maxTileEnergy: 12,
  };

  cell.manageEnergy(cell.row, cell.col, context);

  assert.is(
    cell._pendingRestRecovery,
    0,
    "rest boost should be consumed during energy management",
  );
  const snapshot = cell._neuralFatigueSnapshot;

  assert.ok(snapshot, "fatigue snapshot should exist after manageEnergy");
  assert.ok(
    snapshot.restBonusApplied > 0,
    `rest bonus should apply when queued (queued=${queued})`,
  );
  assert.ok(snapshot.recoveryApplied > snapshot.restBaseRecovery - 1e-9);
  assert.ok(
    cell.getNeuralFatigue() < fatigueBefore + 1e-9,
    "rest cycle should not increase fatigue when well supplied",
  );
});

test("neural rest confidence amplifies recovery boost", () => {
  const dna = new DNA(200, 120, 80);

  dna.genes[GENE_LOCI.RECOVERY] = 210;
  dna.genes[GENE_LOCI.NEURAL] = 230;
  dna.genes[GENE_LOCI.ACTIVITY] = 20;

  const createBrainWithScores = ({ rest, pursue, avoid, cohere, explore }) => {
    const sensorVector = new Array(Brain.SENSOR_COUNT).fill(0);
    const energyIndex = Brain.sensorIndex("energy");

    if (Number.isFinite(energyIndex)) {
      sensorVector[energyIndex] = 0.65;
    }

    return {
      connectionCount: 4,
      evaluateGroup(group) {
        if (group !== "movement") return null;

        return {
          values: { rest, pursue, avoid, cohere, explore },
          activationCount: 4,
          sensors: sensorVector,
        };
      },
    };
  };

  const runRestDecision = (scores) => {
    const cell = new Cell(0, 0, dna, 9);

    cell.brain = createBrainWithScores(scores);
    cell._neuralFatigue = 0.78;
    cell._neuralEnergyReserve = 0.82;

    const grid = [[cell]];

    withMockedRandom([0], () =>
      cell.executeMovementStrategy(grid, 0, 0, [], [], [], {
        rows: 1,
        cols: 1,
        localDensity: 0.12,
        densityEffectMultiplier: 0.5,
        moveToTarget: () => {},
        moveAwayFromTarget: () => {},
        moveRandomly: () => {},
        getEnergyAt: () => 0,
        tryMove: () => false,
        isTileBlocked: () => false,
      }),
    );

    const outcome = cell._decisionContextIndex.get("movement")?.outcome ?? {};

    return { cell, outcome };
  };

  const confident = runRestDecision({
    rest: 6,
    pursue: -4,
    avoid: -4,
    cohere: -3.5,
    explore: -4,
  });
  const hesitant = runRestDecision({
    rest: 1.25,
    pursue: 1.1,
    avoid: 0.9,
    cohere: 0.8,
    explore: 0.7,
  });

  assert.ok(
    confident.cell._pendingRestRecovery > hesitant.cell._pendingRestRecovery,
    "confident rest intent should queue a larger recovery boost",
  );
  assert.ok(
    (confident.outcome.restNeuralAmplifier ?? 0) >
      (hesitant.outcome.restNeuralAmplifier ?? 0),
    "rest amplifier should scale with neural confidence",
  );
  assert.ok(
    (confident.outcome.restNeuralSignal ?? 0) >
      (hesitant.outcome.restNeuralSignal ?? 0),
    "rest neural signal should reflect stronger intent",
  );
});

test("pursue movement leans on targeting selection when available", () => {
  const dna = new DNA(120, 120, 120);
  const cell = new Cell(0, 0, dna, 6);
  const movementSensors = new Array(Brain.SENSOR_COUNT).fill(0);

  cell.brain = {
    connectionCount: 3,
    evaluateGroup(group) {
      if (group === "movement") {
        return {
          values: { rest: -4, pursue: 5, avoid: -3, cohere: -3, explore: -2 },
          activationCount: 1,
          sensors: movementSensors.slice(),
        };
      }

      return {
        values: null,
        activationCount: 0,
        sensors: movementSensors.slice(),
      };
    },
  };

  const nearEnemy = {
    row: 0,
    col: 1,
    target: { row: 0, col: 1, energy: 8, age: 1, lifespan: 6 },
  };
  const farEnemy = {
    row: 2,
    col: 0,
    target: { row: 2, col: 0, energy: 5, age: 1, lifespan: 6 },
  };
  const enemies = [nearEnemy, farEnemy];
  const chooseCalls = [];

  cell.chooseEnemyTarget = (list) => {
    chooseCalls.push(list);

    return list[1];
  };

  let moved = null;
  let randomFallback = false;

  cell.executeMovementStrategy([], 0, 0, [], enemies, [], {
    rows: 5,
    cols: 5,
    localDensity: 0.1,
    densityEffectMultiplier: 1,
    moveToTarget: (_grid, _row, _col, targetRow, targetCol) => {
      moved = { row: targetRow, col: targetCol };
    },
    moveAwayFromTarget: () => {},
    moveRandomly: () => {
      randomFallback = true;
    },
    getEnergyAt: () => 0,
    tryMove: () => false,
    isTileBlocked: () => false,
    tileEnergy: 0.4,
    tileEnergyDelta: 0,
    maxTileEnergy: 12,
  });

  assert.is(chooseCalls.length, 1, "pursue should consult targeting selection");
  assert.ok(moved, "pursuit should attempt a directed move");
  assert.is(moved?.row, 2, "movement should chase the targeted enemy row");
  assert.is(moved?.col, 0, "movement should chase the targeted enemy col");
  assert.is(randomFallback, false, "successful pursuit should avoid random fallback");

  const outcome = cell._decisionContextIndex.get("movement")?.outcome ?? null;

  assert.ok(outcome?.pursueTarget, "pursuit should record a target summary");
  assert.is(outcome.pursueTarget.row, 2, "summary should capture pursued row");
  assert.is(outcome.pursueTarget.col, 0, "summary should capture pursued col");
  assert.equal(outcome.pursueTarget.source, "targeting");
  assert.is(
    outcome.pursueUsedTargetingNetwork,
    false,
    "stubbed targeting should report non-neural selection",
  );
});

test("legacy cautious fallback retreats when DNA signals vulnerability", () => {
  const dna = new DNA(40, 40, 40);

  dna.genes[GENE_LOCI.STRATEGY] = 30;
  dna.genes[GENE_LOCI.RISK] = 20;
  dna.genes[GENE_LOCI.RECOVERY] = 80;
  dna.genes[GENE_LOCI.DENSITY] = 200;
  dna.movementGenes = () => ({ wandering: 0, pursuit: 0, cautious: 1 });
  dna.riskTolerance = () => 0.08;
  dna.recoveryRate = () => 0.2;
  dna.prngFor = (tag) => {
    switch (tag) {
      case "legacyMovementChoice":
        return () => 0.9;
      case "legacyCautiousRetreat":
        return () => 0.1;
      case "legacyMovementCohesion":
      case "legacyMovementExploit":
        return () => 1;
      default:
        return () => 0.5;
    }
  };

  const cell = new Cell(0, 0, dna, 1.2);

  cell._neuralFatigue = 0.7;
  cell._neuralEnergyReserve = 0.3;
  cell.lastEventPressure = 0.6;

  const threatDNA = new DNA(20, 20, 20);

  threatDNA.prngFor = () => () => 0.5;
  const threat = new Cell(1, 1, threatDNA, 9);

  const grid = [
    [cell, null],
    [null, threat],
  ];

  let retreated = false;
  let randomFallback = false;

  cell.executeMovementStrategy(grid, 0, 0, [], [threat], [], {
    rows: 2,
    cols: 2,
    localDensity: 0.8,
    densityEffectMultiplier: 1.1,
    moveToTarget: () => false,
    moveAwayFromTarget: () => {
      retreated = true;

      return true;
    },
    moveRandomly: () => {
      randomFallback = true;
    },
    getEnergyAt: () => 0.1,
    tryMove: () => false,
    isTileBlocked: () => false,
    tileEnergy: 0.05,
    tileEnergyDelta: -0.3,
    maxTileEnergy: 12,
  });

  assert.ok(
    retreated,
    "low-risk cautious genomes should retreat from stronger threats",
  );
  assert.is(randomFallback, false, "retreat should execute without random fallback");
});

test("legacy cautious fallback holds position when traits signal confidence", () => {
  const dna = new DNA(60, 60, 60);

  dna.genes[GENE_LOCI.STRATEGY] = 220;
  dna.genes[GENE_LOCI.RISK] = 240;
  dna.genes[GENE_LOCI.RECOVERY] = 210;
  dna.movementGenes = () => ({ wandering: 0, pursuit: 0, cautious: 1 });
  dna.riskTolerance = () => 0.9;
  dna.recoveryRate = () => 0.85;
  dna.prngFor = (tag) => {
    switch (tag) {
      case "legacyMovementChoice":
        return () => 0.8;
      case "legacyCautiousRetreat":
        return () => 0.95;
      case "legacyMovementCohesion":
      case "legacyMovementExploit":
        return () => 1;
      default:
        return () => 0.5;
    }
  };

  const cell = new Cell(0, 0, dna, 10);

  cell._neuralFatigue = 0.2;
  cell._neuralEnergyReserve = 0.9;
  cell.lastEventPressure = 0.05;

  const threatDNA = new DNA(20, 20, 20);

  threatDNA.prngFor = () => () => 0.5;
  const threat = new Cell(1, 1, threatDNA, 2.5);

  const grid = [
    [cell, null],
    [null, threat],
  ];

  let retreated = false;
  let randomFallback = false;

  cell.executeMovementStrategy(grid, 0, 0, [], [threat], [], {
    rows: 2,
    cols: 2,
    localDensity: 0.2,
    densityEffectMultiplier: 0.8,
    moveToTarget: () => false,
    moveAwayFromTarget: () => {
      retreated = true;

      return true;
    },
    moveRandomly: () => {
      randomFallback = true;
    },
    getEnergyAt: () => 0.9,
    tryMove: () => false,
    isTileBlocked: () => false,
    tileEnergy: 0.85,
    tileEnergyDelta: 0.15,
    maxTileEnergy: 12,
  });

  assert.is(
    retreated,
    false,
    "confident genomes should not auto-retreat when advantaged",
  );
  assert.ok(
    randomFallback,
    "without retreat, fallback movement should eventually trigger",
  );
});

test("breed spends parental investment energy without creating extra energy", () => {
  const dnaA = new DNA(10, 120, 200);
  const dnaB = new DNA(200, 80, 40);
  const parentA = new Cell(4, 5, dnaA, 12);
  const parentB = new Cell(4, 5, dnaB, 12);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const demandFracA = dnaA.offspringEnergyDemandFrac();
  const demandFracB = dnaB.offspringEnergyDemandFrac();
  const transferEfficiency = combinedTransferEfficiency(dnaA, dnaB);
  const viabilityBuffer = Math.max(
    dnaA.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
    dnaB.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
  );
  const viabilityThreshold =
    maxTileEnergy * Math.max(demandFracA, demandFracB) * viabilityBuffer;
  const requiredTotalInvestment =
    viabilityThreshold / Math.max(transferEfficiency, 1e-6);
  const weightSum = Math.max(1e-6, Math.abs(investFracA) + Math.abs(investFracB));
  const requiredShareA = requiredTotalInvestment * (Math.abs(investFracA) / weightSum);
  const requiredShareB = requiredTotalInvestment * (Math.abs(investFracB) / weightSum);
  const investA = investmentFor(
    energyBeforeA,
    investFracA,
    starvationA,
    demandFracA,
    maxTileEnergy,
    requiredShareA,
  );
  const investB = investmentFor(
    energyBeforeB,
    investFracB,
    starvationB,
    demandFracB,
    maxTileEnergy,
    requiredShareB,
  );
  const totalInvestment = investA + investB;

  const child = withMockedRandom([0.9, 0.9, 0.9, 0.5], () =>
    Cell.breed(parentA, parentB),
  );

  const expectedEnergy = totalInvestment * transferEfficiency;
  const expectedWaste = totalInvestment - expectedEnergy;

  assert.ok(child instanceof Cell, "breed should return a Cell");
  assert.is(child.row, parentA.row);
  assert.is(child.col, parentA.col);
  approxEqual(child.energy, expectedEnergy, 1e-12, "offspring energy");
  approxEqual(parentA.energy, energyBeforeA - investA, 1e-12, "parent A energy");
  approxEqual(parentB.energy, energyBeforeB - investB, 1e-12, "parent B energy");
  approxEqual(
    totalInvestment,
    energyBeforeA - parentA.energy + (energyBeforeB - parentB.energy),
    1e-12,
    "investments match energy spent",
  );
  assert.ok(expectedWaste >= 0, "transfer efficiency never creates energy");
  assert.ok(
    child.energy >= viabilityThreshold - 1e-9,
    "offspring meets viability energy floor",
  );
  assert.is(parentA.offspring, 1);
  assert.is(parentB.offspring, 1);
  assert.ok(parentA.energy >= starvationA, "parent A respects starvation floor");
  assert.ok(parentB.energy >= starvationB, "parent B respects starvation floor");
});

test("interaction momentum responds to conflicts and cooperation history", () => {
  const dna = new DNA(180, 200, 80);

  dna.genes[GENE_LOCI.COOPERATION] = 230;
  dna.genes[GENE_LOCI.COMBAT] = 20;
  dna.genes[GENE_LOCI.PARENTAL] = 200;
  dna.genes[GENE_LOCI.SENSE] = 220;
  dna.genes[GENE_LOCI.DENSITY] = 120;
  dna.genes[GENE_LOCI.ACTIVITY] = 80;

  const cell = new Cell(2, 2, dna, 6);
  const baseline = cell.getInteractionMomentum();

  assert.ok(
    baseline > -0.2 && baseline <= 1,
    "baseline mood should be cooperative leaning",
  );

  const rival = { dna: new DNA(40, 60, 210) };
  const afterLoss = cell.experienceInteraction({
    type: "fight",
    outcome: "loss",
    partner: rival,
    energyDelta: -1.5,
  });

  assert.ok(afterLoss < baseline, "losing a fight should depress social momentum");
  approxEqual(
    cell.getInteractionMomentum(),
    afterLoss,
    1e-12,
    "momentum snapshot matches recorded value",
  );

  const partner = { dna: new DNA(210, 170, 90) };
  const afterCoop = cell.experienceInteraction({
    type: "cooperate",
    outcome: "receive",
    partner,
    energyDelta: 2.2,
  });

  assert.ok(afterCoop > afterLoss, "receiving cooperation should raise momentum");

  cell.age += 1;
  cell.chooseInteractionAction({
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    enemies: [],
    allies: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
  });

  const decayed = cell.getInteractionMomentum();

  assert.ok(decayed > afterLoss, "decay pulls momentum back toward baseline");
});

test("breed returns null when either parent lacks investable energy", () => {
  const dnaA = new DNA(240, 10, 10);
  const dnaB = new DNA(240, 10, 10);
  const parentA = new Cell(3, 4, dnaA, 0);
  const parentB = new Cell(3, 4, dnaB, 2);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const starvationA = parentA.starvationThreshold(window.GridManager.maxTileEnergy);
  const starvationB = parentB.starvationThreshold(window.GridManager.maxTileEnergy);

  const offspring = Cell.breed(parentA, parentB);

  assert.is(offspring, null, "offspring should be null when investments are zero");
  approxEqual(parentA.energy, energyBeforeA, 1e-12, "parent A energy unchanged");
  approxEqual(parentB.energy, energyBeforeB, 1e-12, "parent B energy unchanged");
  assert.is(parentA.offspring, 0);
  assert.is(parentB.offspring, 0);
  assert.ok(
    parentA.energy <= starvationA,
    "parent A stays at or below starvation floor when energy is insufficient",
  );
  assert.ok(
    parentB.energy <= starvationB,
    "parent B stays at or below starvation floor when energy is insufficient",
  );
});

test("neural cooperation decisions modulate share fractions", () => {
  const dna = new DNA(120, 80, 210);

  dna.cooperateShareFrac = ({ energyDelta = 0, kinship = 0 } = {}) =>
    clamp(0.25 + Math.max(0, -energyDelta) * 0.2 + kinship * 0.1, 0, 0.9);
  const cell = new Cell(2, 2, dna, 6);

  cell.energy = 6;
  cell.brain = {
    connectionCount: 4,
    evaluateGroup(group, sensors) {
      if (group !== "interaction") {
        return { values: null, activationCount: 0, sensors: null, trace: null };
      }

      return {
        values: { avoid: -3, fight: -2, cooperate: 4 },
        activationCount: 3,
        sensors: sensors ? Object.values(sensors) : null,
        trace: null,
      };
    },
    applySensorFeedback() {},
  };
  cell.interactionGenes = { avoid: 0.2, fight: 0.1, cooperate: 0.7 };
  cell._rngCache = new Map([["interactionDecision", () => 0.99]]);

  const partnerDna = new DNA(40, 220, 60);
  const partner = { dna: partnerDna, energy: 1 };
  const action = cell.chooseInteractionAction({
    localDensity: 0.15,
    densityEffectMultiplier: 1,
    enemies: [],
    allies: [{ target: partner }],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy: 0.4,
    tileEnergyDelta: -0.1,
  });

  assert.is(action, "cooperate");

  const maxEnergy = window.GridManager.maxTileEnergy;
  const selfNorm = clamp(cell.energy / maxEnergy, 0, 1);
  const partnerNorm = clamp(partner.energy / maxEnergy, 0, 1);
  const kinship = clamp(cell.similarityTo(partner), 0, 1);
  const baselineShare = dna.cooperateShareFrac({
    energyDelta: partnerNorm - selfNorm,
    kinship,
  });
  const intent = cell.createCooperationIntent({
    row: cell.row,
    col: cell.col,
    targetRow: cell.row,
    targetCol: cell.col + 1,
    targetCell: partner,
    maxTileEnergy: maxEnergy,
  });

  assert.ok(intent, "cooperation intent is produced");
  const neuralShare = intent.metadata.shareFraction;

  assert.ok(neuralShare > baselineShare, "neural intent boosts cooperation generosity");
  assert.ok(neuralShare <= 1, "share fraction remains clamped");
});

test("emergent fallback keeps cooperation share at baseline", () => {
  const dna = new DNA(40, 200, 60);

  dna.cooperateShareFrac = ({ energyDelta = 0, kinship = 0 } = {}) =>
    clamp(0.22 + Math.max(0, -energyDelta) * 0.18 + kinship * 0.08, 0, 0.85);
  const cell = new Cell(1, 1, dna, 4);

  cell.energy = 4;
  cell.brain = { connectionCount: 0 };
  cell.interactionGenes = { avoid: 0, fight: 0, cooperate: 1 };
  cell._rngCache = new Map([
    ["interactionFallback", () => 0.99],
    ["legacyInteractionChoice", () => 0.99],
  ]);

  const partnerDna = new DNA(60, 40, 90);
  const partner = { dna: partnerDna, energy: 1 };
  const action = cell.chooseInteractionAction({
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    enemies: [],
    allies: [{ target: partner }],
    maxTileEnergy: window.GridManager.maxTileEnergy,
  });

  assert.is(action, "cooperate");

  const maxEnergy = window.GridManager.maxTileEnergy;
  const selfNorm = clamp(cell.energy / maxEnergy, 0, 1);
  const partnerNorm = clamp(partner.energy / maxEnergy, 0, 1);
  const kinship = clamp(cell.similarityTo(partner), 0, 1);
  const baselineShare = dna.cooperateShareFrac({
    energyDelta: partnerNorm - selfNorm,
    kinship,
  });
  const intent = cell.createCooperationIntent({
    row: cell.row,
    col: cell.col,
    targetRow: cell.row,
    targetCol: cell.col + 1,
    targetCell: partner,
    maxTileEnergy: maxEnergy,
  });

  assert.ok(intent, "cooperation intent is produced without neural support");
  assert.ok(
    Math.abs(intent.metadata.shareFraction - baselineShare) <= 1e-12,
    "fallback keeps share at baseline",
  );
});

test("interaction fallback shifts with environmental pressures", () => {
  const dna = new DNA(120, 40, 60);
  const cell = new Cell(4, 4, dna, 6);

  cell.brain = { connectionCount: 0 };
  cell.interactionGenes = { avoid: 0.8, fight: 0.6, cooperate: 0.4 };

  const hostileDna = new DNA(200, 200, 20);
  const hostile = { dna: hostileDna, energy: 12, row: 4, col: 5 };
  const hostileDescriptor = {
    target: hostile,
    row: hostile.row,
    col: hostile.col,
    precomputedSimilarity: 0.05,
  };

  cell._rngCache = new Map([
    ["interactionFallback", () => 0],
    ["legacyInteractionChoice", () => 0],
  ]);

  const avoidAction = cell.chooseInteractionAction({
    localDensity: 0.95,
    densityEffectMultiplier: 1,
    enemies: [hostileDescriptor],
    allies: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy: 0.05,
    tileEnergyDelta: -0.6,
  });

  assert.is(avoidAction, "avoid", "threat-heavy context prefers retreat");

  const allyDna = new DNA(60, 240, 180);
  const ally = { dna: allyDna, energy: 5, row: 4, col: 3 };
  const allyDescriptor = {
    target: ally,
    row: ally.row,
    col: ally.col,
    precomputedSimilarity: clamp(cell.similarityTo(ally), 0, 1),
  };

  cell._rngCache.set("interactionFallback", () => 0.999);
  cell._rngCache.set("legacyInteractionChoice", () => 0.999);
  cell.interactionGenes = { avoid: 0.2, fight: 0.15, cooperate: 1.4 };
  cell.energy = 7;

  const cooperateAction = cell.chooseInteractionAction({
    localDensity: 0.1,
    densityEffectMultiplier: 1,
    enemies: [],
    allies: [allyDescriptor],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy: 0.9,
    tileEnergyDelta: 0.45,
  });

  assert.is(
    cooperateAction,
    "cooperate",
    "resource-rich ally support encourages cooperation",
  );
});

test("getInteractionReach expands fight reach when neural policy favors aggression", () => {
  const dna = new DNA(140, 60, 90);
  const cell = new Cell(3, 3, dna, 6);
  const enemyTarget = { dna: new DNA(80, 200, 40), energy: 5, row: 3, col: 4 };
  const probabilities = { avoid: 0.02, fight: 0.9, cooperate: 0.08 };

  cell.brain = createInteractionBrainStub({ sequence: [{ probabilities }] });

  const rngSequence = [0.6];

  cell.resolveRng = () => () => (rngSequence.length ? rngSequence.shift() : 0.5);

  const interactionContext = {
    localDensity: 0.3,
    densityEffectMultiplier: 1,
    enemies: [{ row: enemyTarget.row, col: enemyTarget.col, target: enemyTarget }],
    allies: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy: 0.55,
    tileEnergyDelta: 0.15,
  };

  const action = cell.chooseInteractionAction(interactionContext);

  assert.is(action, "fight", "neural policy should select a fight action");

  const reach = cell.getInteractionReach("fight", {
    localDensity: interactionContext.localDensity,
    densityEffectMultiplier: interactionContext.densityEffectMultiplier,
    tileEnergy: interactionContext.tileEnergy,
    tileEnergyDelta: interactionContext.tileEnergyDelta,
    maxTileEnergy: interactionContext.maxTileEnergy,
  });

  const decisionContext = cell._decisionContextIndex.get("interaction");

  assert.ok(decisionContext, "interaction decision context should be registered");

  const summary = decisionContext.outcome?.reach?.fight;

  assert.ok(summary, "fight reach summary should exist when neural policies run");
  approxEqual(
    reach,
    summary.result,
    1e-12,
    "returned reach should match recorded summary",
  );
  assert.ok(
    summary.result > summary.base,
    `expected neural preference to extend reach (base=${summary.base}, result=${summary.result})`,
  );
  approxEqual(
    summary.neuralProbability ?? 0,
    probabilities.fight,
    0.05,
    "fight probability should reflect neural activation",
  );
  assert.ok(
    summary.neuralUsed,
    "summary should record that neural policies were applied",
  );
});

test("getInteractionReach contracts fight reach when neural policy hesitates", () => {
  const dna = new DNA(100, 120, 80);
  const cell = new Cell(2, 5, dna, 6);
  const cautiousProbabilities = { avoid: 0.55, fight: 0.25, cooperate: 0.2 };
  const enemyTarget = { dna: new DNA(160, 40, 180), energy: 7, row: 2, col: 6 };

  cell.brain = createInteractionBrainStub({
    sequence: [{ probabilities: cautiousProbabilities }],
  });

  const rngSequence = [0.6];

  cell.resolveRng = () => () => (rngSequence.length ? rngSequence.shift() : 0.6);

  const interactionContext = {
    localDensity: 0.45,
    densityEffectMultiplier: 1,
    enemies: [{ row: enemyTarget.row, col: enemyTarget.col, target: enemyTarget }],
    allies: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy: 0.4,
    tileEnergyDelta: -0.05,
  };

  const action = cell.chooseInteractionAction(interactionContext);

  assert.is(action, "fight", "stochastic selection should still yield a fight action");

  const reach = cell.getInteractionReach("fight", {
    localDensity: interactionContext.localDensity,
    densityEffectMultiplier: interactionContext.densityEffectMultiplier,
    tileEnergy: interactionContext.tileEnergy,
    tileEnergyDelta: interactionContext.tileEnergyDelta,
    maxTileEnergy: interactionContext.maxTileEnergy,
  });

  const decisionContext = cell._decisionContextIndex.get("interaction");

  assert.ok(
    decisionContext,
    "interaction outcome should be tracked for neural blending",
  );

  const summary = decisionContext.outcome?.reach?.fight;

  assert.ok(summary, "fight summary should be present after neural evaluation");
  approxEqual(
    reach,
    summary.result,
    1e-12,
    "returned reach should match blended value",
  );
  assert.ok(
    summary.result < summary.base,
    `neural caution should contract reach (base=${summary.base}, result=${summary.result})`,
  );
  approxEqual(
    summary.neuralProbability ?? 0,
    cautiousProbabilities.fight,
    0.05,
    "fight probability should reflect hesitant neural weighting",
  );
  assert.ok(
    (summary.neuralAdvantage ?? 0) < 0,
    "advantage should indicate stronger competitors",
  );
});

test("breed clamps investment so parents stop at starvation threshold", () => {
  const dnaA = new DNA(30, 240, 220);
  const dnaB = new DNA(200, 220, 60);
  const parentA = new Cell(5, 6, dnaA, 6);
  const parentB = new Cell(5, 6, dnaB, 6);
  const reproductionMax = 4;
  const starvationA = parentA.starvationThreshold(reproductionMax);
  const starvationB = parentB.starvationThreshold(reproductionMax);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const demandFracA = dnaA.offspringEnergyDemandFrac();
  const demandFracB = dnaB.offspringEnergyDemandFrac();
  const transferEfficiency = combinedTransferEfficiency(dnaA, dnaB);
  const viabilityBuffer = Math.max(
    dnaA.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
    dnaB.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
  );
  const viabilityThreshold =
    reproductionMax * Math.max(demandFracA, demandFracB) * viabilityBuffer;
  const requiredTotalInvestment =
    viabilityThreshold / Math.max(transferEfficiency, 1e-6);
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const weightSum = Math.max(1e-6, Math.abs(investFracA) + Math.abs(investFracB));
  const requiredShareA = requiredTotalInvestment * (Math.abs(investFracA) / weightSum);
  const requiredShareB = requiredTotalInvestment * (Math.abs(investFracB) / weightSum);
  const expectedInvestA = investmentFor(
    energyBeforeA,
    investFracA,
    starvationA,
    demandFracA,
    reproductionMax,
    requiredShareA,
  );
  const expectedInvestB = investmentFor(
    energyBeforeB,
    investFracB,
    starvationB,
    demandFracB,
    reproductionMax,
    requiredShareB,
  );

  assert.ok(starvationA > 0, "starvation threshold should be positive");
  assert.ok(starvationB > 0, "starvation threshold should be positive");

  const child = withMockedRandom([0.6, 0.6, 0.6, 0.5], () =>
    Cell.breed(parentA, parentB, 1, { maxTileEnergy: reproductionMax }),
  );

  assert.ok(child instanceof Cell, "offspring should be produced when both can invest");
  assert.ok(
    parentA.energy >= starvationA,
    "parent A energy stays above starvation floor",
  );
  assert.ok(
    parentB.energy >= starvationB,
    "parent B energy stays above starvation floor",
  );
  approxEqual(
    parentA.energy,
    energyBeforeA - expectedInvestA,
    1e-12,
    "parent A investment matches clamp",
  );
  approxEqual(
    parentB.energy,
    energyBeforeB - expectedInvestB,
    1e-12,
    "parent B investment matches clamp",
  );
  approxEqual(
    child.energy,
    (expectedInvestA + expectedInvestB) * transferEfficiency,
    1e-12,
    "child energy equals combined investments after transfer efficiency",
  );
  assert.ok(
    child.energy >= viabilityThreshold - 1e-9,
    "offspring energy respects viability requirement",
  );
});

test("breed aborts when combined investment misses DNA viability floor", () => {
  const dnaA = new DNA(0, 0, 0);
  const dnaB = new DNA(0, 0, 0);

  const imprintHighDemand = (dna) => {
    dna.genes[GENE_LOCI.PARENTAL] = 255;
    dna.genes[GENE_LOCI.FERTILITY] = 240;
    dna.genes[GENE_LOCI.ENERGY_CAPACITY] = 220;
    dna.genes[GENE_LOCI.RISK] = 160;
    dna.genes[GENE_LOCI.COOPERATION] = 210;
    dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 60;
  };

  imprintHighDemand(dnaA);
  imprintHighDemand(dnaB);

  const parentA = new Cell(2, 3, dnaA, 5);
  const parentB = new Cell(2, 4, dnaB, 5);
  const maxTileEnergy = 10;
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const demandFracA = dnaA.offspringEnergyDemandFrac();
  const demandFracB = dnaB.offspringEnergyDemandFrac();
  const transferEfficiency = combinedTransferEfficiency(dnaA, dnaB);
  const viabilityFloor = maxTileEnergy * Math.max(demandFracA, demandFracB);
  const requiredTotalInvestment = viabilityFloor / Math.max(transferEfficiency, 1e-6);
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const weightSum = Math.max(1e-6, Math.abs(investFracA) + Math.abs(investFracB));
  const requiredShareA = requiredTotalInvestment * (Math.abs(investFracA) / weightSum);
  const requiredShareB = requiredTotalInvestment * (Math.abs(investFracB) / weightSum);
  const investA = investmentFor(
    energyBeforeA,
    investFracA,
    starvationA,
    demandFracA,
    maxTileEnergy,
    requiredShareA,
  );
  const investB = investmentFor(
    energyBeforeB,
    investFracB,
    starvationB,
    demandFracB,
    maxTileEnergy,
    requiredShareB,
  );

  assert.ok(investA > 0 && investB > 0, "parents contribute energy toward offspring");
  assert.ok(
    investA + investB < viabilityFloor,
    "combined investment stays below DNA viability expectation",
  );

  const outcome = withMockedRandom([0.2, 0.4, 0.6, 0.8], () =>
    Cell.breed(parentA, parentB, 1, { maxTileEnergy }),
  );

  assert.is(outcome, null, "reproduction aborts when viability floor is unmet");
  approxEqual(
    parentA.energy,
    energyBeforeA,
    1e-12,
    "parent A keeps energy after abort",
  );
  approxEqual(
    parentB.energy,
    energyBeforeB,
    1e-12,
    "parent B keeps energy after abort",
  );
});

test("gestation efficiency genes modulate delivered offspring energy", () => {
  const configureGenome = (geneValue) => {
    const dna = new DNA(90, 140, 210);

    dna.genes[GENE_LOCI.PARENTAL] = 200;
    dna.genes[GENE_LOCI.FERTILITY] = 180;
    dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 210;
    dna.genes[GENE_LOCI.RECOVERY] = 160;
    dna.genes[GENE_LOCI.RISK] = 80;
    dna.genes[GENE_LOCI.GESTATION_EFFICIENCY] = geneValue;

    return dna;
  };

  const lowDnaA = configureGenome(15);
  const lowDnaB = configureGenome(25);
  const highDnaA = configureGenome(240);
  const highDnaB = configureGenome(250);
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const lowParentA = new Cell(1, 1, lowDnaA, 11);
  const lowParentB = new Cell(1, 1, lowDnaB, 11);
  const highParentA = new Cell(1, 1, highDnaA, 11);
  const highParentB = new Cell(1, 1, highDnaB, 11);
  const lowDemandA = lowDnaA.offspringEnergyDemandFrac();
  const lowDemandB = lowDnaB.offspringEnergyDemandFrac();
  const highDemandA = highDnaA.offspringEnergyDemandFrac();
  const highDemandB = highDnaB.offspringEnergyDemandFrac();
  const lowEfficiency = combinedTransferEfficiency(lowDnaA, lowDnaB);
  const highEfficiency = combinedTransferEfficiency(highDnaA, highDnaB);
  const lowViabilityBuffer = Math.max(
    lowDnaA.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
    lowDnaB.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
  );
  const highViabilityBuffer = Math.max(
    highDnaA.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
    highDnaB.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
  );
  const lowRequiredTotal =
    (maxTileEnergy * Math.max(lowDemandA, lowDemandB) * lowViabilityBuffer) /
    Math.max(lowEfficiency, 1e-6);
  const highRequiredTotal =
    (maxTileEnergy * Math.max(highDemandA, highDemandB) * highViabilityBuffer) /
    Math.max(highEfficiency, 1e-6);
  const lowFracA = lowDnaA.parentalInvestmentFrac();
  const lowFracB = lowDnaB.parentalInvestmentFrac();
  const highFracA = highDnaA.parentalInvestmentFrac();
  const highFracB = highDnaB.parentalInvestmentFrac();
  const lowWeight = Math.max(1e-6, Math.abs(lowFracA) + Math.abs(lowFracB));
  const highWeight = Math.max(1e-6, Math.abs(highFracA) + Math.abs(highFracB));
  const lowRequiredShareA = lowRequiredTotal * (Math.abs(lowFracA) / lowWeight);
  const lowRequiredShareB = lowRequiredTotal * (Math.abs(lowFracB) / lowWeight);
  const highRequiredShareA = highRequiredTotal * (Math.abs(highFracA) / highWeight);
  const highRequiredShareB = highRequiredTotal * (Math.abs(highFracB) / highWeight);
  const lowInvestA = investmentFor(
    lowParentA.energy,
    lowFracA,
    lowParentA.starvationThreshold(maxTileEnergy),
    lowDemandA,
    maxTileEnergy,
    lowRequiredShareA,
  );
  const lowInvestB = investmentFor(
    lowParentB.energy,
    lowFracB,
    lowParentB.starvationThreshold(maxTileEnergy),
    lowDemandB,
    maxTileEnergy,
    lowRequiredShareB,
  );
  const highInvestA = investmentFor(
    highParentA.energy,
    highFracA,
    highParentA.starvationThreshold(maxTileEnergy),
    highDemandA,
    maxTileEnergy,
    highRequiredShareA,
  );
  const highInvestB = investmentFor(
    highParentB.energy,
    highFracB,
    highParentB.starvationThreshold(maxTileEnergy),
    highDemandB,
    maxTileEnergy,
    highRequiredShareB,
  );

  const lowChild = withMockedRandom([0.4, 0.6, 0.3, 0.5], () =>
    Cell.breed(lowParentA, lowParentB),
  );
  const highChild = withMockedRandom([0.4, 0.6, 0.3, 0.5], () =>
    Cell.breed(highParentA, highParentB),
  );

  assert.ok(lowChild instanceof Cell, "low efficiency lineage should reproduce");
  assert.ok(highChild instanceof Cell, "high efficiency lineage should reproduce");
  approxEqual(
    lowChild.energy,
    (lowInvestA + lowInvestB) * lowEfficiency,
    1e-12,
    "low-efficiency offspring energy matches expectation",
  );
  approxEqual(
    highChild.energy,
    (highInvestA + highInvestB) * highEfficiency,
    1e-12,
    "high-efficiency offspring energy matches expectation",
  );
  assert.ok(
    highEfficiency > lowEfficiency,
    "gestation efficiency genes raise transfer efficiency",
  );
  assert.ok(
    highChild.energy > lowChild.energy,
    "offspring from efficient parents receive more energy",
  );
});

test("breed applies deterministic crossover and honors forced mutation", () => {
  const dnaA = new DNA(100, 150, 200);
  const dnaB = new DNA(140, 160, 210);
  const parentA = new Cell(7, 8, dnaA, 6);
  const parentB = new Cell(7, 8, dnaB, 6);

  // Force mutation to trigger and make expectations deterministic
  dnaA.mutationChance = () => 1;
  dnaB.mutationChance = () => 1;
  dnaA.mutationRange = () => 12;
  dnaB.mutationRange = () => 12;

  const chance = 1;
  const range = 12;
  const reproductionRng =
    typeof dnaA.sharedRng === "function"
      ? dnaA.sharedRng(dnaB, "offspringGenome")
      : null;
  const expectedGenes = predictDeterministicOffspring(
    dnaA,
    dnaB,
    chance,
    range,
    0,
    reproductionRng,
  );
  const child = Cell.breed(parentA, parentB, 1, { maxTileEnergy: 4 });

  assert.is(child.dna.length, expectedGenes.length);
  for (let i = 0; i < expectedGenes.length; i++) {
    assert.is(child.dna.geneAt(i), expectedGenes[i]);
  }
  const expectedStrategy = clamp(
    child.dna.inheritStrategy([parentA.strategy, parentB.strategy], {
      fallback: child.dna.strategy(),
    }),
    0,
    1,
  );

  approxEqual(
    child.strategy,
    expectedStrategy,
    1e-12,
    "strategy inheritance should match DNA guidance",
  );
});

test("resolveReproductionEnergyThreshold lowers energy requirement when neural support is strong", () => {
  const dnaSelf = new DNA(180, 140, 120);
  const dnaPartner = new DNA(150, 160, 130);

  dnaSelf.reproductionThresholdFrac = () => 0.45;
  dnaPartner.reproductionThresholdFrac = () => 0.45;

  const cell = new Cell(3, 3, dnaSelf, 7);
  const partner = new Cell(3, 4, dnaPartner, 7);

  cell.brain = createReproductionBrainStub({
    accept: 6,
    decline: -3,
    activationCount: 9,
  });

  const maxTileEnergy = 12;
  const baseProb = 0.35;
  const context = {
    localDensity: 0.18,
    densityEffectMultiplier: 0.7,
    maxTileEnergy,
    baseProbability: baseProb,
    tileEnergy: 0.62,
    tileEnergyDelta: 0.04,
  };

  cell.decideReproduction(partner, context);

  const baseEnergy = dnaSelf.reproductionThresholdFrac() * maxTileEnergy;
  const thresholdEnergy = cell.resolveReproductionEnergyThreshold(partner, context);

  assert.ok(
    thresholdEnergy < baseEnergy,
    "neural encouragement should reduce the reproduction energy floor",
  );

  const reproductionContext = cell._decisionContextIndex.get("reproduction");
  const telemetry = reproductionContext?.outcome?.energyThreshold;

  assert.ok(telemetry, "energy threshold telemetry should be recorded");
  assert.ok(
    telemetry.adjustedEnergy < telemetry.baseEnergy,
    "telemetry should reflect the lowered threshold",
  );
  assert.is(telemetry.source, "decision", "neural decision should be marked as source");
});

test("resolveReproductionEnergyThreshold raises energy requirement when neural signals caution", () => {
  const dnaSelf = new DNA(160, 100, 140);
  const dnaPartner = new DNA(150, 120, 150);

  dnaSelf.reproductionThresholdFrac = () => 0.4;
  dnaPartner.reproductionThresholdFrac = () => 0.4;

  const cell = new Cell(2, 2, dnaSelf, 6);
  const partner = new Cell(2, 3, dnaPartner, 6);

  cell.brain = createReproductionBrainStub({
    accept: -2.5,
    decline: 4.5,
    activationCount: 7,
  });

  const maxTileEnergy = 10;
  const baseProb = 0.42;
  const context = {
    localDensity: 0.32,
    densityEffectMultiplier: 0.9,
    maxTileEnergy,
    baseProbability: baseProb,
    tileEnergy: 0.48,
    tileEnergyDelta: -0.12,
  };

  cell.decideReproduction(partner, context);

  const baseEnergy = dnaSelf.reproductionThresholdFrac() * maxTileEnergy;
  const thresholdEnergy = cell.resolveReproductionEnergyThreshold(partner, context);

  assert.ok(
    thresholdEnergy > baseEnergy,
    "neural caution should increase the reproduction energy requirement",
  );

  const reproductionContext = cell._decisionContextIndex.get("reproduction");
  const telemetry = reproductionContext?.outcome?.energyThreshold;

  assert.ok(
    telemetry,
    "energy threshold telemetry should be recorded when neural discourages",
  );
  assert.ok(
    telemetry.adjustedEnergy > telemetry.baseEnergy,
    "telemetry should show an increased threshold",
  );
  assert.is(telemetry.source, "decision");
});

test("resolveReproductionEnergyThreshold uses preview when no decision context exists", () => {
  const dnaSelf = new DNA(170, 130, 150);
  const dnaPartner = new DNA(150, 120, 150);

  dnaSelf.reproductionThresholdFrac = () => 0.5;
  dnaPartner.reproductionThresholdFrac = () => 0.5;

  const cell = new Cell(1, 1, dnaSelf, 5.5);
  const partner = new Cell(1, 2, dnaPartner, 5.5);

  cell.brain = createReproductionBrainStub({
    accept: 5,
    decline: -2,
    activationCount: 5,
  });

  const maxTileEnergy = 14;
  const context = {
    localDensity: 0.25,
    densityEffectMultiplier: 0.85,
    maxTileEnergy,
    baseProbability: 0.38,
    tileEnergy: 0.55,
    tileEnergyDelta: 0.06,
  };

  const baseEnergy = dnaSelf.reproductionThresholdFrac() * maxTileEnergy;
  const thresholdEnergy = cell.resolveReproductionEnergyThreshold(partner, context);

  assert.ok(
    thresholdEnergy < baseEnergy,
    "previewed neural encouragement should still reduce the threshold",
  );

  const reproductionContext = cell._decisionContextIndex.get("reproduction");

  assert.ok(
    !reproductionContext?.outcome?.energyThreshold,
    "no telemetry should be recorded without a registered decision context",
  );
});

test("populationScarcityDrive amplifies scarcity response when neural support is strong", () => {
  const dnaSelf = new DNA(200, 140, 180);
  const dnaPartner = new DNA(180, 150, 160);
  const baseProbability = 0.32;
  const scarcity = 0.75;
  const population = 30;
  const minPopulation = 120;

  const baselineCell = new Cell(4, 4, dnaSelf, 6);
  const baselinePartner = new Cell(4, 5, dnaPartner, 6);

  baselineCell.brain = null;

  const baselineDrive = baselineCell.populationScarcityDrive({
    scarcity,
    baseProbability,
    partner: baselinePartner,
    population,
    minPopulation,
  });

  const cell = new Cell(4, 4, dnaSelf, 6);
  const partner = new Cell(4, 5, dnaPartner, 6);

  cell.brain = createReproductionBrainStub({
    accept: 8,
    decline: -4,
    activationCount: 10,
  });

  const context = {
    localDensity: 0.24,
    densityEffectMultiplier: 0.8,
    maxTileEnergy: 12,
    baseProbability,
    tileEnergy: 0.42,
    tileEnergyDelta: -0.06,
  };

  cell.decideReproduction(partner, context);

  const neuralDrive = cell.populationScarcityDrive({
    scarcity,
    baseProbability,
    partner,
    population,
    minPopulation,
  });

  assert.ok(
    neuralDrive > baselineDrive,
    "neural encouragement should boost scarcity-driven reproduction",
  );

  const reproductionContext = cell._decisionContextIndex.get("reproduction");
  const telemetry = reproductionContext?.outcome?.scarcityDrive;

  assert.ok(telemetry, "scarcity telemetry should be recorded when neural fires");
  assert.ok(telemetry.neuralMix > 0, "neural mix should reflect blend usage");
  assert.ok(
    telemetry.result > telemetry.heuristic,
    "final scarcity drive should exceed heuristic baseline",
  );
});

test("populationScarcityDrive eases scarcity pressure when neural discourages reproduction", () => {
  const dnaSelf = new DNA(210, 160, 170);
  const dnaPartner = new DNA(175, 140, 165);
  const baseProbability = 0.37;
  const scarcity = 0.68;
  const population = 26;
  const minPopulation = 110;

  const baselineCell = new Cell(5, 5, dnaSelf, 6.5);
  const baselinePartner = new Cell(5, 6, dnaPartner, 6.5);

  baselineCell.brain = null;

  const baselineDrive = baselineCell.populationScarcityDrive({
    scarcity,
    baseProbability,
    partner: baselinePartner,
    population,
    minPopulation,
  });

  const cell = new Cell(5, 5, dnaSelf, 6.5);
  const partner = new Cell(5, 6, dnaPartner, 6.5);

  cell.brain = createReproductionBrainStub({
    accept: -3,
    decline: 5.5,
    activationCount: 9,
  });

  const context = {
    localDensity: 0.3,
    densityEffectMultiplier: 0.9,
    maxTileEnergy: 12,
    baseProbability,
    tileEnergy: 0.51,
    tileEnergyDelta: -0.02,
  };

  cell.decideReproduction(partner, context);

  const neuralDrive = cell.populationScarcityDrive({
    scarcity,
    baseProbability,
    partner,
    population,
    minPopulation,
  });

  assert.ok(
    neuralDrive < baselineDrive,
    "neural caution should soften scarcity multipliers",
  );

  const reproductionContext = cell._decisionContextIndex.get("reproduction");
  const telemetry = reproductionContext?.outcome?.scarcityDrive;

  assert.ok(telemetry, "scarcity telemetry should capture neural discouragement");
  assert.ok(
    telemetry.result < telemetry.heuristic,
    "final scarcity drive should fall below heuristic when neural resists",
  );
  assert.ok(
    telemetry.neuralImpulse < 0,
    "neural impulse should reflect the discouraging signal",
  );
});

test("interaction intents resolve fights via interaction system", () => {
  const attackerDNA = new DNA(10, 20, 30);
  const defenderDNA = new DNA(15, 25, 35);

  attackerDNA.fightCost = () => 0;
  defenderDNA.fightCost = () => 0;
  attackerDNA.combatPower = () => 1;
  defenderDNA.combatPower = () => 1;

  const attacker = new Cell(0, 0, attackerDNA, 8);
  const defender = new Cell(0, 1, defenderDNA, 4);

  const grid = [
    [attacker, defender],
    [null, null],
  ];
  const consumeCalls = [];
  const manager = {
    grid,
    densityGrid: [
      [0, 0],
      [0, 0],
    ],
    maxTileEnergy: 12,
    consumeEnergy: (cell, row, col) => {
      consumeCalls.push({ cell, row, col });
    },
    removeCell(row, col) {
      const current = this.grid[row]?.[col] ?? null;

      if (!current) return null;

      this.grid[row][col] = null;

      return current;
    },
    relocateCell(fromRow, fromCol, toRow, toCol) {
      const moving = this.grid[fromRow]?.[fromCol] ?? null;

      if (!moving || this.grid[toRow]?.[toCol]) return false;

      this.grid[toRow][toCol] = moving;
      this.grid[fromRow][fromCol] = null;
      moving.row = toRow;
      moving.col = toCol;

      return true;
    },
  };
  const adapter = {
    getCell: (row, col) => manager.grid[row]?.[col] ?? null,
    setCell: (row, col, cell) => {
      manager.grid[row][col] = cell;

      if (cell) {
        cell.row = row;
        cell.col = col;
      }

      return cell;
    },
    removeCell: (row, col) => manager.removeCell(row, col),
    relocateCell: (fromRow, fromCol, toRow, toCol) =>
      manager.relocateCell(fromRow, fromCol, toRow, toCol),
    consumeTileEnergy: ({ cell, row, col }) => manager.consumeEnergy(cell, row, col),
    maxTileEnergy: () => manager.maxTileEnergy,
    transferEnergy: ({ from, to, amount }) => {
      const donor = from ?? null;
      const recipient = to ?? null;
      const requested = Math.max(0, amount ?? 0);

      if (!donor || requested <= 0) return 0;

      const available = Math.min(requested, donor.energy ?? 0);
      const maxEnergy = manager.maxTileEnergy;
      let accepted = available;

      if (recipient) {
        const current = recipient.energy ?? 0;
        const capacity = Math.max(0, maxEnergy - current);

        accepted = Math.max(0, Math.min(available, capacity));
        recipient.energy = current + accepted;
      }

      donor.energy = Math.max(0, (donor.energy ?? 0) - accepted);

      return accepted;
    },
  };
  let fights = 0;
  let deaths = 0;
  const stats = {
    onFight: () => fights++,
    onDeath: () => deaths++,
  };

  const interactionSystem = new InteractionSystem({ adapter });
  const intent = attacker.createFightIntent({ targetRow: 0, targetCol: 1 });

  withMockedRandom([0], () => interactionSystem.resolveIntent(intent, { stats }));

  assert.is(
    manager.grid[0][1],
    attacker,
    "attacker occupies the target tile after winning",
  );
  assert.is(manager.grid[0][0], null, "original attacker tile is emptied");
  assert.is(attacker.row, 0, "attacker row updates to target row");
  assert.is(attacker.col, 1, "attacker col updates to target col");
  assert.is(attacker.fightsWon, 1, "attacker records win");
  assert.is(defender.fightsLost, 1, "defender records loss");
  assert.is(consumeCalls.length, 1, "energy consumption triggered once");
  assert.equal(consumeCalls[0], { cell: attacker, row: 0, col: 1 });
  assert.is(fights, 1, "fight stat increments once");
  assert.is(deaths, 1, "death stat increments once");
});

test("movement and interaction genes reflect DNA-coded tendencies", () => {
  const fastDNA = new DNA(120, 80, 40);

  fastDNA.genes[GENE_LOCI.MOVEMENT] = 240;
  fastDNA.genes[GENE_LOCI.EXPLORATION] = 40;
  fastDNA.genes[GENE_LOCI.RISK] = 210;
  fastDNA.genes[GENE_LOCI.COHESION] = 40;
  fastDNA.genes[GENE_LOCI.STRATEGY] = 200;

  const cautiousDNA = new DNA(60, 200, 180);

  cautiousDNA.genes[GENE_LOCI.MOVEMENT] = 30;
  cautiousDNA.genes[GENE_LOCI.EXPLORATION] = 220;
  cautiousDNA.genes[GENE_LOCI.RISK] = 20;
  cautiousDNA.genes[GENE_LOCI.COHESION] = 210;
  cautiousDNA.genes[GENE_LOCI.STRATEGY] = 40;

  const fastMovement = fastDNA.movementGenes();
  const cautiousMovement = cautiousDNA.movementGenes();

  assert.ok(
    fastMovement.pursuit > cautiousMovement.pursuit,
    "fast genome pursues more",
  );
  assert.ok(
    cautiousMovement.cautious > fastMovement.cautious,
    "cautious genome rests more",
  );
  assert.ok(
    cautiousMovement.wandering > fastMovement.wandering,
    "explorers wander more",
  );

  const aggressiveDNA = new DNA(220, 40, 40);

  aggressiveDNA.genes[GENE_LOCI.RISK] = 240;
  aggressiveDNA.genes[GENE_LOCI.COMBAT] = 240;
  aggressiveDNA.genes[GENE_LOCI.COOPERATION] = 10;
  aggressiveDNA.genes[GENE_LOCI.RECOVERY] = 20;

  const altruistDNA = new DNA(40, 220, 120);

  altruistDNA.genes[GENE_LOCI.RISK] = 20;
  altruistDNA.genes[GENE_LOCI.COMBAT] = 20;
  altruistDNA.genes[GENE_LOCI.COOPERATION] = 230;
  altruistDNA.genes[GENE_LOCI.PARENTAL] = 220;
  altruistDNA.genes[GENE_LOCI.RECOVERY] = 200;

  const aggressiveInteraction = aggressiveDNA.interactionGenes();
  const altruistInteraction = altruistDNA.interactionGenes();

  assert.ok(
    aggressiveInteraction.fight > altruistInteraction.fight,
    "aggressive genome fights",
  );
  assert.ok(
    altruistInteraction.cooperate > aggressiveInteraction.cooperate,
    "helpers cooperate",
  );
  assert.ok(
    altruistInteraction.avoid > aggressiveInteraction.avoid,
    "cautious genomes avoid",
  );
});

test("chooseEnemyTarget uses conflict focus derived from DNA", () => {
  const cautiousDNA = new DNA(80, 180, 200);

  cautiousDNA.genes[GENE_LOCI.RISK] = 20;
  cautiousDNA.genes[GENE_LOCI.COMBAT] = 30;
  cautiousDNA.genes[GENE_LOCI.STRATEGY] = 220;
  cautiousDNA.genes[GENE_LOCI.MOVEMENT] = 80;

  const boldDNA = new DNA(220, 60, 60);

  boldDNA.genes[GENE_LOCI.RISK] = 230;
  boldDNA.genes[GENE_LOCI.COMBAT] = 220;
  boldDNA.genes[GENE_LOCI.STRATEGY] = 30;
  boldDNA.genes[GENE_LOCI.MOVEMENT] = 200;

  const cautiousCell = new Cell(5, 5, cautiousDNA, 6);
  const boldCell = new Cell(5, 5, boldDNA, 6);

  const weakEnemy = new Cell(6, 5, new DNA(120, 120, 120), 2);

  weakEnemy.age = 5;
  weakEnemy.lifespan = 100;
  const strongEnemy = new Cell(1, 5, new DNA(120, 120, 120), 8);

  strongEnemy.age = 20;
  strongEnemy.lifespan = 100;

  const enemies = [
    { row: weakEnemy.row, col: weakEnemy.col, target: weakEnemy },
    { row: strongEnemy.row, col: strongEnemy.col, target: strongEnemy },
  ];

  const cautiousTarget = cautiousCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });
  const boldTarget = boldCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });

  assert.is(cautiousTarget.target, weakEnemy, "cautious genome prefers weaker enemy");
  assert.is(boldTarget.target, strongEnemy, "bold genome prefers strong enemy");
});

test("neural targeting can override conflict focus weighting", () => {
  const strategicDNA = new DNA(160, 140, 180);

  strategicDNA.conflictFocus = () => ({
    weak: 0.2,
    strong: 1.6,
    proximity: 1.6,
    attrition: 0.2,
  });

  const neuralCell = new Cell(5, 5, strategicDNA, 6);

  neuralCell.age = 10;
  neuralCell.lifespan = 100;

  const attritionOutput = OUTPUT_GROUPS.targeting.find(
    (entry) => entry.key === "focusAttrition",
  );

  assert.ok(attritionOutput, "targeting output for attrition exists");
  const attritionGene = {
    sourceId: Brain.sensorIndex("bias"),
    targetId: attritionOutput?.id ?? 0,
    weight: 6,
    activationType: 0,
    enabled: true,
  };

  neuralCell.brain = new Brain({ genes: [attritionGene] });
  neuralCell.neurons = neuralCell.brain.neuronCount;

  const strongDNA = new DNA(200, 80, 80);
  const strongEnemy = new Cell(4, 5, strongDNA, 8);

  strongEnemy.age = 5;
  strongEnemy.lifespan = 100;

  const weakDNA = new DNA(80, 200, 120);
  const weakEnemy = new Cell(8, 8, weakDNA, 3);

  weakEnemy.age = 70;
  weakEnemy.lifespan = 80;

  const enemies = [
    { row: strongEnemy.row, col: strongEnemy.col, target: strongEnemy },
    { row: weakEnemy.row, col: weakEnemy.col, target: weakEnemy },
  ];

  const fallbackCell = new Cell(5, 5, strategicDNA, 6);

  fallbackCell.brain = null;

  const fallbackChoice = fallbackCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });

  assert.is(
    fallbackChoice.target,
    strongEnemy,
    "DNA-focused cell challenges the stronger opponent",
  );

  const neuralChoice = neuralCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });

  assert.is(
    neuralChoice.target,
    weakEnemy,
    "Neural targeting pivots toward attrition despite DNA bias",
  );
});

test("cooperateShareFrac adapts to ally deficits and kinship", () => {
  const dna = new DNA(80, 200, 140);

  dna.genes[GENE_LOCI.COOPERATION] = 230;
  dna.genes[GENE_LOCI.PARENTAL] = 210;
  dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 60;
  dna.genes[GENE_LOCI.COHESION] = 220;

  const baseline = dna.cooperateShareFrac();
  const assistWeakKin = dna.cooperateShareFrac({ energyDelta: -0.6, kinship: 0.9 });
  const holdBack = dna.cooperateShareFrac({ energyDelta: 0.6, kinship: 0.1 });

  assert.ok(assistWeakKin > baseline, "shares more with weaker kin");
  assert.ok(holdBack < baseline, "shares less with stronger partners");
  assert.ok(assistWeakKin > holdBack, "overall preference favors helping the weak");
});

test("evaluateMateCandidate scales selection weight using mate sampling profile", () => {
  const dna = new DNA(10, 20, 30);
  const cell = new Cell(0, 0, dna, 5);
  const mateDNA = new DNA(40, 80, 120);
  const mateCell = new Cell(0, 1, mateDNA, 5);

  cell.matePreferenceBias = 0;
  cell.diversityAppetite = 0;
  cell.mateSamplingProfile = {
    preferenceSoftening: 2,
    noveltyWeight: 0.5,
    selectionJitter: 0,
  };
  cell._mateSelectionNoiseRng = () => 0.5;

  const evaluated = cell.evaluateMateCandidate({ target: mateCell });

  assert.ok(evaluated, "mate evaluation should produce a result");

  const expectedBase =
    evaluated.preferenceScore * cell.mateSamplingProfile.preferenceSoftening +
    evaluated.diversity * cell.mateSamplingProfile.noveltyWeight;
  const expectedWeight = Math.max(0.0001, expectedBase);

  approxEqual(
    evaluated.selectionWeight,
    expectedWeight,
    1e-9,
    "selection weight should reflect DNA-driven weighting",
  );
});

test("selectMateWeighted honors mate sampling curiosity bias", () => {
  const dna = new DNA(10, 20, 30);
  const cell = new Cell(0, 0, dna, 5);
  const similarTarget = new Cell(0, 1, new DNA(20, 30, 40), 5);
  const diverseTarget = new Cell(0, 2, new DNA(200, 10, 10), 5);

  cell.matePreferenceBias = 0;
  cell.diversityAppetite = 0;
  cell.mateSamplingProfile = {
    curiosityChance: 0.9,
    tailFraction: 0.5,
    preferenceSoftening: 1,
    selectionJitter: 0,
    noveltyWeight: 0,
  };
  const sequence = [0.01, 0.2, 0.8];
  let index = 0;

  cell._mateSelectionNoiseRng = () => {
    const value = sequence[index] ?? sequence[sequence.length - 1];

    index += 1;

    return value;
  };

  const similar = { target: similarTarget, precomputedSimilarity: 0.9 };
  const diverse = { target: diverseTarget, precomputedSimilarity: 0.1 };
  const { chosen, mode } = cell.selectMateWeighted([similar, diverse]);

  assert.is(mode, "curiosity", "high curiosity genomes sample tail candidates");
  assert.is(chosen, diverse, "curiosity pick should favor diverse mates");
});

test("repetitive low-diversity matings build novelty pressure that shifts mate scoring", () => {
  const dna = new DNA(40, 60, 80);
  const cell = new Cell(0, 0, dna, 6);
  const similarTarget = new Cell(0, 1, new DNA(45, 65, 85), 6);
  const diverseTarget = new Cell(0, 2, new DNA(200, 15, 15), 6);

  cell.matePreferenceBias = 0.6;
  cell.diversityAppetite = 0;
  cell._mateSelectionNoiseRng = () => 0.5;

  const baselineSimilar = cell.evaluateMateCandidate({
    target: similarTarget,
    precomputedSimilarity: 0.95,
  });
  const baselineDiverse = cell.evaluateMateCandidate({
    target: diverseTarget,
    precomputedSimilarity: 0.15,
  });

  for (let i = 0; i < 5; i += 1) {
    cell.recordMatingOutcome({
      diversity: 0.05,
      success: true,
      penalized: true,
      penaltyMultiplier: 0.6,
      strategyPenaltyMultiplier: 0.7,
    });
  }

  const pressuredSimilar = cell.evaluateMateCandidate({
    target: similarTarget,
    precomputedSimilarity: 0.95,
  });
  const pressuredDiverse = cell.evaluateMateCandidate({
    target: diverseTarget,
    precomputedSimilarity: 0.15,
  });

  assert.ok(
    pressuredSimilar.preferenceScore < baselineSimilar.preferenceScore,
    "novelty pressure should reduce preference for repetitive mates",
  );
  assert.ok(
    pressuredSimilar.selectionWeight < baselineSimilar.selectionWeight,
    "novelty pressure should diminish selection weight for repetitive mates",
  );
  assert.ok(
    pressuredDiverse.preferenceScore >= baselineDiverse.preferenceScore,
    "diverse mates remain as appealing or stronger under novelty pressure",
  );
});

test("diverse matings relieve accumulated novelty pressure penalties", () => {
  const dna = new DNA(70, 90, 40);
  const cell = new Cell(0, 0, dna, 5);
  const similarTarget = new Cell(0, 1, new DNA(75, 95, 45), 5);

  cell.matePreferenceBias = 0.45;
  cell.diversityAppetite = 0.1;
  cell._mateSelectionNoiseRng = () => 0.5;

  for (let i = 0; i < 4; i += 1) {
    cell.recordMatingOutcome({
      diversity: 0.08,
      success: true,
      penalized: true,
      penaltyMultiplier: 0.55,
      strategyPenaltyMultiplier: 0.75,
    });
  }

  const pressuredSimilar = cell.evaluateMateCandidate({
    target: similarTarget,
    precomputedSimilarity: 0.92,
  });

  cell.recordMatingOutcome({
    diversity: 0.88,
    success: true,
    penalized: false,
    penaltyMultiplier: 1,
    strategyPenaltyMultiplier: 1,
  });

  const relievedSimilar = cell.evaluateMateCandidate({
    target: similarTarget,
    precomputedSimilarity: 0.92,
  });

  assert.ok(
    relievedSimilar.preferenceScore > pressuredSimilar.preferenceScore,
    "diverse success should unwind novelty penalty pressure",
  );
  assert.ok(
    relievedSimilar.selectionWeight > pressuredSimilar.selectionWeight,
    "diverse success should restore selection weight toward balance",
  );
});

test("recordMatingOutcome imprints DNA-driven mate affinity into neural sensors", () => {
  const dna = new DNA(90, 120, 180);
  const cell = new Cell(0, 0, dna, 6);
  const imprintCalls = [];
  const feedbackCalls = [];

  cell.brain = {
    sensorPlasticity: { enabled: true },
    applyExperienceImprint(payload) {
      imprintCalls.push(payload);
    },
    applySensorFeedback(payload) {
      feedbackCalls.push(payload);
    },
  };
  cell.mateAffinityPlasticity = {
    assimilation: 0.3,
    successWeight: 0.7,
    penaltyWeight: 0.5,
    opportunityWeight: 0.6,
    complementWeight: 0.4,
    gainInfluence: 0.5,
  };
  cell._decisionContextIndex.set("reproduction", {
    sensorVector: new Float32Array([1, 0.2, -0.1, 0.5]),
    activationCount: 8,
  });

  cell.recordMatingOutcome({
    diversity: 0.65,
    success: true,
    penalized: false,
    penaltyMultiplier: 1,
    behaviorComplementarity: 0.55,
    diversityOpportunity: 0.4,
  });

  assert.is(imprintCalls.length, 1, "experience imprint should fire once");
  const imprint = imprintCalls[0];

  assert.ok(Array.isArray(imprint.adjustments), "imprint payload includes adjustments");

  const partnerAdjustment = imprint.adjustments.find(
    (entry) => entry && entry.sensor === "partnerSimilarity",
  );

  assert.ok(partnerAdjustment, "successful mating imprints partner similarity");
  assert.ok(
    partnerAdjustment.assimilation > 0,
    "partner similarity adjustment should carry assimilation",
  );

  const opportunityAdjustment = imprint.adjustments.find(
    (entry) => entry && entry.sensor === "opportunitySignal",
  );

  assert.ok(opportunityAdjustment, "opportunity signal adjustment should be included");
  assert.ok(
    feedbackCalls.length > 0,
    "successful mating should reinforce neural sensors via feedback",
  );
});

test("recordMatingOutcome penalizes repetitive mates through neural imprint", () => {
  const dna = new DNA(50, 80, 110);
  const cell = new Cell(0, 0, dna, 6);
  const imprintCalls = [];

  cell.brain = {
    sensorPlasticity: { enabled: true },
    applyExperienceImprint(payload) {
      imprintCalls.push(payload);
    },
    applySensorFeedback() {},
  };
  cell.mateAffinityPlasticity = {
    assimilation: 0.25,
    successWeight: 0.4,
    penaltyWeight: 0.9,
    opportunityWeight: 0,
    complementWeight: 0,
    gainInfluence: 0.4,
  };
  cell._decisionContextIndex.set("reproduction", {
    sensorVector: new Float32Array([1, 0]),
    activationCount: 3,
  });

  cell.recordMatingOutcome({
    diversity: 0.1,
    success: false,
    penalized: true,
    penaltyMultiplier: 0.6,
    behaviorComplementarity: 0.2,
    diversityOpportunity: 0,
  });

  assert.is(imprintCalls.length, 1, "penalized mating should produce an imprint");
  const imprint = imprintCalls[0];
  const partnerAdjustment = imprint.adjustments.find(
    (entry) => entry && entry.sensor === "partnerSimilarity",
  );

  assert.ok(partnerAdjustment, "penalty should adjust partner similarity");
  assert.ok(
    partnerAdjustment.assimilation > 0,
    "penalty adjustment should apply learning",
  );
  assert.ok(
    partnerAdjustment.target < 0.8,
    "penalty should push the similarity target away from repetitive mates",
  );
});

test("diversity drive responds to appetite, novelty, and memory", () => {
  const dna = new DNA(120, 80, 160);
  const cell = new Cell(0, 0, dna, 6);

  cell.diversityAppetite = 0.85;
  cell.matePreferenceBias = 0;
  cell._mateDiversityMemory = 0.2;
  cell._mateNoveltyPressure = 0.6;

  const positive = cell.getDiversityDrive({ availableDiversity: 0.3 });

  cell.diversityAppetite = 0.08;
  cell._mateDiversityMemory = 0.9;
  cell._mateNoveltyPressure = 0.05;
  cell.matePreferenceBias = 0.4;

  const negative = cell.getDiversityDrive({ availableDiversity: 0.1 });

  assert.ok(positive > 0.15, "curious genomes should seek diversity when underexposed");
  assert.ok(
    negative < -0.1,
    "sated and kin-biased genomes should cool diversity drive",
  );
});

test("diversity drive modulates reproduction probability", () => {
  const setupPair = ({ appetite, memory, novelty, similarity }) => {
    const dnaA = new DNA(80, 120, 160);
    const dnaB = new DNA(100, 90, 70);

    dnaA.reproductionProb = () => 0.42;
    dnaB.reproductionProb = () => 0.42;
    dnaA.senescenceRate = () => 0.15;
    dnaB.senescenceRate = () => 0.15;
    dnaA.geneFraction = () => 0.5;
    dnaB.geneFraction = () => 0.5;

    const cell = new Cell(0, 0, dnaA, 6);
    const partner = new Cell(0, 1, dnaB, 6);

    cell.energy = 6;
    partner.energy = 6;
    cell.diversityAppetite = appetite;
    cell.matePreferenceBias = 0;
    cell._mateDiversityMemory = memory;
    cell._mateNoveltyPressure = novelty;
    cell.similarityTo = () => similarity;

    return { cell, partner };
  };

  const context = {
    localDensity: 0.35,
    densityEffectMultiplier: 1,
    maxTileEnergy: 12,
    tileEnergy: 0.65,
    tileEnergyDelta: 0.02,
  };

  const eager = setupPair({
    appetite: 0.92,
    memory: 0.18,
    novelty: 0.55,
    similarity: 0.22,
  });
  const reluctant = setupPair({
    appetite: 0.1,
    memory: 0.92,
    novelty: 0.05,
    similarity: 0.94,
  });

  const eagerProbability = eager.cell.computeReproductionProbability(
    eager.partner,
    context,
  );
  const reluctantProbability = reluctant.cell.computeReproductionProbability(
    reluctant.partner,
    context,
  );

  assert.ok(
    eagerProbability > reluctantProbability + 0.05,
    "diversity-seeking pairings should raise reproduction probability",
  );
});

test("recordCombatOutcome reinforces successful combat cues", () => {
  const dna = new DNA(90, 120, 150);
  const cell = new Cell(0, 0, dna, 8);
  const imprintCalls = [];
  const feedbackCalls = [];
  const sensors = new Float32Array(Brain.SENSOR_COUNT);
  const weaknessIndex = Brain.sensorIndex("targetWeakness");
  const threatIndex = Brain.sensorIndex("targetThreat");
  const attritionIndex = Brain.sensorIndex("targetAttrition");
  const proximityIndex = Brain.sensorIndex("targetProximity");
  const riskIndex = Brain.sensorIndex("riskTolerance");

  sensors[weaknessIndex] = 0.15;
  sensors[threatIndex] = 0.3;
  sensors[attritionIndex] = 0.05;
  sensors[proximityIndex] = 0.1;
  sensors[riskIndex] = 0.55;

  cell.brain = {
    sensorPlasticity: { enabled: true },
    applyExperienceImprint(payload) {
      imprintCalls.push(payload);
    },
    applySensorFeedback(payload) {
      feedbackCalls.push(payload);
    },
  };
  cell.combatLearningProfile = {
    baseAssimilation: 0.32,
    successAmplifier: 0.82,
    failureAmplifier: 0.88,
    gainInfluence: 0.45,
    kinshipPenaltyWeight: 0.25,
    threatWeight: 0.65,
    weaknessWeight: 0.7,
    attritionWeight: 0.55,
    proximityWeight: 0.5,
    riskFlexWeight: 0.6,
  };
  cell._decisionContextIndex.set("targeting", {
    sensorVector: sensors,
    activationCount: 6,
    group: "targeting",
  });
  cell._decisionContextIndex.set("interaction", {
    sensorVector: sensors,
    activationCount: 7,
    group: "interaction",
  });

  cell.recordCombatOutcome({
    success: true,
    kinship: 0.2,
    intensity: 1.1,
    winChance: 0.35,
    energyCost: 0.2,
  });

  assert.is(imprintCalls.length, 1, "successful combat should create a single imprint");
  const imprint = imprintCalls[0];
  const weaknessAdj = imprint.adjustments.find(
    (entry) => entry.sensor === "targetWeakness",
  );
  const threatAdj = imprint.adjustments.find(
    (entry) => entry.sensor === "targetThreat",
  );
  const riskAdj = imprint.adjustments.find((entry) => entry.sensor === "riskTolerance");

  assert.ok(weaknessAdj, "combat imprint should adjust weakness targeting");
  assert.ok(
    weaknessAdj.target > sensors[weaknessIndex],
    "success should increase preference for weaker opponents",
  );
  assert.ok(threatAdj, "combat imprint should adjust threat targeting");
  assert.ok(
    threatAdj.target >= sensors[threatIndex],
    "successful fight should not reduce tolerated threat",
  );
  assert.ok(riskAdj, "combat imprint should adjust risk tolerance");
  assert.ok(
    riskAdj.target > sensors[riskIndex],
    "successful fight should raise risk tolerance",
  );
  assert.ok(imprint.assimilation > 0, "combat imprint exposes assimilation strength");
  assert.ok(feedbackCalls.length > 0, "combat imprint should emit neural feedback");
});

test("recordCombatOutcome dampens risky combat losses", () => {
  const dna = new DNA(80, 110, 140);
  const cell = new Cell(0, 0, dna, 8);
  const imprintCalls = [];
  const feedbackCalls = [];
  const sensors = new Float32Array(Brain.SENSOR_COUNT);
  const weaknessIndex = Brain.sensorIndex("targetWeakness");
  const threatIndex = Brain.sensorIndex("targetThreat");
  const riskIndex = Brain.sensorIndex("riskTolerance");

  sensors[weaknessIndex] = 0.05;
  sensors[threatIndex] = 0.8;
  sensors[riskIndex] = 0.6;

  cell.brain = {
    sensorPlasticity: { enabled: true },
    applyExperienceImprint(payload) {
      imprintCalls.push(payload);
    },
    applySensorFeedback(payload) {
      feedbackCalls.push(payload);
    },
  };
  cell.combatLearningProfile = {
    baseAssimilation: 0.28,
    successAmplifier: 0.7,
    failureAmplifier: 0.95,
    gainInfluence: 0.42,
    kinshipPenaltyWeight: 0.3,
    threatWeight: 0.7,
    weaknessWeight: 0.65,
    attritionWeight: 0.5,
    proximityWeight: 0.45,
    riskFlexWeight: 0.58,
  };
  cell._decisionContextIndex.set("targeting", {
    sensorVector: sensors,
    activationCount: 5,
    group: "targeting",
  });
  cell._decisionContextIndex.set("interaction", {
    sensorVector: sensors,
    activationCount: 6,
    group: "interaction",
  });

  cell.recordCombatOutcome({
    success: false,
    kinship: 0.4,
    intensity: 1.4,
    winChance: 0.7,
    energyCost: 0.4,
  });

  assert.is(imprintCalls.length, 1, "combat loss should create a corrective imprint");
  const imprint = imprintCalls[0];
  const weaknessAdj = imprint.adjustments.find(
    (entry) => entry.sensor === "targetWeakness",
  );
  const threatAdj = imprint.adjustments.find(
    (entry) => entry.sensor === "targetThreat",
  );
  const riskAdj = imprint.adjustments.find((entry) => entry.sensor === "riskTolerance");

  assert.ok(weaknessAdj, "loss imprint should still bias toward weaker opponents");
  assert.ok(
    weaknessAdj.target >= sensors[weaknessIndex],
    "loss should not reduce the incentive to seek weakness",
  );
  assert.ok(threatAdj, "loss imprint should adjust threat targeting");
  assert.ok(
    threatAdj.target < sensors[threatIndex],
    "loss should reduce focus on threatening opponents",
  );
  assert.ok(riskAdj, "loss imprint should update risk tolerance");
  assert.ok(
    riskAdj.target < sensors[riskIndex],
    "loss should make the organism more cautious",
  );
  assert.ok(feedbackCalls.length > 0, "combat loss should trigger feedback");
  assert.ok(feedbackCalls[0].rewardSignal < 0, "loss feedback should be negative");
});

test("breed uses DNA inheritStrategy to compute offspring strategy", () => {
  const dnaA = new DNA(10, 20, 30);
  const dnaB = new DNA(40, 50, 60);
  const parentA = new Cell(0, 0, dnaA, 10);
  const parentB = new Cell(0, 1, dnaB, 10);

  parentA.dna.parentalInvestmentFrac = () => 0.5;
  parentB.dna.parentalInvestmentFrac = () => 0.5;
  parentA.dna.starvationThresholdFrac = () => 0.1;
  parentB.dna.starvationThresholdFrac = () => 0.1;
  parentA.dna.mutationChance = () => 0.1;
  parentB.dna.mutationChance = () => 0.1;
  parentA.dna.mutationRange = () => 4;
  parentB.dna.mutationRange = () => 4;

  const childDNA = new DNA(0, 0, 0);
  let inheritArgs = null;

  childDNA.inheritStrategy = (strategies, { fallback } = {}) => {
    inheritArgs = { strategies: [...strategies], fallback };

    return 0.77;
  };
  childDNA.strategy = () => 0.2;
  childDNA.strategyDriftRange = () => 0.1;

  parentA.dna.reproduceWith = () => childDNA;

  const offspring = Cell.breed(parentA, parentB, 1, { maxTileEnergy: 10 });

  assert.ok(offspring, "breed should produce an offspring when energy is invested");
  assert.ok(inheritArgs, "inheritStrategy should be invoked on offspring DNA");
  assert.ok(
    inheritArgs.strategies.includes(parentA.strategy),
    "parent A strategy should influence inheritance",
  );
  assert.ok(
    inheritArgs.strategies.includes(parentB.strategy),
    "parent B strategy should influence inheritance",
  );
  assert.is(
    offspring.strategy,
    0.77,
    "offspring strategy should follow DNA inheritance",
  );
});

test("mateSamplingProfile responds to courtship gene expression", () => {
  const template = new DNA(0, 0, 0);
  const geneCount = template.length;
  const lowGenes = new Uint8Array(geneCount);
  const highGenes = new Uint8Array(geneCount);

  lowGenes[GENE_LOCI.COURTSHIP] = 10;
  highGenes[GENE_LOCI.COURTSHIP] = 240;

  const lowCourtship = new DNA({ genes: lowGenes, geneCount });
  const highCourtship = new DNA({ genes: highGenes, geneCount });
  const lowProfile = lowCourtship.mateSamplingProfile();
  const highProfile = highCourtship.mateSamplingProfile();

  assert.ok(
    highProfile.curiosityChance > lowProfile.curiosityChance,
    "higher courtship genes should raise curiosity",
  );
  assert.ok(
    highProfile.tailFraction >= lowProfile.tailFraction,
    "higher courtship genes should widen sampling tail",
  );
});

test("strategyDriftRange expands for exploratory genomes", () => {
  const template = new DNA(0, 0, 0);
  const geneCount = template.length;
  const conservativeGenes = new Uint8Array(geneCount);
  const exploratoryGenes = new Uint8Array(geneCount);

  conservativeGenes[GENE_LOCI.MUTATION_RANGE] = 10;
  conservativeGenes[GENE_LOCI.COURTSHIP] = 20;
  conservativeGenes[GENE_LOCI.STRATEGY] = 240;

  exploratoryGenes[GENE_LOCI.MUTATION_RANGE] = 240;
  exploratoryGenes[GENE_LOCI.COURTSHIP] = 240;
  exploratoryGenes[GENE_LOCI.STRATEGY] = 20;

  const conservative = new DNA({ genes: conservativeGenes, geneCount });
  const exploratory = new DNA({ genes: exploratoryGenes, geneCount });

  assert.ok(
    exploratory.strategyDriftRange() > conservative.strategyDriftRange(),
    "mutationally flexible genomes should allow broader strategy drift",
  );
});

test("computeSenescenceHazard blends age, resources, and density", () => {
  const dna = new DNA(120, 140, 200);
  const cell = new Cell(0, 0, dna, 8);

  cell.lifespan = 100;
  cell.age = 5;
  const youthful = cell.computeSenescenceHazard({
    ageFraction: cell.age / cell.lifespan,
    energyFraction: 0.95,
    localDensity: 0.1,
    eventPressure: 0,
  });

  cell.age = 105;
  const supported = cell.computeSenescenceHazard({
    ageFraction: cell.age / cell.lifespan,
    energyFraction: 0.9,
    localDensity: 0.2,
    eventPressure: 0.1,
  });

  const depleted = cell.computeSenescenceHazard({
    ageFraction: cell.age / cell.lifespan,
    energyFraction: 0.1,
    localDensity: 0.95,
    eventPressure: 0.9,
  });

  assert.ok(
    youthful < 0.15,
    "young, well-resourced cells should face little senescence risk",
  );
  assert.ok(
    supported > youthful,
    "aging should increase senescence risk even when conditions remain favourable",
  );
  assert.ok(
    depleted > supported + 0.1,
    "stressors like scarcity and crowding should amplify senescence hazard",
  );
  assert.ok(depleted > 0.5, "stacked stress should push hazard into failure territory");
});

test("decideRandomMove favours energy-rich neighbours when roaming", () => {
  const dna = new DNA(10, 20, 30);
  const cell = new Cell(1, 1, dna, 6);

  cell.movementGenes = { wandering: 0.6, pursuit: 0.25, cautious: 0.15 };
  cell._rngCache = new Map([
    [
      "movementRandom",
      (() => {
        const sequence = [0.99, 0.1];
        let index = 0;

        return () => {
          const value = sequence[index] ?? sequence[sequence.length - 1];

          index += 1;

          return value;
        };
      })(),
    ],
  ]);

  const decision = cell.decideRandomMove({
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    tileEnergy: 0.2,
    tileEnergyDelta: -0.1,
    neighbors: [
      { dr: -1, dc: 0, blocked: false, occupied: false, energy: 0.9, energyDelta: 0.2 },
      { dr: 1, dc: 0, blocked: false, occupied: false, energy: 0.3, energyDelta: -0.1 },
      { dr: 0, dc: -1, blocked: false, occupied: false, energy: 0.25, energyDelta: 0 },
      { dr: 0, dc: 1, blocked: false, occupied: false, energy: 0.2, energyDelta: 0 },
    ],
  });

  assert.equal(decision.dr, -1, "cells should move toward richer energy patches");
  assert.equal(
    decision.dc,
    0,
    "movement should align with the highest weighted neighbour",
  );
});

test("decideRandomMove downranks crowded hostile directions", () => {
  const dna = new DNA(5, 15, 25);
  const cell = new Cell(2, 2, dna, 5);

  cell.movementGenes = { wandering: 0.05, pursuit: 0.05, cautious: 0.9 };
  cell.baseCrowdingTolerance = 0.2;
  cell._crowdingTolerance = 0.2;
  cell.baseRiskTolerance = 0.1;
  cell._rngCache = new Map([
    [
      "movementRandom",
      (() => {
        const sequence = [0.98, 0.6];
        let index = 0;

        return () => {
          const value = sequence[index] ?? sequence[sequence.length - 1];

          index += 1;

          return value;
        };
      })(),
    ],
  ]);

  const decision = cell.decideRandomMove({
    localDensity: 1,
    densityEffectMultiplier: 1,
    tileEnergy: 0.6,
    tileEnergyDelta: 0,
    neighbors: [
      {
        dr: -1,
        dc: 0,
        blocked: false,
        occupied: true,
        kinship: 0,
        energy: 0.1,
        energyDelta: -0.4,
      },
      { dr: 0, dc: 1, blocked: false, occupied: false, energy: 0.6, energyDelta: 0.1 },
    ],
  });

  assert.equal(
    decision.dr,
    0,
    "hostile, crowded neighbours should be deprioritised in fallback movement",
  );
  assert.equal(
    decision.dc,
    1,
    "the open avenue should be selected when alternatives collapse",
  );
});
