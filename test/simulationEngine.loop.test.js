import { test } from "uvu";
import * as assert from "uvu/assert";

import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from "./helpers/simulationEngine.js";

test("start schedules a frame and ticking through RAF uses sanitized defaults", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore, calls, snapshot } = patchSimulationPrototypes(modules);

  try {
    let rafCallback = null;
    let rafHandle = 0;

    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: (cb) => {
        rafCallback = cb;
        rafHandle += 1;

        return rafHandle;
      },
      cancelAnimationFrame: () => {},
    });

    assert.is(rafCallback, null, "no frame scheduled before start");

    engine.start();

    assert.type(rafCallback, "function", "start schedules the next frame");

    const updateCallsBefore = calls.grid.update.length;

    rafCallback(1000);
    assert.ok(
      calls.grid.update.length > updateCallsBefore,
      "grid.update invoked after RAF callback",
    );

    const updateArgs = calls.grid.update.at(-1)[0];

    assert.equal(updateArgs, {
      densityEffectMultiplier: 1,
      societySimilarity: 0.7,
      enemySimilarity: 0.4,
      eventStrengthMultiplier: 1,
      energyRegenRate: 0.0082,
      energyDiffusionRate: 0.05,
      mutationMultiplier: 1,
      matingDiversityThreshold: 0.45,
      lowDiversityReproMultiplier: 0.12,
      combatEdgeSharpness: 3.2,
    });

    assert.is(engine.lastSnapshot, snapshot, "snapshot from update stored on engine");
    assert.ok(calls.stats.resetTick.length > 0, "stats.resetTick invoked during tick");

    const manualTickResult = engine.tick(2000);

    assert.ok(manualTickResult, "manual tick returns true when interval satisfied");

    engine.stop();
  } finally {
    restore();
  }
});

test("tick emits events and clears pending slow UI updates after throttle interval", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore, snapshot, metrics } = patchSimulationPrototypes(modules);

  try {
    let now = 0;
    const engine = new SimulationEngine({
      canvas: new MockCanvas(24, 24),
      autoStart: false,
      performanceNow: () => now,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
    });

    const tickEvents = [];
    const metricsEvents = [];
    const leaderboardEvents = [];

    engine.on("tick", (payload) => tickEvents.push(payload));
    engine.on("metrics", (payload) => metricsEvents.push(payload));
    engine.on("leaderboard", (payload) => leaderboardEvents.push(payload));

    now = 1000;
    const result = engine.tick(now);

    assert.ok(result, "tick returns true when enough time has elapsed");
    assert.is(tickEvents.length, 1, "tick event emitted once");
    assert.is(tickEvents[0].snapshot, snapshot, "tick event includes snapshot");
    assert.is(tickEvents[0].metrics, metrics, "tick event includes metrics");
    assert.is(tickEvents[0].timestamp, now, "tick event includes timestamp");

    assert.is(metricsEvents.length, 1, "metrics event emitted once");
    assert.is(metricsEvents[0].metrics, metrics, "metrics event payload matches");
    assert.is(
      metricsEvents[0].stats,
      engine.stats,
      "metrics event returns stats instance",
    );
    assert.ok(
      metricsEvents[0].environment,
      "metrics event includes environment summary",
    );
    assert.is(
      metricsEvents[0].environment.updatesPerSecond,
      60,
      "environment reports tick rate",
    );
    assert.is(
      metricsEvents[0].environment.eventStrengthMultiplier,
      1,
      "environment reports strength multiplier",
    );
    assert.ok(
      Array.isArray(metricsEvents[0].environment.activeEvents),
      "environment summary provides active events list",
    );
    assert.ok(
      metricsEvents[0].environment.activeEvents.length >= 1,
      "environment summary includes at least one active event",
    );
    const eventSummary = metricsEvents[0].environment.activeEvents[0];

    assert.is(eventSummary.type, "flood", "active event type captured");
    assert.ok(eventSummary.remainingTicks > 0, "remaining ticks preserved as positive");
    assert.ok(
      eventSummary.durationTicks >= eventSummary.remainingTicks,
      "duration ticks capture full span",
    );
    assert.is(eventSummary.coverageTiles, 12, "coverage tiles computed");
    const expectedCoverageRatio = 12 / (engine.rows * engine.cols);

    assert.ok(
      Math.abs(eventSummary.coverageRatio - expectedCoverageRatio) < 1e-6,
      "coverage ratio normalized by grid size",
    );
    assert.ok(
      Number.isFinite(eventSummary.remainingSeconds) &&
        eventSummary.remainingSeconds > 0,
      "remaining seconds derived from tick rate",
    );

    assert.is(leaderboardEvents.length, 1, "leaderboard event emitted once");
    assert.equal(leaderboardEvents[0].entries, [
      {
        row: 0,
        col: 0,
        fitness: 1,
        offspring: 3,
        fightsWon: 4,
        age: 5,
        color: "#123456",
      },
    ]);

    assert.is(
      engine.pendingSlowUiUpdate,
      false,
      "pendingSlowUiUpdate cleared after emissions",
    );
  } finally {
    restore();
  }
});

test("updateSetting speedMultiplier and low diversity multiplier propagate changes", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore, calls } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(18, 18),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
    });

    engine.updateSetting("speedMultiplier", 2);
    assert.is(
      engine.state.updatesPerSecond,
      120,
      "speedMultiplier adjusts updatesPerSecond",
    );
    assert.ok(engine.pendingSlowUiUpdate, "speedMultiplier marks pendingSlowUiUpdate");

    const stateEvents = [];
    const initialThreshold = engine.state.matingDiversityThreshold;

    engine.on("state", (payload) => stateEvents.push(payload));

    engine.setLowDiversityReproMultiplier(0.42);

    const diversityCalls = calls.grid.setMatingDiversityOptions;

    assert.ok(
      diversityCalls.length >= 2,
      "setMatingDiversityOptions called at least twice (initial + manual)",
    );
    assert.equal(
      diversityCalls.at(-1),
      [
        {
          threshold: initialThreshold,
          lowDiversityMultiplier: 0.42,
        },
      ],
      "grid receives updated low diversity multiplier",
    );

    assert.ok(stateEvents.length >= 1, "state event emitted");
    const lastEvent = stateEvents.at(-1);

    assert.is(
      lastEvent.changes.lowDiversityReproMultiplier,
      0.42,
      "state change includes low diversity multiplier",
    );
    assert.is(
      lastEvent.state.lowDiversityReproMultiplier,
      0.42,
      "state snapshot reflects low diversity multiplier",
    );
    assert.is(
      engine.state.lowDiversityReproMultiplier,
      0.42,
      "engine stores new low diversity multiplier",
    );
  } finally {
    restore();
  }
});

test("tick forwards instance maxTileEnergy to overlay renderer", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine, GridManager } = modules;
  const { restore } = patchSimulationPrototypes(modules);
  const originalMax = GridManager.maxTileEnergy;

  try {
    const recorded = [];
    const engine = new SimulationEngine({
      canvas: new MockCanvas(16, 16),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      drawOverlays: (...args) => {
        const [, , , options] = args;

        recorded.push(options?.maxTileEnergy);
      },
    });

    const customMax = originalMax * 3;

    engine.grid.maxTileEnergy = customMax;
    GridManager.maxTileEnergy = originalMax;

    engine.tick(0);

    assert.ok(recorded.length >= 1, "drawOverlays invoked at least once");
    assert.is(recorded.at(-1), customMax, "overlay receives the grid's maxTileEnergy");
  } finally {
    restore();
    GridManager.maxTileEnergy = originalMax;
  }
});

test.run();
