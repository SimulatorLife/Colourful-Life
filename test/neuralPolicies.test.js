const { test } = require('uvu');
const assert = require('uvu/assert');

let Cell;
let DNA;
let clamp;
let lerp;
let Brain;
let OUTPUT_GROUPS;
let NEURAL_GENE_BYTES;

function approxEqual(a, b, tolerance = 1e-9) {
  assert.ok(Math.abs(a - b) <= tolerance, `expected ${a} ≈ ${b}`);
}

function setNeuralGene(
  dna,
  index,
  { source = 0, target = 0, weight = 0, activation = 2, enabled = true }
) {
  assert.ok(typeof dna?.neuralGeneCount === 'function', 'DNA must expose neuralGeneCount');
  const neuralCount = dna.neuralGeneCount();

  assert.ok(neuralCount > 0, 'DNA should reserve space for neural genes');
  assert.ok(index >= 0 && index < neuralCount, 'neural gene index out of range');

  const baseOffset = dna.genes.length - neuralCount * NEURAL_GENE_BYTES;
  const offset = baseOffset + index * NEURAL_GENE_BYTES;
  const clampedWeight = clamp(weight, -1, 1);
  const rawWeight = Math.max(0, Math.min(4095, Math.round((clampedWeight + 1) * 2047.5)));
  const geneValue =
    ((source & 0xff) << 24) |
    ((target & 0xff) << 16) |
    ((rawWeight & 0xfff) << 4) |
    ((activation & 0x7) << 1) |
    (enabled ? 1 : 0);

  dna.genes[offset] = (geneValue >>> 24) & 0xff;
  dna.genes[offset + 1] = (geneValue >>> 16) & 0xff;
  dna.genes[offset + 2] = (geneValue >>> 8) & 0xff;
  dna.genes[offset + 3] = geneValue & 0xff;
}

test.before(async () => {
  ({ default: Cell } = await import('../src/cell.js'));
  ({ DNA } = await import('../src/genome.js'));
  ({ clamp, lerp } = await import('../src/utils.js'));
  ({ default: Brain, OUTPUT_GROUPS, NEURAL_GENE_BYTES } = await import('../src/brain.js'));
});

test('brain evaluateGroup produces deterministic, DNA-specific outputs', () => {
  const dnaA = new DNA(10, 20, 30);
  const dnaB = new DNA(150, 90, 40);
  const pursueNode = OUTPUT_GROUPS.movement.find((entry) => entry.key === 'pursue');
  const avoidNode = OUTPUT_GROUPS.movement.find((entry) => entry.key === 'avoid');

  assert.ok(pursueNode && avoidNode, 'movement outputs should include pursue and avoid');
  setNeuralGene(dnaA, 0, { source: 0, target: pursueNode.id, weight: 0.9 });
  setNeuralGene(dnaB, 0, { source: 0, target: avoidNode.id, weight: 0.9 });

  const cellA = new Cell(0, 0, dnaA, 3);
  const cellB = new Cell(0, 0, dnaB, 3);

  assert.ok(cellA.brain instanceof Brain, 'cellA should have an instantiated brain');
  assert.ok(cellB.brain instanceof Brain, 'cellB should have an instantiated brain');

  const sensors = {
    energy: 0.2,
    effectiveDensity: 0.4,
    allyFraction: 0.1,
    enemyFraction: 0.3,
    mateFraction: 0.15,
    allySimilarity: 0.2,
    enemySimilarity: 0.3,
    mateSimilarity: 0.1,
    ageFraction: 0.5,
    eventPressure: 0.1,
  };

  const { values: valuesA1 } = cellA.brain.evaluateGroup('movement', sensors);
  const { values: valuesA2 } = cellA.brain.evaluateGroup('movement', sensors);
  const { values: valuesB } = cellB.brain.evaluateGroup('movement', sensors);

  assert.ok(valuesA1 && valuesA2 && valuesB, 'brain evaluations should produce value maps');
  approxEqual(valuesA1.pursue, valuesA2.pursue, 1e-9);
  approxEqual(valuesA1.avoid, valuesA2.avoid, 1e-9);

  const pursueDelta = Math.abs((valuesA1.pursue ?? 0) - (valuesB.pursue ?? 0));
  const avoidDelta = Math.abs((valuesA1.avoid ?? 0) - (valuesB.avoid ?? 0));

  assert.ok(
    pursueDelta > 1e-6 || avoidDelta > 1e-6,
    'different DNA should produce distinct movement outputs'
  );
});

