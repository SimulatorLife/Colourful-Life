const { test } = require('uvu');
const assert = require('uvu/assert');

test('computeFitness calculates composite fitness', async () => {
  global.GridManager = { maxTileEnergy: 5 };
  const { computeFitness } = await import('../src/fitness.mjs');
  const cell = {
    fightsWon: 2,
    fightsLost: 1,
    offspring: 3,
    energy: 2.5,
    age: 50,
    lifespan: 100,
  };
  const result = computeFitness(cell);

  assert.is(result, 6);
});

test('computeFitness handles minimal stats', async () => {
  global.GridManager = { maxTileEnergy: 5 };
  const { computeFitness } = await import('../src/fitness.mjs');
  const cell = {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    energy: 0,
    age: 0,
    lifespan: 100,
  };
  const result = computeFitness(cell);

  assert.is(result, 0);
});

test.run();
