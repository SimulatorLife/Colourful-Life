const { test } = require('uvu');
const assert = require('uvu/assert');

const configModulePromise = import('../src/config.js');

test('getDefaultMaxTileEnergy returns GridManager value when available', async () => {
  global.GridManager = { maxTileEnergy: 11 };
  const { getDefaultMaxTileEnergy } = await configModulePromise;

  const result = getDefaultMaxTileEnergy();

  assert.is(result, 11);

  delete global.GridManager;
});

test('getDefaultMaxTileEnergy falls back to config default when GridManager missing', async () => {
  delete global.GridManager;
  const { getDefaultMaxTileEnergy, MAX_TILE_ENERGY } = await configModulePromise;

  const result = getDefaultMaxTileEnergy();

  assert.is(result, MAX_TILE_ENERGY);
});

test.run();
