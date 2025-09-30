import { test } from "uvu";
import * as assert from "uvu/assert";

const configModulePromise = import("../src/config.js");

test("MAX_TILE_ENERGY exposes the environment-aware default", async () => {
  const { MAX_TILE_ENERGY } = await configModulePromise;

  assert.is(MAX_TILE_ENERGY, 5);
});

test("resolveMaxTileEnergy respects overrides", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;

  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "8.5" }), 8.5);
});

test("resolveMaxTileEnergy falls back when override is invalid", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;

  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "-1" }), 5);
});

test.run();
