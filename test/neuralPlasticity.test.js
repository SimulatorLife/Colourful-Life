import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

let DNA;
let GENE_LOCI;
let Brain;
let clamp;
let NEURAL_GENE_BYTES;
let OUTPUT_GROUPS;

function setNeuralGene(
  dna,
  index,
  { source = 0, target = 0, weight = 0, activation = 2, enabled = true },
) {
  assert.ok(
    typeof dna?.neuralGeneCount === "function",
    "DNA must expose neuralGeneCount",
  );
  const neuralCount = dna.neuralGeneCount();

  assert.ok(neuralCount > 0, "DNA should reserve space for neural genes");
  assert.ok(index >= 0 && index < neuralCount, "neural gene index out of range");

  const baseOffset = dna.genes.length - neuralCount * NEURAL_GENE_BYTES;
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
  ({ DNA, GENE_LOCI } = await import("../src/genome.js"));
  ({ clamp } = await import("../src/utils/math.js"));
  ({
    default: Brain,
    OUTPUT_GROUPS,
    NEURAL_GENE_BYTES,
  } = await import("../src/brain.js"));
});

test("neural plasticity nudges sensor targets using fatigue feedback", () => {
  const dna = new DNA(80, 140, 200);
  const exploreNode = OUTPUT_GROUPS.movement.find((entry) => entry.key === "explore");
  const energySensor = Brain.sensorIndex("energy");
  const fatigueSensor = Brain.sensorIndex("neuralFatigue");

  assert.ok(exploreNode, "movement outputs should include explore");
  assert.ok(Number.isFinite(energySensor), "energy sensor index should be available");
  assert.ok(Number.isFinite(fatigueSensor), "fatigue sensor index should be available");

  setNeuralGene(dna, 0, { source: 0, target: exploreNode.id, weight: 0.4 });

  const brain = Brain.fromDNA(dna);

  assert.ok(brain, "brain should instantiate for neural-enabled DNA");

  const before = brain.snapshot();
  const baseGain = before.sensorGains?.[energySensor];
  const initialLearned = before.sensorExperienceTargets?.[energySensor];
  const fallbackEnergyTarget = before.sensorTargets?.[energySensor] ?? 0;

  const sensorVector = new Array(Brain.SENSOR_COUNT).fill(0);

  sensorVector[0] = 1;
  sensorVector[energySensor] = 0.6;
  sensorVector[fatigueSensor] = 0.25;

  brain.applySensorFeedback({
    sensorVector,
    activationCount: 6,
    energyCost: 0.02,
    fatigueDelta: 0.18,
    maxTileEnergy: 8,
  });

  const afterReward = brain.snapshot();
  const learnedEnergy = afterReward.sensorExperienceTargets?.[energySensor];
  const gainAfter = afterReward.sensorGains?.[energySensor];
  const previousTarget = Number.isFinite(initialLearned)
    ? initialLearned
    : fallbackEnergyTarget;
  const distanceBeforeReward = Math.abs(previousTarget - sensorVector[energySensor]);
  const distanceAfterReward = Math.abs(learnedEnergy - sensorVector[energySensor]);

  assert.ok(
    Number.isFinite(learnedEnergy),
    "positive reward should create a learned target",
  );
  assert.ok(
    distanceAfterReward <= distanceBeforeReward + 1e-6,
    "learned target should move closer to the rewarding sensor reading",
  );
  assert.ok(
    !Number.isFinite(baseGain) ||
      (Number.isFinite(gainAfter) && gainAfter >= baseGain - 1e-6),
    "reward should not reduce sensor gain",
  );

  const negativeVector = sensorVector.slice();

  negativeVector[energySensor] = -0.4;
  brain.applySensorFeedback({
    sensorVector: negativeVector,
    activationCount: 2,
    energyCost: 0.35,
    fatigueDelta: -0.12,
    maxTileEnergy: 8,
  });

  const afterPenalty = brain.snapshot();
  const learnedPenalty = afterPenalty.sensorExperienceTargets?.[energySensor];
  const magnitudeAfterReward = Math.abs(learnedEnergy);
  const magnitudeAfterPenalty = Math.abs(learnedPenalty);

  assert.ok(Number.isFinite(learnedPenalty), "learned target should remain numeric");
  assert.ok(
    magnitudeAfterPenalty <= magnitudeAfterReward + 1e-6,
    "penalty should relax the learned emphasis toward neutral",
  );
});

