import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const baseArea = { x: 0, y: 0, width: 5, height: 5 };

test("accumulateEventModifiers combines overlapping event effects", async () => {
  const [{ accumulateEventModifiers }, { getEventEffect }, { isEventAffecting }] =
    await Promise.all([
      import("../src/energySystem.js"),
      import("../src/events/eventEffects.js"),
      import("../src/events/eventManager.js"),
    ]);

  const events = [
    { eventType: "drought", strength: 0.5, affectedArea: baseArea },
    { eventType: "flood", strength: 0.6, affectedArea: baseArea },
    {
      eventType: "heatwave",
      strength: 1,
      affectedArea: { x: 10, y: 10, width: 3, height: 3 },
    },
  ];

  const result = accumulateEventModifiers({
    events,
    row: 2,
    col: 2,
    eventStrengthMultiplier: 1.5,
    isEventAffecting,
    getEventEffect,
  });

  approxEqual(result.regenMultiplier, 0.475, 1e-6);
  approxEqual(result.regenAdd, 0.225, 1e-6);
  approxEqual(result.drainAdd, 0.075, 1e-6);
  assert.is(result.appliedEvents.length, 2);
  assert.equal(
    result.appliedEvents.map(({ effect }) => effect.cell?.resistanceGene),
    ["droughtResist", "floodResist"],
  );
});

test("accumulateEventModifiers respects zero strength multiplier", async () => {
  const [{ accumulateEventModifiers }] = await Promise.all([
    import("../src/energySystem.js"),
  ]);

  const result = accumulateEventModifiers({
    events: [
      {
        eventType: "storm",
        strength: 1,
        affectedArea: baseArea,
      },
    ],
    row: 0,
    col: 0,
    eventStrengthMultiplier: 0,
    isEventAffecting: () => true,
    getEventEffect: () => ({
      regenScale: { base: 1, change: 1, min: 0 },
      regenAdd: 0.5,
      drainAdd: 0.25,
    }),
  });

  assert.equal(result, {
    regenMultiplier: 1,
    regenAdd: 0,
    drainAdd: 0,
    appliedEvents: [],
  });
});

test("accumulateEventModifiers reuses provided effect cache", async () => {
  const [{ accumulateEventModifiers }] = await Promise.all([
    import("../src/energySystem.js"),
  ]);

  const effectCache = new Map();
  let resolveCount = 0;
  const getEventEffect = (type) => {
    resolveCount += 1;

    if (type === "ignored") return null;

    return { regenAdd: 0.1, drainAdd: 0.05 };
  };

  const events = [
    { eventType: "boost", strength: 1, affectedArea: baseArea },
    { eventType: "boost", strength: 0.5, affectedArea: baseArea },
    { eventType: "ignored", strength: 1, affectedArea: baseArea },
  ];

  const baseOptions = {
    events,
    row: 2,
    col: 2,
    effectCache,
    getEventEffect,
  };

  accumulateEventModifiers(baseOptions);
  accumulateEventModifiers(baseOptions);

  assert.is(resolveCount, 2);
});

test("accumulateEventModifiers reuses result buffers when skipping applied events", async () => {
  const [{ accumulateEventModifiers }] = await Promise.all([
    import("../src/energySystem.js"),
  ]);

  const resultBuffer = {
    regenMultiplier: -1,
    regenAdd: 999,
    drainAdd: 42,
    appliedEvents: ["stale"],
  };

  const baseOptions = {
    row: 1,
    col: 1,
    isEventAffecting: () => true,
    getEventEffect: () => ({
      regenScale: { base: 1, change: 0.2, min: 0.1 },
      regenAdd: 0.5,
    }),
    collectAppliedEvents: false,
    result: resultBuffer,
  };

  const firstResult = accumulateEventModifiers({
    ...baseOptions,
    events: [{ eventType: "boost", strength: 0.5, affectedArea: baseArea }],
  });

  assert.is(firstResult, resultBuffer);
  approxEqual(firstResult.regenMultiplier, 1.1, 1e-6);
  approxEqual(firstResult.regenAdd, 0.25, 1e-6);
  approxEqual(firstResult.drainAdd, 0, 1e-6);
  assert.equal(firstResult.appliedEvents, []);

  const secondResult = accumulateEventModifiers({
    ...baseOptions,
    events: [],
  });

  assert.is(secondResult, resultBuffer);
  approxEqual(secondResult.regenMultiplier, 1, 1e-6);
  approxEqual(secondResult.regenAdd, 0, 1e-6);
  approxEqual(secondResult.drainAdd, 0, 1e-6);
  assert.equal(secondResult.appliedEvents, []);
  assert.is(secondResult.appliedEvents, firstResult.appliedEvents);
});

