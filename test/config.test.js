import { test } from 'uvu';
import * as assert from 'uvu/assert';

const configModulePromise = import('../src/config.js');

test('MAX_TILE_ENERGY exposes the config default', async () => {
  const { MAX_TILE_ENERGY } = await configModulePromise;

  assert.is(MAX_TILE_ENERGY, 5);
});

test.run();
