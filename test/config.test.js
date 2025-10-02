import { assert, test } from "#tests/harness";

const configModulePromise = import("../src/config.js");

test("MAX_TILE_ENERGY exposes the environment-aware default", async () => {
  const { MAX_TILE_ENERGY } = await configModulePromise;

  assert.is(MAX_TILE_ENERGY, 6);
});

test("resolveMaxTileEnergy respects overrides", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;

  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "8.5" }), 8.5);
});

test("resolveMaxTileEnergy falls back when override is invalid", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;

  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "-1" }), 6);
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

test("CONSUMPTION_DENSITY_PENALTY exposes the environment-aware default", async () => {
  const { CONSUMPTION_DENSITY_PENALTY } = await configModulePromise;

  assert.is(CONSUMPTION_DENSITY_PENALTY, 0.5);
});

test("resolveConsumptionDensityPenalty respects overrides", async () => {
  const { resolveConsumptionDensityPenalty } = await configModulePromise;

  assert.is(
    resolveConsumptionDensityPenalty({
      COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY: "0.35",
    }),
    0.35,
  );
});

test("resolveConsumptionDensityPenalty falls back when override is invalid", async () => {
  const { resolveConsumptionDensityPenalty } = await configModulePromise;

  assert.is(
    resolveConsumptionDensityPenalty({
      COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY: "-0.1",
    }),
    0.5,
  );
});

test("TRAIT_ACTIVATION_THRESHOLD exposes the environment-aware default", async () => {
  const { TRAIT_ACTIVATION_THRESHOLD } = await configModulePromise;

  assert.is(TRAIT_ACTIVATION_THRESHOLD, 0.6);
});

test("resolveTraitActivationThreshold respects overrides", async () => {
  const { resolveTraitActivationThreshold } = await configModulePromise;

  assert.is(
    resolveTraitActivationThreshold({
      COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD: "0.72",
    }),
    0.72,
  );
});

test("resolveTraitActivationThreshold clamps invalid overrides", async () => {
  const { resolveTraitActivationThreshold } = await configModulePromise;

  assert.is(
    resolveTraitActivationThreshold({
      COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD: "1.4",
    }),
    1,
  );

  assert.is(
    resolveTraitActivationThreshold({
      COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD: "-0.2",
    }),
    0,
  );

  assert.is(
    resolveTraitActivationThreshold({
      COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD: "NaN",
    }),
    0.6,
  );
});

test("ACTIVITY_BASE_RATE exposes the environment-aware default", async () => {
  const { ACTIVITY_BASE_RATE } = await configModulePromise;

  assert.is(ACTIVITY_BASE_RATE, 0.28);
});

test("resolveActivityBaseRate respects overrides", async () => {
  const { resolveActivityBaseRate } = await configModulePromise;

  assert.is(
    resolveActivityBaseRate({ COLOURFUL_LIFE_ACTIVITY_BASE_RATE: "0.45" }),
    0.45,
  );
});

test("resolveActivityBaseRate clamps invalid overrides", async () => {
  const { resolveActivityBaseRate } = await configModulePromise;

  assert.is(resolveActivityBaseRate({ COLOURFUL_LIFE_ACTIVITY_BASE_RATE: "1.4" }), 1);

  assert.is(resolveActivityBaseRate({ COLOURFUL_LIFE_ACTIVITY_BASE_RATE: "-0.5" }), 0);

  assert.is(
    resolveActivityBaseRate({ COLOURFUL_LIFE_ACTIVITY_BASE_RATE: "NaN" }),
    0.28,
  );
});