test('decideReproduction integrates neural policy with deterministic fallback', () => {
  const dnaA = new DNA(120, 200, 40);
  const dnaB = new DNA(200, 40, 160);
  const acceptNode = OUTPUT_GROUPS.reproduction.find((entry) => entry.key === 'accept');

  assert.ok(acceptNode, 'reproduction outputs should include accept');
  setNeuralGene(dnaA, 0, { source: 0, target: acceptNode.id, weight: 0.5 });
  setNeuralGene(dnaB, 0, { source: 0, target: acceptNode.id, weight: 0.25 });
  const cell = new Cell(0, 0, dnaA, 4);
  const partner = new Cell(0, 1, dnaB, 4);

  cell.age = cell.lifespan / 3;
  partner.age = partner.lifespan / 2;
  const context = {
    localDensity: 0.4,
    densityEffectMultiplier: 1.1,
    maxTileEnergy: 5,
    baseProbability: 0.6,
  };
  const decision = cell.decideReproduction(partner, context);

  assert.ok(decision.usedNetwork);
  assert.ok(decision.probability >= 0 && decision.probability <= 1);

  const fallbackCell = new Cell(0, 0, dnaA, 4);

  fallbackCell.brain = null;
  fallbackCell.neurons = 0;
  const fallbackDecision = fallbackCell.decideReproduction(partner, context);

  assert.is(fallbackDecision.usedNetwork, false);
  approxEqual(fallbackDecision.probability, context.baseProbability, 1e-12);
});

test('neural evaluation contributes to cognitive maintenance cost', () => {
  const dna = new DNA(30, 200, 100);
  const partnerDNA = new DNA(60, 90, 140);
  const acceptNode = OUTPUT_GROUPS.reproduction.find((entry) => entry.key === 'accept');

  assert.ok(acceptNode, 'reproduction outputs should include accept');
  setNeuralGene(dna, 0, { source: 0, target: acceptNode.id, weight: 0.7 });
  setNeuralGene(partnerDNA, 0, { source: 0, target: acceptNode.id, weight: 0.3 });

  const cell = new Cell(0, 0, dna, 6);
  const partner = new Cell(0, 1, partnerDNA, 5);

  cell.age = cell.lifespan / 4;
  cell.decideReproduction(partner, {
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    maxTileEnergy: 10,
    baseProbability: 0.55,
  });
  const dynamicLoad = cell._neuralLoad;

  assert.ok(dynamicLoad > 0, 'neural evaluation should add activation load');
  const context = { localDensity: 0.35, densityEffectMultiplier: 1.4, maxTileEnergy: 12 };
  const effDensity = clamp(context.localDensity * context.densityEffectMultiplier, 0, 1);
  const sen = typeof cell.dna.senescenceRate === 'function' ? cell.dna.senescenceRate() : 0;
  const ageFrac = cell.lifespan > 0 ? cell.age / cell.lifespan : 0;
  const energyDensityMult = lerp(
    cell.density.energyLoss.min,
    cell.density.energyLoss.max,
    effDensity
  );
  const metabolism = cell.metabolism;
  const energyLoss =
    dna.energyLossBase() *
    dna.baseEnergyLossScale() *
    (1 + metabolism) *
    (1 + sen * ageFrac) *
    energyDensityMult;
  const totalNeurons = cell.neurons + dynamicLoad;
  const expectedCognitive = dna.cognitiveCost(totalNeurons, cell.sight, effDensity);
  const initialEnergy = cell.energy;

  cell.manageEnergy(cell.row, cell.col, context);

  approxEqual(cell.energy, initialEnergy - (energyLoss + expectedCognitive), 1e-9);
  assert.is(cell._neuralLoad, 0);
});

