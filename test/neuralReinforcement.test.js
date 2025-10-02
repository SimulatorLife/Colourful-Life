import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

let Cell;
let DNA;
let GENE_LOCI;
let Brain;

const originalRandom = Math.random;

test.before(async () => {
  ({ default: Cell } = await import("../src/cell.js"));
  ({ DNA, GENE_LOCI } = await import("../src/genome.js"));
  ({ default: Brain } = await import("../src/brain.js"));
});

test.after.each(() => {
  Math.random = originalRandom;
});

test("DNA neural reinforcement profile is deterministic and bounded", () => {
  const dna = new DNA(90, 60, 40);

  dna.genes[GENE_LOCI.MOVEMENT] = 12;
  dna.genes[GENE_LOCI.RISK] = 8;
  dna.genes[GENE_LOCI.RECOVERY] = 180;
  dna.genes[GENE_LOCI.COOPERATION] = 210;
  dna.genes[GENE_LOCI.COMBAT] = 70;
  dna.genes[GENE_LOCI.FERTILITY] = 190;
  dna.genes[GENE_LOCI.PARENTAL] = 220;
  dna.genes[GENE_LOCI.STRATEGY] = 120;
  dna.genes[GENE_LOCI.ACTIVITY] = 30;
  dna.genes[GENE_LOCI.COHESION] = 200;

  const profileA = dna.neuralReinforcementProfile();
  const profileB = dna.neuralReinforcementProfile();

  assert.ok(profileA, "profile should be produced");
  assert.ok(profileB, "repeated calls should be stable");
  approxEqual(profileA.energyDeltaWeight, profileB.energyDeltaWeight, 1e-12);
  approxEqual(profileA.cognitiveCostWeight, profileB.cognitiveCostWeight, 1e-12);
  approxEqual(profileA.fatigueReliefWeight, profileB.fatigueReliefWeight, 1e-12);
  approxEqual(profileA.restBoostWeight, profileB.restBoostWeight, 1e-12);
  approxEqual(profileA.reproductionWeight, profileB.reproductionWeight, 1e-12);
  approxEqual(
    profileA.targetingAlignmentWeight,
    profileB.targetingAlignmentWeight,
    1e-12,
  );

  assert.ok(profileA.energyDeltaWeight >= 0.1 && profileA.energyDeltaWeight <= 1.25);
  assert.ok(
    profileA.cognitiveCostWeight >= 0.08 && profileA.cognitiveCostWeight <= 1.15,
  );
  assert.ok(profileA.fatigueReliefWeight >= 0.1 && profileA.fatigueReliefWeight <= 1.2);
  assert.ok(profileA.restBoostWeight >= 0.05 && profileA.restBoostWeight <= 1.1);
  assert.ok(profileA.reproductionWeight >= 0.05 && profileA.reproductionWeight <= 1.1);

  const movement = profileA.movementActions;
  const interaction = profileA.interactionActions;
  const targeting = profileA.targetingFocus;

  assert.ok(movement);
  assert.ok(interaction);
  assert.ok(targeting);
  for (const value of Object.values(movement)) {
    assert.ok(value >= 0 && value <= 1, "movement preferences should be normalized");
  }
  for (const value of Object.values(interaction)) {
    assert.ok(value >= 0 && value <= 1, "interaction preferences should be normalized");
  }
  for (const value of Object.values(targeting)) {
    assert.ok(value >= 0 && value <= 1, "targeting focus should be normalized");
  }
});

function createMovementBrain({
  restScore,
  pursueScore,
  avoidScore = -6,
  cohereScore = -6,
  exploreScore = -6,
  sensorEnergy = 0.5,
}) {
  const sensorVector = new Array(Brain.SENSOR_COUNT).fill(0);

  sensorVector[0] = 1;
  const energyIndex = Brain.sensorIndex("energy");

  if (Number.isFinite(energyIndex) && energyIndex > 0) {
    sensorVector[energyIndex] = sensorEnergy;
  }

  return {
    connectionCount: 1,
    evaluateGroup(group) {
      if (group !== "movement") return null;

      return {
        values: {
          rest: restScore,
          pursue: pursueScore,
          avoid: avoidScore,
          cohere: cohereScore,
          explore: exploreScore,
        },
        activationCount: 3,
        sensors: sensorVector,
      };
    },
    applySensorFeedback() {},
  };
}

test("cells derive reward signals from DNA reinforcement preferences", () => {
  const dna = new DNA(120, 150, 200);

  dna.genes[GENE_LOCI.MOVEMENT] = 10;
  dna.genes[GENE_LOCI.RISK] = 0;
  dna.genes[GENE_LOCI.RECOVERY] = 220;
  dna.genes[GENE_LOCI.COOPERATION] = 200;
  dna.genes[GENE_LOCI.COHESION] = 220;
  dna.genes[GENE_LOCI.FERTILITY] = 160;
  dna.genes[GENE_LOCI.PARENTAL] = 210;

  const restCell = new Cell(0, 0, dna, 6);
  const restCalls = [];

  restCell.brain = createMovementBrain({ restScore: 6, pursueScore: -6 });
  restCell.brain.applySensorFeedback = (payload) => restCalls.push(payload);

  Math.random = () => 0;
  restCell.executeMovementStrategy([], 0, 0, [], [], [], {
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    moveRandomly: () => {},
  });
  Math.random = originalRandom;

  restCell.manageEnergy(0, 0, {
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    maxTileEnergy: 10,
  });

  assert.ok(restCalls.length > 0, "rest scenario should trigger feedback");
  const restReward = restCalls[0]?.rewardSignal;

  assert.ok(Number.isFinite(restReward), "rest reward should be numeric");
  assert.ok(restReward > 0, "rest preference should produce a positive reward");

  const pursueCell = new Cell(0, 0, dna, 6);
  const pursueCalls = [];

  pursueCell.brain = createMovementBrain({
    restScore: -6,
    pursueScore: 6,
    sensorEnergy: 0.2,
  });
  pursueCell.brain.applySensorFeedback = (payload) => pursueCalls.push(payload);

  const enemy = {
    row: 0,
    col: 1,
    target: { row: 0, col: 1, energy: 8, age: 1, lifespan: 5 },
  };

  Math.random = () => 0.6;
  pursueCell.executeMovementStrategy([], 0, 0, [], [enemy], [], {
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    moveRandomly: () => {},
    moveToTarget: () => {},
    getEnergyAt: () => 0,
    rows: 5,
    cols: 5,
  });
  Math.random = originalRandom;

  pursueCell.manageEnergy(0, 0, {
    localDensity: 0.25,
    densityEffectMultiplier: 1,
    maxTileEnergy: 10,
  });

  assert.ok(pursueCalls.length > 0, "pursue scenario should trigger feedback");
  const pursueReward = pursueCalls[0]?.rewardSignal;

  assert.ok(Number.isFinite(pursueReward), "pursue reward should be numeric");
  assert.ok(
    restReward > pursueReward,
    "rest-aligned preference should produce a stronger reward than pursuit",
  );
});
