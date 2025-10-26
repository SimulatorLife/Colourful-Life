import { assert, test } from "#tests/harness";
import Brain from "../src/brain.js";

function assertCloseTo(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("Brain.evaluateGroup applies sensor modulation and produces trace snapshots", () => {
  const energyIndex = Brain.sensorIndex("energy");
  const baselineGains = Array.from({ length: Brain.SENSOR_COUNT }, (_, index) =>
    index === energyIndex ? 1.5 : 1,
  );
  const brain = new Brain({
    genes: [
      { sourceId: energyIndex, targetId: 192, weight: 1.2, activationType: 0 },
      { sourceId: energyIndex, targetId: 193, weight: -0.6, activationType: 3 },
    ],
    sensorModulation: {
      baselineGains,
      gainLimits: { min: 0.5, max: 2 },
    },
  });

  const evaluation = brain.evaluateGroup(
    "movement",
    { energy: 0.4, enemyFraction: 0.9 },
    { trace: true },
  );

  const modulatedEnergy = 0.4 * 1.5;

  assertCloseTo(evaluation.sensors[energyIndex], modulatedEnergy);
  assert.is(evaluation.activationCount, 2);

  const expectedRest = modulatedEnergy * 1.2;

  assertCloseTo(evaluation.values.rest, expectedRest);
  assert.is(evaluation.values.pursue, 0);
  assert.is(evaluation.values.avoid, 0);
  assert.is(evaluation.values.cohere, 0);
  assert.is(evaluation.values.explore, 0);
  assert.ok(
    evaluation.trace.sensors.some(
      (sensor) =>
        sensor.key === "energy" && Math.abs(sensor.value - modulatedEnergy) <= 1e-6,
    ),
  );

  const restTrace = evaluation.trace.nodes.find((node) => node.id === 192);
  const pursueTrace = evaluation.trace.nodes.find((node) => node.id === 193);

  assert.ok(restTrace);
  assert.ok(pursueTrace);
  assertCloseTo(restTrace.output, expectedRest);
  assertCloseTo(pursueTrace.output, 0);
  assertCloseTo(brain.lastEvaluation.outputs.rest, expectedRest);

  restTrace.output = 99;

  assert.ok(
    brain.lastEvaluation.trace.nodes.find((node) => node.id === 192).output !== 99,
  );
});

test("Brain.applySensorFeedback adjusts experience targets and gains for positive and negative signals", () => {
  const energyIndex = Brain.sensorIndex("energy");
  const densityIndex = Brain.sensorIndex("effectiveDensity");
  const baselineGains = Array.from({ length: Brain.SENSOR_COUNT }, () => 1);
  const targets = Array.from({ length: Brain.SENSOR_COUNT }, () => Number.NaN);

  targets[energyIndex] = 0.15;
  targets[densityIndex] = -0.4;

  const brain = new Brain({
    sensorModulation: {
      baselineGains,
      targets,
      gainLimits: { min: 0.5, max: 2 },
      adaptationRate: 0,
      reversionRate: 0,
    },
    plasticityProfile: {
      learningRate: 0.3,
      rewardSensitivity: 1.1,
      punishmentSensitivity: 1,
      retention: 0.4,
      volatility: 0.6,
      fatigueWeight: 0.3,
      costWeight: 0.2,
    },
  });

  const initialEnergyGain = brain.sensorGains[energyIndex];
  const initialDensityGain = brain.sensorGains[densityIndex];

  const positiveSensors = new Float32Array(Brain.SENSOR_COUNT);

  positiveSensors[0] = 1;
  positiveSensors[energyIndex] = 0.6;
  positiveSensors[densityIndex] = -0.3;

  brain.applySensorFeedback({
    sensorVector: positiveSensors,
    activationCount: 6,
    energyCost: 0.4,
    fatigueDelta: 0.2,
    rewardSignal: 1.3,
    maxTileEnergy: 2,
  });

  const positiveExperienceEnergy = brain.sensorExperienceTargets[energyIndex];

  assert.ok(Number.isFinite(positiveExperienceEnergy));
  assert.ok(positiveExperienceEnergy > targets[energyIndex]);
  assert.ok(brain.sensorGains[energyIndex] > initialEnergyGain);
  assert.ok(brain.sensorGains[densityIndex] > initialDensityGain);

  const previousExperienceEnergy = brain.sensorExperienceTargets[energyIndex];
  const previousExperienceDensity = brain.sensorExperienceTargets[densityIndex];
  const previousGainEnergy = brain.sensorGains[energyIndex];
  const previousGainDensity = brain.sensorGains[densityIndex];

  const negativeSensors = new Float32Array(Brain.SENSOR_COUNT);

  negativeSensors[0] = 1;
  negativeSensors[energyIndex] = 0.05;
  negativeSensors[densityIndex] = -0.9;

  brain.applySensorFeedback({
    sensorVector: negativeSensors,
    activationCount: 2,
    energyCost: 3,
    fatigueDelta: 0.8,
    rewardSignal: -0.9,
    maxTileEnergy: 1,
  });

  assert.ok(brain.sensorExperienceTargets[energyIndex] < previousExperienceEnergy);
  assert.ok(
    Math.abs(brain.sensorExperienceTargets[densityIndex]) <
      Math.abs(previousExperienceDensity),
  );
  assert.ok(brain.sensorGains[energyIndex] <= previousGainEnergy);
  assert.ok(brain.sensorGains[densityIndex] <= previousGainDensity);
});

test("Brain.applyExperienceImprint blends adjustments using sensor keys and clamps gains", () => {
  const energyIndex = Brain.sensorIndex("energy");
  const densityIndex = Brain.sensorIndex("effectiveDensity");
  const threatIndex = Brain.sensorIndex("targetThreat");
  const baselineGains = Array.from({ length: Brain.SENSOR_COUNT }, () => 1);
  const targets = Array.from({ length: Brain.SENSOR_COUNT }, () => 0);

  const brain = new Brain({
    sensorModulation: {
      baselineGains,
      targets,
      gainLimits: { min: 0.5, max: 2 },
      adaptationRate: 0,
      reversionRate: 0,
    },
    plasticityProfile: {
      learningRate: 0.25,
      rewardSensitivity: 1,
      punishmentSensitivity: 0.5,
      retention: 0.3,
      volatility: 0.5,
      fatigueWeight: 0,
      costWeight: 0,
    },
  });

  brain.sensorExperienceTargets[energyIndex] = 0.2;
  brain.sensorExperienceTargets[densityIndex] = -0.4;
  brain.sensorExperienceTargets[threatIndex] = -0.1;
  brain.sensorGains[energyIndex] = 1.1;
  brain.sensorGains[threatIndex] = 0.8;

  brain.applyExperienceImprint({
    adjustments: [
      {
        sensor: "energy",
        target: 0.8,
        assimilation: 0.6,
        gainInfluence: 0.5,
        gainShift: 0.2,
      },
      {
        key: "targetThreat",
        gainTarget: 1.5,
        gainBlend: 0.8,
        assimilation: 0.4,
      },
      {
        index: densityIndex,
        target: -0.9,
        assimilation: 0,
      },
    ],
    assimilation: 0.3,
    gainInfluence: 0.2,
  });

  const expectedEnergyExperience = 0.2 + (0.8 - 0.2) * 0.6;
  const expectedEnergyGain = 1.1 + (1.3 - 1.1) * (0.6 * 0.5);
  const expectedThreatGain = 0.8 + (1.5 - 0.8) * (0.4 * 0.8);

  assertCloseTo(
    brain.sensorExperienceTargets[energyIndex],
    expectedEnergyExperience,
    1e-5,
  );
  assertCloseTo(brain.sensorGains[energyIndex], expectedEnergyGain, 1e-5);
  assertCloseTo(brain.sensorGains[threatIndex], expectedThreatGain, 1e-5);
  assertCloseTo(brain.sensorExperienceTargets[densityIndex], -0.4, 1e-6);
  assertCloseTo(brain.sensorExperienceTargets[threatIndex], -0.1, 1e-6);
});
