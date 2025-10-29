import { assert, test } from "#tests/harness";

import DNA, { GENE_LOCI } from "../src/genome.js";

function createGenome(overrides = {}) {
  const dna = new DNA(120, 120, 120);
  const defaults = {
    PARENTAL: 128,
    FERTILITY: 128,
    COOPERATION: 128,
    GESTATION_EFFICIENCY: 128,
    ENERGY_EFFICIENCY: 128,
    ENERGY_CAPACITY: 128,
    RISK: 128,
  };

  for (const [key, value] of Object.entries(defaults)) {
    const locus = GENE_LOCI[key];

    if (typeof locus !== "number") continue;

    dna.genes[locus] = overrides[key] ?? value;
  }

  return dna;
}

test("nurturing genomes request larger spawn buffers", () => {
  const baseline = createGenome();
  const supportive = createGenome({
    PARENTAL: 232,
    COOPERATION: 210,
    GESTATION_EFFICIENCY: 220,
    ENERGY_CAPACITY: 230,
    ENERGY_EFFICIENCY: 96,
    RISK: 40,
    FERTILITY: 200,
  });
  const opportunist = createGenome({
    PARENTAL: 40,
    COOPERATION: 60,
    GESTATION_EFFICIENCY: 60,
    ENERGY_CAPACITY: 60,
    ENERGY_EFFICIENCY: 220,
    RISK: 230,
    FERTILITY: 80,
  });
  const context = { scarcity: 0.4 };

  const baselineBuffer = baseline.spawnEnergyBufferFrac(context);
  const supportiveBuffer = supportive.spawnEnergyBufferFrac(context);
  const opportunistBuffer = opportunist.spawnEnergyBufferFrac(context);

  assert.ok(
    supportiveBuffer > baselineBuffer,
    `supportive lineages should hold larger spawn reserves (baseline=${baselineBuffer}, supportive=${supportiveBuffer})`,
  );
  assert.ok(
    opportunistBuffer < supportiveBuffer,
    `risk-heavy opportunists should reserve less than supportive lineages (opportunist=${opportunistBuffer}, supportive=${supportiveBuffer})`,
  );
  assert.ok(
    opportunistBuffer >= 0.02 && opportunistBuffer <= 0.2,
    `buffer output must remain within clamp bounds (received ${opportunistBuffer})`,
  );
});

test("scarcity context nudges buffers upward for similar genomes", () => {
  const settled = createGenome({
    PARENTAL: 188,
    COOPERATION: 170,
    GESTATION_EFFICIENCY: 186,
    ENERGY_CAPACITY: 200,
    ENERGY_EFFICIENCY: 110,
    RISK: 90,
    FERTILITY: 170,
  });
  const abundant = createGenome({
    PARENTAL: 188,
    COOPERATION: 170,
    GESTATION_EFFICIENCY: 186,
    ENERGY_CAPACITY: 200,
    ENERGY_EFFICIENCY: 110,
    RISK: 90,
    FERTILITY: 170,
  });

  const lowScarcityBuffer = settled.spawnEnergyBufferFrac({ scarcity: 0 });
  const highScarcityBuffer = abundant.spawnEnergyBufferFrac({ scarcity: 0.95 });

  assert.ok(
    highScarcityBuffer >= lowScarcityBuffer,
    `scarcity should not reduce reserves (low=${lowScarcityBuffer}, high=${highScarcityBuffer})`,
  );
  assert.ok(
    highScarcityBuffer - lowScarcityBuffer < 0.25,
    `scarcity scaling should stay within a realistic span (delta=${highScarcityBuffer - lowScarcityBuffer})`,
  );
});
