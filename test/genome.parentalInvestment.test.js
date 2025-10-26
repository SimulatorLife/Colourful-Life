import { assert, test } from "#tests/harness";

import DNA, { GENE_LOCI } from "../src/genome.js";

function createGenome(overrides = {}) {
  const dna = new DNA(120, 120, 120);
  const defaults = {
    PARENTAL: 128,
    FERTILITY: 128,
    COOPERATION: 128,
    RECOVERY: 128,
    GESTATION_EFFICIENCY: 128,
    ENERGY_EFFICIENCY: 128,
    RISK: 128,
  };

  for (const [key, value] of Object.entries(defaults)) {
    const locus = GENE_LOCI[key];

    if (typeof locus !== "number") continue;

    dna.genes[locus] = overrides[key] ?? value;
  }

  return dna;
}

test("supportive genomes invest more energy in offspring", () => {
  const baseline = createGenome();
  const supportive = createGenome({
    PARENTAL: 220,
    FERTILITY: 200,
    COOPERATION: 200,
    RECOVERY: 210,
    GESTATION_EFFICIENCY: 210,
    ENERGY_EFFICIENCY: 210,
    RISK: 60,
  });
  const opportunist = createGenome({
    PARENTAL: 220,
    FERTILITY: 200,
    COOPERATION: 60,
    RECOVERY: 60,
    GESTATION_EFFICIENCY: 60,
    ENERGY_EFFICIENCY: 60,
    RISK: 230,
  });

  const baseInvestment = baseline.parentalInvestmentFrac();
  const supportiveInvestment = supportive.parentalInvestmentFrac();
  const opportunistInvestment = opportunist.parentalInvestmentFrac();

  assert.ok(
    supportiveInvestment > baseInvestment,
    `Supportive traits should raise investment (baseline=${baseInvestment}, supportive=${supportiveInvestment})`,
  );
  assert.ok(
    supportiveInvestment > opportunistInvestment,
    `Risk-heavy genomes should commit less energy than nurturing lineages (supportive=${supportiveInvestment}, opportunist=${opportunistInvestment})`,
  );
});

test("efficient gestation nudges investment upward even with similar parental genes", () => {
  const balanced = createGenome({
    PARENTAL: 160,
    FERTILITY: 160,
    ENERGY_EFFICIENCY: 120,
    GESTATION_EFFICIENCY: 120,
    RISK: 140,
  });
  const thrifty = createGenome({
    PARENTAL: 160,
    FERTILITY: 160,
    ENERGY_EFFICIENCY: 220,
    GESTATION_EFFICIENCY: 220,
    RISK: 60,
  });

  const balancedInvestment = balanced.parentalInvestmentFrac();
  const thriftyInvestment = thrifty.parentalInvestmentFrac();

  assert.ok(
    thriftyInvestment > balancedInvestment,
    `Higher efficiency and gestation genes should encourage bigger energy transfers (balanced=${balancedInvestment}, thrifty=${thriftyInvestment})`,
  );
  assert.ok(
    thriftyInvestment <= 0.82,
    `Investment must remain within the capped range (received ${thriftyInvestment})`,
  );
});
