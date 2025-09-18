const { test } = require('uvu');
const assert = require('uvu/assert');

let Cell;
let DNA;
let clamp;
let lerp;

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
  ({ clamp, lerp } = await import('../src/utils.js'));
});

test('manageEnergy applies DNA-driven metabolism and starvation rules', () => {
  const dna = new DNA(30, 200, 100);
  const initialEnergy = 5;
  const maxTileEnergy = 12;
  const cell = new Cell(2, 3, dna, initialEnergy);
  const context = { localDensity: 0.3, densityEffectMultiplier: 2, maxTileEnergy: 12 };
  const effDensity = clamp(context.localDensity * context.densityEffectMultiplier, 0, 1);
  const densityResponse = dna.densityResponses().energyLoss;
  const energyDensityMult = lerp(densityResponse.min, densityResponse.max, effDensity);
  const geneRow = dna.weights()[5];
  const metabolism = geneRow.reduce((sum, gene) => sum + Math.abs(gene), 0) / geneRow.length;
  const energyLoss =
    dna.energyLossBase() * dna.baseEnergyLossScale() * (1 + metabolism) * energyDensityMult;
  const cognitiveLoss = dna.cognitiveCost(cell.neurons, cell.sight, effDensity);

  const starving = cell.manageEnergy(cell.row, cell.col, context);
  const expectedEnergy = initialEnergy - (energyLoss + cognitiveLoss);
  const starvationThreshold = dna.starvationThresholdFrac() * context.maxTileEnergy;

  expectClose(cell.energy, expectedEnergy, 1e-12, 'energy after management');
  assert.ok(cell.energy < initialEnergy, 'energy should decrease');
  assert.is(starving, expectedEnergy <= starvationThreshold);
});

test('breed combines parental investments for offspring energy', () => {
  const dnaA = new DNA(10, 120, 200);
  const dnaB = new DNA(200, 80, 40);
  const parentA = new Cell(4, 5, dnaA, 8);
  const parentB = new Cell(4, 5, dnaB, 9);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const investA = Math.min(energyBeforeA, energyBeforeA * investFracA);
  const investB = Math.min(energyBeforeB, energyBeforeB * investFracB);

  const child = withMockedRandom([0.9, 0.9, 0.9, 0.5], () => Cell.breed(parentA, parentB));

  const expectedEnergy = investA + investB;

  assert.ok(child instanceof Cell, 'breed should return a Cell');
  assert.is(child.row, parentA.row);
  assert.is(child.col, parentA.col);
  expectClose(child.energy, expectedEnergy, 1e-12, 'offspring energy');
  expectClose(parentA.energy, energyBeforeA - investA, 1e-12, 'parent A energy');
  expectClose(parentB.energy, energyBeforeB - investB, 1e-12, 'parent B energy');
  assert.is(parentA.offspring, 1);
  assert.is(parentB.offspring, 1);
});

test('breed applies mutation when RNG roll falls within mutation chance', () => {
  const dnaA = new DNA(100, 150, 200);
  const dnaB = new DNA(140, 160, 210);
  const parentA = new Cell(7, 8, dnaA, 6);
  const parentB = new Cell(7, 8, dnaB, 6);
  const avgStrategy = (parentA.strategy + parentB.strategy) / 2;
  const chance = (dnaA.mutationChance() + dnaB.mutationChance()) / 2;
  const range = Math.round((dnaA.mutationRange() + dnaB.mutationRange()) / 2);

  assert.ok(chance > 0.01, 'mutation chance should exceed mocked roll');

  const child = withMockedRandom([0.01, 0.75, 0.9, 0.9, 0.5], () => Cell.breed(parentA, parentB));

  const avgRed = Math.round((dnaA.r + dnaB.r) / 2);
  const avgGreen = Math.round((dnaA.g + dnaB.g) / 2);
  const avgBlue = Math.round((dnaA.b + dnaB.b) / 2);
  const expectedRed = Math.min(255, Math.max(0, avgRed + Math.floor((0.75 * 2 - 1) * range)));

  assert.not.equal(child.dna.r, avgRed, 'red channel should mutate');
  assert.is(child.dna.r, expectedRed);
  assert.is(child.dna.g, avgGreen);
  assert.is(child.dna.b, avgBlue);
  expectClose(child.strategy, avgStrategy, 1e-12, 'strategy averages when mutation delta is zero');
});

test.run();
