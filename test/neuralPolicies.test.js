const { test } = require('uvu');
const assert = require('uvu/assert');

let Cell;
let DNA;
let clamp;
let lerp;

function approxEqual(a, b, tolerance = 1e-9) {
  assert.ok(Math.abs(a - b) <= tolerance, `expected ${a} ≈ ${b}`);
}

test.before(async () => {
  ({ default: Cell } = await import('../src/cell.js'));
  ({ DNA } = await import('../src/genome.js'));
  ({ clamp, lerp } = await import('../src/utils.js'));
});

test('evaluatePolicy produces deterministic, DNA-specific logits', () => {
  const dnaA = new DNA(10, 20, 30);
  const dnaB = new DNA(150, 90, 40);
  const cellA = new Cell(0, 0, dnaA, 3);
  const cellB = new Cell(0, 0, dnaB, 3);
  const inputs = [0.2, 0.4, 0.1, 0.3, 0.1, 0.2, 0.3, 0.1, 0.5, 0.0];
  const logitsA1 = cellA.evaluatePolicy('movement-strategy', inputs, 3);
  const logitsA2 = cellA.evaluatePolicy('movement-strategy', inputs, 3);

  assert.is(Array.isArray(logitsA1), true);
  assert.is(logitsA1.length, 3);
  logitsA1.forEach((value, index) => {
    approxEqual(value, logitsA2[index], 1e-9);
  });

  const logitsB = cellB.evaluatePolicy('movement-strategy', inputs, 3);
  const identical = logitsA1.every((value, index) => Math.abs(value - logitsB[index]) < 1e-6);

  assert.ok(!identical, 'different DNA should yield different policy logits');
});

test('decideReproduction integrates neural policy with deterministic fallback', () => {
  const dnaA = new DNA(120, 200, 40);
  const dnaB = new DNA(200, 40, 160);
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

  fallbackCell.neurons = 0;
  const fallbackDecision = fallbackCell.decideReproduction(partner, context);

  assert.is(fallbackDecision.usedNetwork, false);
  approxEqual(fallbackDecision.probability, context.baseProbability, 1e-12);
});

test('neural evaluation contributes to cognitive maintenance cost', () => {
  const dna = new DNA(30, 200, 100);
  const cell = new Cell(0, 0, dna, 6);

  cell.age = cell.lifespan / 4;
  const inputs = [0.5, 0.2, 0.3, 0.1, 0.2, 0.6, 0.4, 0.2, 0.3, 0.1];

  cell.evaluatePolicy('movement-strategy', inputs, 3);
  const dynamicLoad = cell._neuralLoad;
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

test.run();
