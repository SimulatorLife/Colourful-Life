const { test } = require('uvu');
const assert = require('uvu/assert');

let Cell;
let DNA;
let clamp;
let lerp;
let randomRange;

function investmentFor(energy, investFrac, starvation) {
  const desired = Math.max(0, Math.min(energy, energy * investFrac));
  const maxSpend = Math.max(0, energy - starvation);

  return Math.min(desired, maxSpend);
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

function expectClose(actual, expected, tolerance = 1e-12, message = 'values differ') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} !== ${expected}`);
}

test.before(async () => {
  ({ default: Cell } = await import('../src/cell.js'));
  ({ DNA } = await import('../src/genome.js'));
  ({ clamp, lerp, randomRange } = await import('../src/utils.js'));
  if (typeof global.window === 'undefined') global.window = globalThis;
  if (!window.GridManager) window.GridManager = {};
  if (typeof window.GridManager.maxTileEnergy !== 'number') {
    window.GridManager.maxTileEnergy = 12;
  }
});

function predictDeterministicOffspring(dnaA, dnaB, mutationChance, mutationRange) {
  const rng = dnaA.prngFor('crossover');
  const blendA = typeof dnaA.crossoverMix === 'function' ? dnaA.crossoverMix() : 0.5;
  const blendB = typeof dnaB.crossoverMix === 'function' ? dnaB.crossoverMix() : 0.5;
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

test('manageEnergy applies DNA-driven metabolism and starvation rules', () => {
  const dna = new DNA(30, 200, 100);
  const initialEnergy = 5;
  const maxTileEnergy = 12;
  const cell = new Cell(2, 3, dna, initialEnergy);
  const context = { localDensity: 0.3, densityEffectMultiplier: 2, maxTileEnergy: 12 };
  const effDensity = clamp(context.localDensity * context.densityEffectMultiplier, 0, 1);
  const densityResponse = dna.densityResponses().energyLoss;
  const energyDensityMult = lerp(densityResponse.min, densityResponse.max, effDensity);
  const metabolism = cell.metabolism;
  const sen = typeof dna.senescenceRate === 'function' ? dna.senescenceRate() : 0;
  const baseLoss = dna.energyLossBase();
  const ageFrac = cell.lifespan > 0 ? cell.age / cell.lifespan : 0;
  const lossScale =
    dna.baseEnergyLossScale() * (1 + metabolism) * (1 + sen * ageFrac) * energyDensityMult;
  const energyLoss = clamp(baseLoss * lossScale, 0.004, 0.35);
  const cognitiveLoss = dna.cognitiveCost(cell.neurons, cell.sight, effDensity);

  const starving = cell.manageEnergy(cell.row, cell.col, context);
  const expectedEnergy = initialEnergy - (energyLoss + cognitiveLoss);
  const starvationThreshold = dna.starvationThresholdFrac() * context.maxTileEnergy;

  expectClose(cell.energy, expectedEnergy, 1e-12, 'energy after management');
  assert.ok(cell.energy < initialEnergy, 'energy should decrease');
  assert.is(starving, expectedEnergy <= starvationThreshold);
});

test('breed spends parental investment energy without creating extra energy', () => {
  const dnaA = new DNA(10, 120, 200);
  const dnaB = new DNA(200, 80, 40);
  const parentA = new Cell(4, 5, dnaA, 8);
  const parentB = new Cell(4, 5, dnaB, 9);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const investA = investmentFor(energyBeforeA, investFracA, starvationA);
  const investB = investmentFor(energyBeforeB, investFracB, starvationB);
  const totalInvestment = investA + investB;

  const child = withMockedRandom([0.9, 0.9, 0.9, 0.5], () => Cell.breed(parentA, parentB));

  const expectedEnergy = totalInvestment;

  assert.ok(child instanceof Cell, 'breed should return a Cell');
  assert.is(child.row, parentA.row);
  assert.is(child.col, parentA.col);
  expectClose(child.energy, expectedEnergy, 1e-12, 'offspring energy');
  expectClose(parentA.energy, energyBeforeA - investA, 1e-12, 'parent A energy');
  expectClose(parentB.energy, energyBeforeB - investB, 1e-12, 'parent B energy');
  expectClose(
    totalInvestment,
    energyBeforeA - parentA.energy + (energyBeforeB - parentB.energy),
    1e-12,
    'investments match energy spent'
  );
  assert.is(parentA.offspring, 1);
  assert.is(parentB.offspring, 1);
  assert.ok(parentA.energy >= starvationA, 'parent A respects starvation floor');
  assert.ok(parentB.energy >= starvationB, 'parent B respects starvation floor');
});

test('breed returns null when either parent lacks investable energy', () => {
  const dnaA = new DNA(240, 10, 10);
  const dnaB = new DNA(240, 10, 10);
  const parentA = new Cell(3, 4, dnaA, 0);
  const parentB = new Cell(3, 4, dnaB, 2);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const starvationA = parentA.starvationThreshold(window.GridManager.maxTileEnergy);
  const starvationB = parentB.starvationThreshold(window.GridManager.maxTileEnergy);

  const offspring = Cell.breed(parentA, parentB);

  assert.is(offspring, null, 'offspring should be null when investments are zero');
  expectClose(parentA.energy, energyBeforeA, 1e-12, 'parent A energy unchanged');
  expectClose(parentB.energy, energyBeforeB, 1e-12, 'parent B energy unchanged');
  assert.is(parentA.offspring, 0);
  assert.is(parentB.offspring, 0);
  assert.ok(
    parentA.energy <= starvationA,
    'parent A stays at or below starvation floor when energy is insufficient'
  );
  assert.ok(
    parentB.energy <= starvationB,
    'parent B stays at or below starvation floor when energy is insufficient'
  );
});

test('breed clamps investment so parents stop at starvation threshold', () => {
  const dnaA = new DNA(30, 240, 220);
  const dnaB = new DNA(200, 220, 60);
  const parentA = new Cell(5, 6, dnaA, 6);
  const parentB = new Cell(5, 6, dnaB, 6);
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const expectedInvestA = investmentFor(energyBeforeA, dnaA.parentalInvestmentFrac(), starvationA);
  const expectedInvestB = investmentFor(energyBeforeB, dnaB.parentalInvestmentFrac(), starvationB);

  assert.ok(starvationA > 0, 'starvation threshold should be positive');
  assert.ok(starvationB > 0, 'starvation threshold should be positive');

  const child = withMockedRandom([0.6, 0.6, 0.6, 0.5], () => Cell.breed(parentA, parentB));

  assert.ok(child instanceof Cell, 'offspring should be produced when both can invest');
  assert.ok(parentA.energy >= starvationA, 'parent A energy stays above starvation floor');
  assert.ok(parentB.energy >= starvationB, 'parent B energy stays above starvation floor');
  expectClose(
    parentA.energy,
    energyBeforeA - expectedInvestA,
    1e-12,
    'parent A investment matches clamp'
  );
  expectClose(
    parentB.energy,
    energyBeforeB - expectedInvestB,
    1e-12,
    'parent B investment matches clamp'
  );
  expectClose(
    child.energy,
    expectedInvestA + expectedInvestB,
    1e-12,
    'child energy equals combined investments'
  );
});

test('breed applies deterministic crossover and honors forced mutation', () => {
  const dnaA = new DNA(100, 150, 200);
  const dnaB = new DNA(140, 160, 210);
  const parentA = new Cell(7, 8, dnaA, 6);
  const parentB = new Cell(7, 8, dnaB, 6);
  const avgStrategy = (parentA.strategy + parentB.strategy) / 2;

  // Force mutation to trigger and make expectations deterministic
  dnaA.mutationChance = () => 1;
  dnaB.mutationChance = () => 1;
  dnaA.mutationRange = () => 12;
  dnaB.mutationRange = () => 12;

  const chance = 1;
  const range = 12;
  const expectedGenes = predictDeterministicOffspring(dnaA, dnaB, chance, range);
  const child = withMockedRandom([0.5], () => Cell.breed(parentA, parentB));

  assert.is(child.dna.length, expectedGenes.length);
  for (let i = 0; i < expectedGenes.length; i++) {
    assert.is(child.dna.geneAt(i), expectedGenes[i]);
  }
  expectClose(child.strategy, avgStrategy, 1e-12, 'strategy averages when mutation delta is zero');
});

test.run();