test('disabled neural connections fall back to legacy policies', () => {
  const dna = new DNA(90, 45, 180);
  const partnerDNA = new DNA(10, 60, 140);
  const geneCount = dna.neuralGeneCount();

  assert.ok(geneCount > 0, 'DNA should provide neural genes to disable');

  for (let i = 0; i < geneCount; i++) {
    setNeuralGene(dna, i, { source: 0, target: 0, weight: 0, enabled: false });
  }

  const cell = new Cell(0, 0, dna, 5);
  const partner = new Cell(0, 1, partnerDNA, 4);

  assert.ok(cell.brain, 'cell should still instantiate a brain object');

  const reproSensors = {
    energy: 0.4,
    partnerEnergy: 0.5,
    effectiveDensity: 0.2,
    partnerSimilarity: 0.3,
    baseReproductionProbability: 0.65,
    ageFraction: 0.1,
    partnerAgeFraction: 0.2,
    selfSenescence: 0.05,
    partnerSenescence: 0.02,
    eventPressure: 0.15,
  };

  const evaluation = cell.brain.evaluateGroup('reproduction', reproSensors);

  assert.ok(evaluation, 'evaluation result should exist');
  assert.is(evaluation.activationCount, 0);
  assert.is(evaluation.values, null, 'no neural outputs should be produced when inactive');

  const baseProbability = 0.42;
  const decision = cell.decideReproduction(partner, {
    localDensity: 0.3,
    densityEffectMultiplier: 1.1,
    maxTileEnergy: 6,
    baseProbability,
  });

  assert.is(decision.usedNetwork, false, 'disabled connections should trigger legacy fallback');
  approxEqual(decision.probability, baseProbability, 1e-12);
});

test('brains prune unreachable hidden neurons and cognitive cost matches pruned count', () => {
  const dna = new DNA(90, 120, 60);
  const acceptNode = OUTPUT_GROUPS.reproduction.find((entry) => entry.key === 'accept');

  assert.ok(acceptNode, 'reproduction outputs should include accept');

  setNeuralGene(dna, 0, { source: 220, target: acceptNode.id, weight: 0.8 });
  setNeuralGene(dna, 1, { source: 0, target: 220, weight: 0.5 });
  setNeuralGene(dna, 2, { source: 222, target: 221, weight: 0.4 });
  setNeuralGene(dna, 3, { source: 221, target: 223, weight: 0.2 });

  const brain = Brain.fromDNA(dna);

  assert.ok(brain);
  assert.is(brain.neuronCount, 2, 'only neurons leading to outputs should remain');
  assert.is(brain.connectionCount, 2, 'irrelevant connections should be pruned');
  assert.is(brain.activationMap.has(221), false);

  const cell = new Cell(0, 0, dna, 5);

  assert.is(cell.neurons, 2, 'cell neuron count should reflect pruned brain');

  const context = { localDensity: 0.3, densityEffectMultiplier: 1.2, maxTileEnergy: 8 };
  const effDensity = clamp(context.localDensity * context.densityEffectMultiplier, 0, 1);
  const energyDensityMult = lerp(
    cell.density.energyLoss.min,
    cell.density.energyLoss.max,
    effDensity
  );
  const ageFrac = cell.lifespan > 0 ? cell.age / cell.lifespan : 0;
  const sen = typeof cell.dna.senescenceRate === 'function' ? cell.dna.senescenceRate() : 0;
  const baseLoss = cell.dna.energyLossBase();
  const lossScale =
    cell.dna.baseEnergyLossScale() *
    (1 + cell.metabolism) *
    (1 + sen * ageFrac) *
    energyDensityMult;
  const energyLoss = baseLoss * lossScale;
  const expectedCognitive = cell.dna.cognitiveCost(cell.neurons, cell.sight, effDensity);
  const startingEnergy = cell.energy;

  cell.manageEnergy(cell.row, cell.col, context);

  approxEqual(cell.energy, startingEnergy - (energyLoss + expectedCognitive), 1e-9);
});

test.run();
