const { test } = require('uvu');
const assert = require('uvu/assert');

test('EnvironmentField blocks regeneration on obstacle tiles', async () => {
  const { default: EnvironmentField } = await import('../src/environmentField.js');

  const field = new EnvironmentField(1, 3, { maxTileEnergy: 10 });

  field.setObstacleChecker((row, col) => col === 0);

  field.setEnergy(0, 0, 10);
  field.setEnergy(0, 1, 0);
  field.setEnergy(0, 2, 0);

  field.tick({ events: [], regenRate: 0, diffusionRate: 1, densityGrid: [[0, 0, 0]] });

  assert.is(field.getEnergy(0, 0), 0, 'obstacle tile should remain empty');
  assert.is(field.getEnergy(0, 1), 0, 'blocked neighbor should not gain energy');
});

test('EnvironmentField respects custom max tile energy', async () => {
  const { default: EnvironmentField } = await import('../src/environmentField.js');

  const field = new EnvironmentField(1, 1, { maxTileEnergy: 12 });

  field.setEnergy(0, 0, 6);

  field.tick({ events: [], regenRate: 12, diffusionRate: 0, densityGrid: [[0]] });
  assert.is(field.getEnergy(0, 0), 12, 'regen should clamp to custom max');

  const harvested = field.takeEnergy(0, 0, 20);

  assert.is(harvested, 12, 'harvest should not exceed max');
  assert.is(field.getEnergy(0, 0), 0, 'tile should track harvested energy');
});

test.run();
