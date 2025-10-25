import { assert, test } from "#tests/harness";

import Cell from "../src/cell.js";
import DNA, { GENE_LOCI } from "../src/genome.js";
import { MAX_TILE_ENERGY, OFFSPRING_VIABILITY_BUFFER } from "../src/config.js";

test("offspring viability buffer tracks parental caution genes", () => {
  const cautiousDNA = new DNA(0, 0, 0);

  cautiousDNA.genes[GENE_LOCI.PARENTAL] = 255;
  cautiousDNA.genes[GENE_LOCI.RISK] = 0;
  cautiousDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 0;
  cautiousDNA.genes[GENE_LOCI.GESTATION_EFFICIENCY] = 0;
  cautiousDNA.genes[GENE_LOCI.RECOVERY] = 0;

  const boldDNA = new DNA(0, 0, 0);

  boldDNA.genes[GENE_LOCI.PARENTAL] = 0;
  boldDNA.genes[GENE_LOCI.RISK] = 255;
  boldDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 255;
  boldDNA.genes[GENE_LOCI.GESTATION_EFFICIENCY] = 255;
  boldDNA.genes[GENE_LOCI.RECOVERY] = 255;

  const cautiousBuffer = cautiousDNA.offspringViabilityBuffer();
  const boldBuffer = boldDNA.offspringViabilityBuffer();

  assert.ok(
    cautiousBuffer > boldBuffer,
    `Protective genomes should demand more surplus energy (cautious=${cautiousBuffer}, bold=${boldBuffer})`,
  );
  assert.ok(
    cautiousBuffer >= 1 && cautiousBuffer <= 2,
    `Viability buffer must remain within the allowed bounds (received ${cautiousBuffer})`,
  );
  assert.ok(
    boldBuffer >= 1 && boldBuffer <= 2,
    `Viability buffer must remain within the allowed bounds (received ${boldBuffer})`,
  );
});

function createParent({ viabilityBuffer, energy = 0.55 }) {
  const dna = new DNA(0, 0, 0);

  dna.offspringEnergyDemandFrac = () => 0.3;
  dna.offspringEnergyTransferEfficiency = () => 0.9;
  dna.parentalInvestmentFrac = () => 0.5;
  dna.mutationChance = () => 0;
  dna.mutationRange = () => 0;
  dna.reproduceWith = (other) => other ?? dna;
  dna.offspringViabilityBuffer = () => viabilityBuffer;

  const parent = new Cell(0, 0, dna, energy);

  parent.starvationThreshold = () => 0;

  return parent;
}

test("parents respect the stricter viability temperament when breeding", () => {
  const cautious = createParent({ viabilityBuffer: 1.75 });
  const protectiveMate = createParent({ viabilityBuffer: 1.75 });

  const permissive = createParent({ viabilityBuffer: 1.02 });
  const permissiveMate = createParent({ viabilityBuffer: 1.02 });

  const cautiousResult = Cell.breed(cautious, protectiveMate, 1, {
    maxTileEnergy: MAX_TILE_ENERGY,
  });

  assert.is(
    cautiousResult,
    null,
    "Protective parents should decline when their viability buffer exceeds available energy",
  );

  const permissiveResult = Cell.breed(permissive, permissiveMate, 1, {
    maxTileEnergy: MAX_TILE_ENERGY,
  });

  assert.instance(
    permissiveResult,
    Cell,
    "Permissive parents with identical energy should succeed when their viability buffer is low",
  );

  assert.ok(
    cautious.dna.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER) >
      permissive.dna.offspringViabilityBuffer(OFFSPRING_VIABILITY_BUFFER),
    "The test genomes must disagree on their viability temperament",
  );
});
