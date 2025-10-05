import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

if (typeof globalThis.window === "undefined") {
  globalThis.window = {};
}

test("GridManager.regenerateEnergyGrid applies event effect modifiers", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const energyCap = 6;
  const affectedArea = { x: 0, y: 0, width: 1, height: 1 };

  const floodManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    maxTileEnergy: energyCap,
  });

  floodManager.energyGrid = [[1]];
  floodManager.energyNext = [[0]];
  floodManager.regenerateEnergyGrid(
    [{ eventType: "flood", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(floodManager.energyGrid[0][0], energyCap);

  const droughtManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    maxTileEnergy: energyCap,
  });

  droughtManager.energyGrid = [[1]];
  droughtManager.energyNext = [[0]];
  droughtManager.regenerateEnergyGrid(
    [{ eventType: "drought", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(droughtManager.energyGrid[0][0], energyCap * 0.4);
});

test("Cell.applyEventEffects uses event mapping and DNA resistance", async () => {
  const { default: Cell } = await import("../src/cell.js");

  const event = {
    eventType: "heatwave",
    strength: 1,
    affectedArea: { x: 0, y: 0, width: 2, height: 2 },
  };

  const cell = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0.4,
      heatResist: () => 0.3,
    },
  });

  cell.applyEventEffects(0, 0, event, 1, 5);
  approxEqual(cell.energy, 1.924, 1e-3);

  const unaffected = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0,
      heatResist: () => 0,
    },
  });

  unaffected.applyEventEffects(5, 5, event, 1, 5);
  assert.is(unaffected.energy, 2);
});

test("Cell.applyEventEffects imprints neural anticipation when brain plasticity is active", async () => {
  const { default: Cell } = await import("../src/cell.js");

  const imprintCalls = [];
  const feedbackCalls = [];
  const anticipationProfile = {
    assimilation: 0.6,
    relief: 0.2,
    gainInfluence: 0.4,
    volatility: 0.7,
    fatigueWeight: 0.45,
    rewardScale: 0.8,
    baseline: 0.25,
  };
  const responseProfile = {
    drainMitigation: 0.15,
    vigilance: 0.9,
    pressureRetention: 0.7,
    rebound: 0.25,
  };

  const cell = Object.assign(Object.create(Cell.prototype), {
    energy: 3,
    dna: {
      recoveryRate: () => 0.2,
      heatResist: () => 0,
      eventAnticipationProfile: () => anticipationProfile,
      eventResponseProfile: () => responseProfile,
    },
    lastEventPressure: 0.1,
    eventAnticipationProfile: anticipationProfile,
    neuralFatigueProfile: { baseline: 0.3 },
    _resourceSignal: -0.2,
    _neuralFatigue: 0.4,
    brain: {
      applyExperienceImprint: (payload) => imprintCalls.push(payload),
      applySensorFeedback: (payload) => feedbackCalls.push(payload),
      lastActivationCount: 4,
    },
  });

  const event = {
    eventType: "heatwave",
    strength: 1,
    affectedArea: { x: 0, y: 0, width: 2, height: 2 },
  };

  cell.applyEventEffects(0, 0, event, 1, 5);

  assert.ok(imprintCalls.length > 0, "expected event imprint call");
  assert.ok(
    imprintCalls[0]?.adjustments?.some((entry) => entry.sensor === "eventPressure"),
    "expected event pressure adjustment",
  );
  assert.ok(feedbackCalls.length > 0, "expected sensor feedback call");
  assert.ok(feedbackCalls[0]?.energyCost > 0, "feedback should reflect energy loss");
});
