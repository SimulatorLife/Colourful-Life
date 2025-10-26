import { assert, test } from "#tests/harness";

import { resolvePopulationScarcityMultiplier } from "../src/grid/populationScarcity.js";
import Cell from "../src/cell.js";
import DNA, { GENE_LOCI } from "../src/genome.js";
import { MAX_TILE_ENERGY } from "../src/config.js";
import { clamp01 } from "../src/utils/math.js";

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

test("population scarcity multiplier rewards complementary pairings", () => {
  const supportiveDNA = buildDNA({ fertility: 0.9, parental: 0.85, cohesion: 0.8 });
  const opportunistDNA = buildDNA({ fertility: 0.6, exploration: 0.95, risk: 0.85 });

  const supportive = new Cell(0, 0, supportiveDNA, MAX_TILE_ENERGY);
  const opportunist = new Cell(0, 1, opportunistDNA, MAX_TILE_ENERGY);

  const scarcity = 0.7;
  const baseProbability = 0.32;
  const population = 8;
  const minPopulation = 24;

  const homogeneous = resolvePopulationScarcityMultiplier({
    parentA: supportive,
    parentB: supportive,
    scarcity,
    baseProbability,
    population,
    minPopulation,
  });

  const complementary = resolvePopulationScarcityMultiplier({
    parentA: supportive,
    parentB: opportunist,
    scarcity,
    baseProbability,
    population,
    minPopulation,
  });

  assert.ok(
    complementary.multiplier > homogeneous.multiplier,
    `complementary partners should receive a stronger scarcity lift (complementary=${complementary.multiplier}, homogeneous=${homogeneous.multiplier})`,
  );
});
