const { test } = require('uvu');
const assert = require('uvu/assert');

const computeFitnessModulePromise = import('../src/fitness.mjs');

test('computeFitness defaults to GridManager maxTileEnergy', async () => {
  global.GridManager = { maxTileEnergy: 8 };
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 2,
    fightsLost: 1,
    offspring: 3,
    energy: 4,
    age: 50,
    lifespan: 100,
  };

  const result = computeFitness(cell);
  const expected =
    (cell.fightsWon - cell.fightsLost) * 0.5 +
    (cell.offspring || 0) * 1.5 +
    cell.energy / global.GridManager.maxTileEnergy +
    cell.age / cell.lifespan;

  assert.is(result, expected);
});

test('computeFitness uses provided maxTileEnergy parameter', async () => {
  global.GridManager = { maxTileEnergy: 2 };
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 1,
    fightsLost: 0,
    offspring: 2,
    energy: 1,
    age: 10,
    lifespan: 40,
  };

  const result = computeFitness(cell, 4);
  const expected = (1 - 0) * 0.5 + 2 * 1.5 + 1 / 4 + cell.age / cell.lifespan;

  assert.is(result, expected);
});

test('computeFitness handles minimal stats with explicit max energy', async () => {
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    energy: 0,
    age: 0,
    lifespan: 100,
  };

  const result = computeFitness(cell, 5);

  assert.is(result, 0);
});

test.run();
