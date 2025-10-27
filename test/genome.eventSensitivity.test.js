import { assert, test } from "#tests/harness";

import DNA, { GENE_LOCI } from "../src/genome.js";

function createGenome(overrides = {}) {
  const dna = new DNA(120, 120, 120);
  const defaults = {
    DENSITY: 128,
    RECOVERY: 128,
    ENERGY_EFFICIENCY: 128,
    MOVEMENT: 128,
    RISK: 128,
    COOPERATION: 128,
    ENERGY_CAPACITY: 128,
    NEURAL: 128,
    COHESION: 128,
    PARENTAL: 128,
    RESIST_FLOOD: 128,
    RESIST_DROUGHT: 128,
    RESIST_HEAT: 128,
    RESIST_COLD: 128,
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    const locus = GENE_LOCI[key];

    if (typeof locus !== "number") continue;

    dna.genes[locus] = value;
  }

  return dna;
}

test("eventEnergyLossMultiplier rewards flood-resilient traits", () => {
  const resilient = createGenome({
    DENSITY: 230,
    RECOVERY: 220,
    ENERGY_EFFICIENCY: 210,
    MOVEMENT: 40,
    RISK: 40,
  });
  const fragile = createGenome({
    DENSITY: 40,
    RECOVERY: 40,
    ENERGY_EFFICIENCY: 60,
    MOVEMENT: 220,
    RISK: 220,
  });

  const resilientMultiplier = resilient.eventEnergyLossMultiplier("flood", {
    strength: 1,
  });
  const fragileMultiplier = fragile.eventEnergyLossMultiplier("flood", {
    strength: 1,
  });

  assert.ok(
    resilientMultiplier < fragileMultiplier,
    `Resilient genomes should suffer less flood drain (resilient=${resilientMultiplier}, fragile=${fragileMultiplier})`,
  );
  assert.ok(
    resilientMultiplier >= 0.55 && resilientMultiplier <= 1.5,
    `Multiplier must remain clamped (received ${resilientMultiplier})`,
  );
  assert.ok(
    fragileMultiplier >= 0.55 && fragileMultiplier <= 1.5,
    `Fragile multiplier must remain clamped (received ${fragileMultiplier})`,
  );
});

test("eventEnergyLossMultiplier differentiates drought preparedness", () => {
  const droughtReady = createGenome({
    ENERGY_EFFICIENCY: 230,
    RECOVERY: 210,
    ENERGY_CAPACITY: 210,
    COOPERATION: 200,
    RISK: 40,
  });
  const droughtFragile = createGenome({
    ENERGY_EFFICIENCY: 40,
    RECOVERY: 40,
    ENERGY_CAPACITY: 60,
    COOPERATION: 40,
    RISK: 220,
  });

  const readyMultiplier = droughtReady.eventEnergyLossMultiplier("drought", {
    strength: 0.8,
  });
  const fragileMultiplier = droughtFragile.eventEnergyLossMultiplier("drought", {
    strength: 0.8,
  });
  const unknown = droughtReady.eventEnergyLossMultiplier("volcanic", {
    strength: 1,
  });

  assert.ok(
    readyMultiplier < fragileMultiplier,
    `Efficient genomes should weather drought better (prepared=${readyMultiplier}, fragile=${fragileMultiplier})`,
  );
  assert.ok(
    unknown >= 0.55 && unknown <= 1.5,
    `Unknown events should still clamp multipliers (received ${unknown})`,
  );
});
