import { assert, test } from "#tests/harness";

import { resolvePopulationScarcityMultiplier } from "../src/grid/populationScarcity.js";
import Cell from "../src/cell.js";
import DNA, { GENE_LOCI } from "../src/genome.js";
import { MAX_TILE_ENERGY } from "../src/config.js";

function buildDNA({
  fertility = 0.5,
  parental = 0.5,
  cohesion = 0.5,
  exploration = 0.5,
  risk = 0.5,
}) {
  const dna = DNA.random(() => 0);

  dna.genes[GENE_LOCI.FERTILITY] = Math.round(clamp01(fertility) * 255);
  dna.genes[GENE_LOCI.PARENTAL] = Math.round(clamp01(parental) * 255);
  dna.genes[GENE_LOCI.COHESION] = Math.round(clamp01(cohesion) * 255);
  dna.genes[GENE_LOCI.EXPLORATION] = Math.round(clamp01(exploration) * 255);
  dna.genes[GENE_LOCI.RISK] = Math.round(clamp01(risk) * 255);

  return dna;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;

  return Math.max(0, Math.min(1, value));
}

test("population scarcity multiplier grows with fertile cooperative genomes", () => {
  const supportiveDNA = buildDNA({
    fertility: 0.95,
    parental: 0.9,
    cohesion: 0.85,
    exploration: 0.7,
    risk: 0.9,
  });
  const cautiousDNA = buildDNA({
    fertility: 0.1,
    parental: 0.15,
    cohesion: 0.1,
    exploration: 0.05,
    risk: 0.1,
  });

  const supportiveA = new Cell(0, 0, supportiveDNA, MAX_TILE_ENERGY);
  const supportiveB = new Cell(0, 1, supportiveDNA, MAX_TILE_ENERGY);
  const cautiousA = new Cell(1, 0, cautiousDNA, MAX_TILE_ENERGY);
  const cautiousB = new Cell(1, 1, cautiousDNA, MAX_TILE_ENERGY);

  const scarcity = 0.8;
  const baseProbability = 0.28;
  const population = 6;
  const minPopulation = 24;

  const supportiveResult = resolvePopulationScarcityMultiplier({
    parentA: supportiveA,
    parentB: supportiveB,
    scarcity,
    baseProbability,
    population,
    minPopulation,
  });
  const cautiousResult = resolvePopulationScarcityMultiplier({
    parentA: cautiousA,
    parentB: cautiousB,
    scarcity,
    baseProbability,
    population,
    minPopulation,
  });
  const neutralResult = resolvePopulationScarcityMultiplier({
    parentA: supportiveA,
    parentB: supportiveB,
    scarcity: 0,
    baseProbability,
    population,
    minPopulation,
  });

  assert.ok(
    supportiveResult.multiplier > cautiousResult.multiplier,
    `supportive genomes should respond more strongly to scarcity (supportive=${supportiveResult.multiplier}, cautious=${cautiousResult.multiplier})`,
  );
  assert.ok(
    supportiveResult.multiplier > 1,
    `scarcity should raise reproduction odds for fertile partners (received ${supportiveResult.multiplier})`,
  );
  assert.is(
    neutralResult.multiplier,
    1,
    "absent scarcity the multiplier should remain neutral",
  );
});
