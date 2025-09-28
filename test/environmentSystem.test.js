const { test } = require('uvu');
const assert = require('uvu/assert');

const createEnv = async (rows = 2, cols = 2, opts = {}) => {
  const { default: EnvironmentSystem } = await import('../src/environmentSystem.js');

  return new EnvironmentSystem(rows, cols, {
    maxTileEnergy: 10,
    isEventAffecting: () => true,
    getEventEffect: () => null,
    ...opts,
  });
};

test('consumeEnergy harvests from the tile respecting density penalties', async () => {
  const env = await createEnv(1, 1);
  const densityGrid = [[0.5]];
  const cell = {
    energy: 0,
    dna: {
      forageRate: () => 1,
      harvestCapMin: () => 0.1,
      harvestCapMax: () => 0.5,
    },
  };

  env.energyGrid[0][0] = 1;
  env.consumeEnergy(cell, 0, 0, densityGrid, 2);

  assert.ok(cell.energy > 0, 'cell should gain some harvested energy');
  assert.ok(cell.energy <= 0.5, 'harvest cap should limit gains');
  assert.ok(env.energyGrid[0][0] < 1, 'tile energy should decrease after harvesting');
});

test('regenerateEnergyGrid diffuses into neighbouring tiles and respects obstacles', async () => {
  const env = await createEnv(1, 3);

  env.energyGrid = [[0, 10, 0]];
  const isObstacle = (row, col) => col === 0;

  env.regenerateEnergyGrid({
    events: [],
    eventStrengthMultiplier: 1,
    regenRate: 0,
    diffusionRate: 1,
    densityGrid: [[0, 0, 0]],
    densityEffectMultiplier: 1,
    isObstacle,
  });

  assert.is(env.energyGrid[0][0], 0, 'obstacle tile should remain empty');
  assert.ok(env.energyGrid[0][1] < 10, 'source tile should lose energy');
  assert.ok(env.energyGrid[0][2] > 0, 'energy should diffuse into open neighbours');
});

module.exports = { createEnv };

test.run();
