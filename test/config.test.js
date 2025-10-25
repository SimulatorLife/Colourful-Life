import { assert, test } from "#tests/harness";

const configModulePromise = import("../src/config.js");

test("MAX_TILE_ENERGY exposes the environment-aware default", async () => {
  const { MAX_TILE_ENERGY } = await configModulePromise;

  assert.is(MAX_TILE_ENERGY, 2);
});

test("resolveMaxTileEnergy respects overrides", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;

  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "8.5" }), 8.5);
});

test("resolveMaxTileEnergy falls back when override is invalid", async () => {
  const { resolveMaxTileEnergy } = await configModulePromise;
  const fallback = resolveMaxTileEnergy({});

  assert.is(fallback, 2);
  assert.is(resolveMaxTileEnergy({ COLOURFUL_LIFE_MAX_TILE_ENERGY: "-1" }), fallback);
});

test("REGEN_DENSITY_PENALTY exposes the environment-aware default", async () => {
  const { REGEN_DENSITY_PENALTY } = await configModulePromise;

  assert.is(REGEN_DENSITY_PENALTY, 0.39);
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
    0.39,
  );
});

test("CONSUMPTION_DENSITY_PENALTY exposes the environment-aware default", async () => {
  const { CONSUMPTION_DENSITY_PENALTY } = await configModulePromise;

  assert.is(CONSUMPTION_DENSITY_PENALTY, 0.3);
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
    0.3,
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

test("MUTATION_CHANCE_BASELINE exposes the environment-aware default", async () => {
  const { MUTATION_CHANCE_BASELINE } = await configModulePromise;

  assert.is(MUTATION_CHANCE_BASELINE, 0.15);
});

test("resolveMutationChance respects overrides", async () => {
  const { resolveMutationChance } = await configModulePromise;

  assert.is(resolveMutationChance({ COLOURFUL_LIFE_MUTATION_CHANCE: "0.22" }), 0.22);
});

test("resolveMutationChance clamps invalid overrides", async () => {
  const { resolveMutationChance } = await configModulePromise;

  assert.is(resolveMutationChance({ COLOURFUL_LIFE_MUTATION_CHANCE: "-0.5" }), 0);

  assert.is(resolveMutationChance({ COLOURFUL_LIFE_MUTATION_CHANCE: "2" }), 1);

  assert.is(resolveMutationChance({ COLOURFUL_LIFE_MUTATION_CHANCE: "NaN" }), 0.15);
});

test("DECAY_RETURN_FRACTION exposes the environment-aware default", async () => {
  const { DECAY_RETURN_FRACTION } = await configModulePromise;

  assert.is(DECAY_RETURN_FRACTION, 0.88);
});

test("resolveDecayReturnFraction respects overrides", async () => {
  const { resolveDecayReturnFraction } = await configModulePromise;

  assert.is(
    resolveDecayReturnFraction({ COLOURFUL_LIFE_DECAY_RETURN_FRACTION: "0.6" }),
    0.6,
  );
});

test("resolveDecayReturnFraction clamps invalid overrides", async () => {
  const { resolveDecayReturnFraction } = await configModulePromise;

  assert.is(
    resolveDecayReturnFraction({ COLOURFUL_LIFE_DECAY_RETURN_FRACTION: "-0.3" }),
    0,
  );

  assert.is(
    resolveDecayReturnFraction({ COLOURFUL_LIFE_DECAY_RETURN_FRACTION: "1.4" }),
    1,
  );

  assert.is(
    resolveDecayReturnFraction({ COLOURFUL_LIFE_DECAY_RETURN_FRACTION: "NaN" }),
    0.88,
  );
});

test("DECAY_MAX_AGE exposes the environment-aware default", async () => {
  const { DECAY_MAX_AGE } = await configModulePromise;

  assert.is(DECAY_MAX_AGE, 240);
});

test("resolveDecayMaxAge respects overrides", async () => {
  const { resolveDecayMaxAge } = await configModulePromise;

  assert.is(resolveDecayMaxAge({ COLOURFUL_LIFE_DECAY_MAX_AGE: "480" }), 480);
});

test("resolveDecayMaxAge falls back when override is invalid", async () => {
  const { resolveDecayMaxAge } = await configModulePromise;

  assert.is(resolveDecayMaxAge({ COLOURFUL_LIFE_DECAY_MAX_AGE: "0" }), 240);
  assert.is(resolveDecayMaxAge({ COLOURFUL_LIFE_DECAY_MAX_AGE: "NaN" }), 240);
});

test("OFFSPRING_VIABILITY_BUFFER exposes the environment-aware default", async () => {
  const { OFFSPRING_VIABILITY_BUFFER } = await configModulePromise;

  assert.is(OFFSPRING_VIABILITY_BUFFER, 1.12);
});

test("resolveOffspringViabilityBuffer respects overrides", async () => {
  const { resolveOffspringViabilityBuffer } = await configModulePromise;

  assert.is(
    resolveOffspringViabilityBuffer({
      COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER: "1.5",
    }),
    1.5,
  );
});

test("resolveOffspringViabilityBuffer clamps invalid overrides", async () => {
  const { resolveOffspringViabilityBuffer } = await configModulePromise;

  assert.is(
    resolveOffspringViabilityBuffer({
      COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER: "0.8",
    }),
    1,
  );

  assert.is(
    resolveOffspringViabilityBuffer({
      COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER: "3.4",
    }),
    2,
  );

  assert.is(
    resolveOffspringViabilityBuffer({
      COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER: "NaN",
    }),
    1.12,
  );
});
