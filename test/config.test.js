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

test("REGEN_DENSITY_PENALTY exposes the environment-aware default", async () => {
  const { REGEN_DENSITY_PENALTY } = await configModulePromise;

  assert.is(REGEN_DENSITY_PENALTY, 0.5);
});

test("resolveRegenDensityPenalty respects overrides", async () => {
  const { resolveRegenDensityPenalty } = await configModulePromise;

  assert.is(
    resolveRegenDensityPenalty({ COLOURFUL_LIFE_REGEN_DENSITY_PENALTY: "0.65" }),
    0.65,
  );
});

test("resolveRegenDensityPenalty falls back when override is invalid", async () => {
  const { resolveRegenDensityPenalty } = await configModulePromise;

  assert.is(
    resolveRegenDensityPenalty({ COLOURFUL_LIFE_REGEN_DENSITY_PENALTY: "1.5" }),
    0.5,
  );
});

test.run();