test("computeTileEnergyUpdate applies density penalties and diffusion", async () => {
  const [
    { computeTileEnergyUpdate },
    { getEventEffect },
    { isEventAffecting },
    { REGEN_DENSITY_PENALTY },
  ] = await Promise.all([
    import("../src/energySystem.js"),
    import("../src/events/eventEffects.js"),
    import("../src/events/eventManager.js"),
    import("../src/config.js"),
  ]);

  const events = [
    { eventType: "drought", strength: 0.5, affectedArea: baseArea },
    { eventType: "flood", strength: 0.6, affectedArea: baseArea },
  ];

  const baseOptions = {
    currentEnergy: 2,
    density: 0.4,
    events,
    row: 1,
    col: 1,
    config: {
      maxTileEnergy: 5,
      regenRate: 0.5,
      diffusionRate: 0.2,
      densityEffectMultiplier: 1,
      regenDensityPenalty: REGEN_DENSITY_PENALTY,
      eventStrengthMultiplier: 1.5,
      isEventAffecting,
      getEventEffect,
    },
  };

  const scalarResult = computeTileEnergyUpdate({
    ...baseOptions,
    neighborSum: 7,
    neighborCount: 2,
  });

  approxEqual(scalarResult.nextEnergy, 2.56856, 1e-3);
  approxEqual(scalarResult.drain, 0.075, 1e-6);

  const arrayResult = computeTileEnergyUpdate({
    ...baseOptions,
    neighborEnergies: [3, 4],
  });

  approxEqual(arrayResult.nextEnergy, scalarResult.nextEnergy, 1e-6);
  approxEqual(arrayResult.drain, scalarResult.drain, 1e-6);
});

test("computeTileEnergyUpdate populates provided output object", async () => {
  const [
    { computeTileEnergyUpdate },
    { getEventEffect },
    { isEventAffecting },
    { REGEN_DENSITY_PENALTY },
  ] = await Promise.all([
    import("../src/energySystem.js"),
    import("../src/events/eventEffects.js"),
    import("../src/events/eventManager.js"),
    import("../src/config.js"),
  ]);

  const events = [{ eventType: "drought", strength: 0.75, affectedArea: baseArea }];
  const options = {
    currentEnergy: 1.5,
    density: 0.2,
    events,
    row: 0,
    col: 0,
    neighborSum: 4,
    neighborCount: 2,
    config: {
      maxTileEnergy: 5,
      regenRate: 0.35,
      diffusionRate: 0.1,
      densityEffectMultiplier: 1,
      regenDensityPenalty: REGEN_DENSITY_PENALTY,
      isEventAffecting,
      getEventEffect,
    },
  };

  const baseline = computeTileEnergyUpdate(options);
  const reusable = { nextEnergy: 0, drain: 0, appliedEvents: [] };
  const reused = computeTileEnergyUpdate(options, reusable);

  assert.is(reused, reusable);
  approxEqual(reused.nextEnergy, baseline.nextEnergy, 1e-6);
  approxEqual(reused.drain, baseline.drain, 1e-6);
  assert.equal(reused.appliedEvents, baseline.appliedEvents);
});