test("DNA neural plasticity profile is deterministic and within expected bounds", () => {
  const dna = new DNA(120, 90, 30);

  dna.genes[GENE_LOCI.NEURAL] = 240;
  dna.genes[GENE_LOCI.RECOVERY] = 200;
  dna.genes[GENE_LOCI.RISK] = 10;
  dna.genes[GENE_LOCI.SENSE] = 220;
  dna.genes[GENE_LOCI.ACTIVITY] = 80;
  dna.genes[GENE_LOCI.STRATEGY] = 180;
  dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 160;
  dna.genes[GENE_LOCI.PARENTAL] = 190;

  const profileA = dna.neuralPlasticityProfile();
  const profileB = dna.neuralPlasticityProfile();

  assert.ok(profileA, "profile should be produced");
  assert.ok(profileB, "profile should be produced on repeated calls");
  approxEqual(profileA.learningRate, profileB.learningRate, 1e-12);
  approxEqual(profileA.rewardSensitivity, profileB.rewardSensitivity, 1e-12);
  approxEqual(profileA.punishmentSensitivity, profileB.punishmentSensitivity, 1e-12);
  approxEqual(profileA.retention, profileB.retention, 1e-12);
  approxEqual(profileA.volatility, profileB.volatility, 1e-12);
  approxEqual(profileA.fatigueWeight, profileB.fatigueWeight, 1e-12);
  approxEqual(profileA.costWeight, profileB.costWeight, 1e-12);

  assert.ok(profileA.learningRate >= 0.01 && profileA.learningRate <= 0.32);
  assert.ok(profileA.rewardSensitivity >= 0.1 && profileA.rewardSensitivity <= 1.4);
  assert.ok(
    profileA.punishmentSensitivity >= 0.1 && profileA.punishmentSensitivity <= 1.5,
  );
  assert.ok(profileA.retention >= 0.4 && profileA.retention <= 0.97);
  assert.ok(profileA.volatility >= 0.05 && profileA.volatility <= 0.75);
  assert.ok(profileA.fatigueWeight >= 0.1 && profileA.fatigueWeight <= 1.1);
  assert.ok(profileA.costWeight >= 0.1 && profileA.costWeight <= 1.4);

  const brain = Brain.fromDNA(dna);

  assert.ok(
    brain?.sensorPlasticity?.enabled,
    "brain should enable plasticity when profile is present",
  );
});

test("experience imprints blend memory into sensor targets", () => {
  const dna = new DNA(50, 140, 210);
  const exploreNode = OUTPUT_GROUPS.movement.find((entry) => entry.key === "explore");
  const resourceIndex = Brain.sensorIndex("resourceTrend");
  const energyIndex = Brain.sensorIndex("energy");

  assert.ok(exploreNode, "movement outputs should include explore");
  assert.ok(
    Number.isFinite(resourceIndex),
    "resourceTrend sensor index should resolve",
  );
  assert.ok(Number.isFinite(energyIndex), "energy sensor index should resolve");

  setNeuralGene(dna, 0, { source: 0, target: exploreNode.id, weight: 0.5 });

  const brain = Brain.fromDNA(dna);

  assert.ok(brain, "brain should instantiate for neural-enabled DNA");

  const before = brain.snapshot();
  const baseResourceTarget = before.sensorExperienceTargets?.[resourceIndex];
  const baseEnergyTarget = before.sensorExperienceTargets?.[energyIndex];
  const resourceGainBefore = before.sensorGains?.[resourceIndex];

  brain.applyExperienceImprint({
    adjustments: [
      { sensor: "resourceTrend", target: -0.6, assimilation: 0.4 },
      { sensor: "energy", target: -0.2, assimilation: 0.3 },
    ],
    gainInfluence: 0.5,
  });

  const after = brain.snapshot();
  const learnedResource = after.sensorExperienceTargets?.[resourceIndex];
  const learnedEnergy = after.sensorExperienceTargets?.[energyIndex];
  const resourceGainAfter = after.sensorGains?.[resourceIndex];
  const priorResource = Number.isFinite(baseResourceTarget)
    ? baseResourceTarget
    : (before.sensorTargets?.[resourceIndex] ?? 0);
  const priorEnergy = Number.isFinite(baseEnergyTarget)
    ? baseEnergyTarget
    : (before.sensorTargets?.[energyIndex] ?? 0);

  assert.ok(
    Number.isFinite(learnedResource),
    "imprint should create a resource target",
  );
  assert.ok(Number.isFinite(learnedEnergy), "imprint should update the energy target");
  assert.ok(
    Math.abs(learnedResource + 0.6) <= Math.abs(priorResource + 0.6) + 1e-6,
    "resource target should move toward the imprinted preference",
  );
  assert.ok(
    Math.abs(learnedEnergy + 0.2) <= Math.abs(priorEnergy + 0.2) + 1e-6,
    "energy target should drift toward the imprint",
  );
  if (Number.isFinite(resourceGainBefore)) {
    assert.ok(
      Number.isFinite(resourceGainAfter) && resourceGainAfter !== resourceGainBefore,
      "sensor gain should respond to the imprint influence",
    );
  }
});
