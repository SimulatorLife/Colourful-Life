import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

let Cell;
let DNA;
let GENE_LOCI;
let OUTPUT_GROUPS;
let NEURAL_GENE_BYTES;
let clamp;

function setNeuralGene(
  dna,
  index,
  { source = 0, target = 0, weight = 0, activation = 2, enabled = true } = {},
) {
  assert.ok(dna, "DNA instance required");
  const count = dna.neuralGeneCount();

  assert.ok(count > 0, "DNA must reserve neural gene slots");
  assert.ok(index >= 0 && index < count, "neural gene index out of range");

  const baseOffset = dna.genes.length - count * NEURAL_GENE_BYTES;
  const offset = baseOffset + index * NEURAL_GENE_BYTES;
  const clampedWeight = clamp(weight, -1, 1);
  const rawWeight = Math.max(
    0,
    Math.min(4095, Math.round((clampedWeight + 1) * 2047.5)),
  );
  const geneValue =
    ((source & 0xff) << 24) |
    ((target & 0xff) << 16) |
    ((rawWeight & 0xfff) << 4) |
    ((activation & 0x7) << 1) |
    (enabled ? 1 : 0);

  dna.genes[offset] = (geneValue >>> 24) & 0xff;
  dna.genes[offset + 1] = (geneValue >>> 16) & 0xff;
  dna.genes[offset + 2] = (geneValue >>> 8) & 0xff;
  dna.genes[offset + 3] = geneValue & 0xff;
}

test.before(async () => {
  ({ default: Cell } = await import("../src/cell.js"));
  ({ DNA, GENE_LOCI } = await import("../src/genome.js"));
  ({ OUTPUT_GROUPS, NEURAL_GENE_BYTES } = await import("../src/brain.js"));
  ({ clamp } = await import("../src/utils.js"));
});

test("risk memory profile is deterministic and bounded", () => {
  const dna = new DNA(120, 90, 30);

  dna.genes[GENE_LOCI.RISK] = 40;
  dna.genes[GENE_LOCI.NEURAL] = 210;
  dna.genes[GENE_LOCI.SENSE] = 200;
  dna.genes[GENE_LOCI.RECOVERY] = 150;
  dna.genes[GENE_LOCI.STRATEGY] = 180;
  dna.genes[GENE_LOCI.EXPLORATION] = 160;
  dna.genes[GENE_LOCI.COOPERATION] = 220;
  dna.genes[GENE_LOCI.COHESION] = 180;
  dna.genes[GENE_LOCI.MOVEMENT] = 140;
  dna.genes[GENE_LOCI.FORAGING] = 190;
  dna.genes[GENE_LOCI.COMBAT] = 80;
  dna.genes[GENE_LOCI.ACTIVITY] = 60;

  const profileA = dna.riskMemoryProfile();
  const profileB = dna.riskMemoryProfile();

  assert.ok(profileA, "profile should be produced");
  approxEqual(profileA.assimilation, profileB.assimilation, 1e-12);
  approxEqual(profileA.decay, profileB.decay, 1e-12);
  approxEqual(profileA.resourceWeight, profileB.resourceWeight, 1e-12);
  approxEqual(profileA.scarcityDrive, profileB.scarcityDrive, 1e-12);
  approxEqual(profileA.eventWeight, profileB.eventWeight, 1e-12);
  approxEqual(profileA.socialWeight, profileB.socialWeight, 1e-12);
  approxEqual(profileA.fatigueWeight, profileB.fatigueWeight, 1e-12);
  approxEqual(profileA.confidenceWeight, profileB.confidenceWeight, 1e-12);

  assert.ok(profileA.assimilation >= 0.04 && profileA.assimilation <= 0.6);
  assert.ok(profileA.decay >= 0.02 && profileA.decay <= 0.5);
  assert.ok(profileA.resourceWeight >= 0.1 && profileA.resourceWeight <= 0.9);
  assert.ok(profileA.scarcityDrive >= 0.1 && profileA.scarcityDrive <= 1.1);
  assert.ok(profileA.eventWeight >= 0.05 && profileA.eventWeight <= 1.2);
  assert.ok(profileA.socialWeight >= 0.05 && profileA.socialWeight <= 1);
  assert.ok(profileA.fatigueWeight >= 0.05 && profileA.fatigueWeight <= 0.9);
  assert.ok(profileA.confidenceWeight >= 0 && profileA.confidenceWeight <= 0.9);
});

test("risk memory adjusts risk tolerance after contrasting experiences", () => {
  const dna = new DNA(80, 140, 200);

  dna.genes[GENE_LOCI.RISK] = 35;
  dna.genes[GENE_LOCI.NEURAL] = 240;
  dna.genes[GENE_LOCI.SENSE] = 210;
  dna.genes[GENE_LOCI.RECOVERY] = 180;
  dna.genes[GENE_LOCI.STRATEGY] = 170;
  dna.genes[GENE_LOCI.EXPLORATION] = 160;
  dna.genes[GENE_LOCI.COOPERATION] = 220;
  dna.genes[GENE_LOCI.COHESION] = 200;
  dna.genes[GENE_LOCI.MOVEMENT] = 150;
  dna.genes[GENE_LOCI.FORAGING] = 190;
  dna.genes[GENE_LOCI.COMBAT] = 60;
  dna.genes[GENE_LOCI.ACTIVITY] = 90;

  const avoidNode = OUTPUT_GROUPS.interaction.find((entry) => entry.key === "avoid");

  assert.ok(avoidNode, "interaction outputs should include avoid");
  setNeuralGene(dna, 0, { source: 0, target: avoidNode.id, weight: 0.3 });

  const cell = new Cell(0, 0, dna, 4);
  const baseRisk = cell.getRiskTolerance();

  cell.lastEventPressure = 0.85;
  const shockContext = {
    localDensity: 0.9,
    densityEffectMultiplier: 1,
    enemies: [{ target: cell }],
    allies: [],
    maxTileEnergy: 8,
    tileEnergy: 0.1,
    tileEnergyDelta: -0.7,
  };

  for (let i = 0; i < 3; i++) {
    cell.chooseInteractionAction(shockContext);
  }

  const afterShock = cell.getRiskTolerance();

  assert.ok(
    afterShock < baseRisk,
    "event-heavy scarcity context should reduce risk tolerance",
  );

  cell.lastEventPressure = 0.1;
  const supportContext = {
    localDensity: 0.2,
    densityEffectMultiplier: 1,
    enemies: [],
    allies: [{ target: cell }],
    maxTileEnergy: 8,
    tileEnergy: 0.9,
    tileEnergyDelta: 0.55,
  };

  for (let i = 0; i < 3; i++) {
    cell.chooseInteractionAction(supportContext);
  }

  const afterSupport = cell.getRiskTolerance();

  assert.ok(
    afterSupport > afterShock,
    "resource recovery and ally support should restore risk tolerance",
  );
});
