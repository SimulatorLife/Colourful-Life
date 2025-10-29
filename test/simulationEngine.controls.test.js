import { assert, test } from "#tests/harness";
import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from "./helpers/simulationEngine.js";
import { LEADERBOARD_INTERVAL_MIN_MS } from "../src/config.js";

function createEngine(modules) {
  const { SimulationEngine } = modules;

  return new SimulationEngine({
    canvas: new MockCanvas(20, 20),
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
  });
}

test("SimulationEngine surfaces a helpful error when the canvas lacks getContext", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;

  assert.throws(
    () =>
      new SimulationEngine({
        canvas: { width: 10, height: 10 },
        autoStart: false,
        performanceNow: () => 0,
        requestAnimationFrame: () => 0,
        cancelAnimationFrame: () => {},
      }),
    /SimulationEngine requires a 2D canvas context\./,
    "should throw descriptive error when canvas is missing getContext",
  );
});

test("SimulationEngine disables environmental events by default", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
    });

    assert.is(
      engine.state.eventFrequencyMultiplier,
      0,
      "baseline state should keep the event frequency multiplier at zero",
    );
    assert.is(engine.eventManager.activeEvents.length, 0);
    assert.is(engine.eventManager.currentEvent, null);
  } finally {
    restore();
  }
});

test("SimulationEngine skips initial events when frequency multiplier is zero", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      config: { eventFrequencyMultiplier: 0 },
    });

    assert.is(engine.eventManager.activeEvents.length, 0);
    assert.is(engine.eventManager.currentEvent, null);
  } finally {
    restore();
  }
});

test("SimulationEngine skips initial events when maxConcurrentEvents is zero", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      config: { maxConcurrentEvents: 0 },
    });

    assert.is(engine.eventManager.activeEvents.length, 0);
    assert.is(engine.eventManager.currentEvent, null);
  } finally {
    restore();
  }
});

test("SimulationEngine forwards statsOptions to runtime services", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const engine = new SimulationEngine({
    canvas: new MockCanvas(20, 20),
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
    config: {
      statsOptions: {
        historySize: 64,
        traitResampleInterval: 200,
        diversitySampleInterval: 180,
      },
    },
  });

  try {
    assert.is(
      engine.stats.historySize,
      64,
      "stats history size should respect statsOptions override",
    );
    assert.is(
      engine.stats.traitResampleInterval,
      200,
      "trait resample interval should respect statsOptions override",
    );
    assert.is(
      engine.stats.diversitySampleInterval,
      180,
      "diversity sample interval should respect statsOptions override",
    );
  } finally {
    engine.destroy();
  }
});

test("numeric setters sanitize input, clamp values, and flag slow UI updates", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pendingSlowUiUpdate = false;
    const rounded = engine.setUpdatesPerSecond("120.7");

    assert.is(rounded, 121, "updatesPerSecond is rounded to nearest integer");
    assert.is(engine.state.updatesPerSecond, 121);
    assert.ok(
      engine.pendingSlowUiUpdate,
      "changing updatesPerSecond flags slow UI updates",
    );

    engine.pendingSlowUiUpdate = false;
    const previousEventFrequency = engine.state.eventFrequencyMultiplier;

    engine.setEventFrequencyMultiplier("not-a-number");

    assert.is(engine.state.eventFrequencyMultiplier, previousEventFrequency);
    assert.is(
      engine.pendingSlowUiUpdate,
      false,
      "fallback path does not mark slow UI updates",
    );

    engine.pendingSlowUiUpdate = false;
    engine.setEnergyRates({ regen: -5, diffusion: 0.9 });

    assert.is(engine.state.energyRegenRate, 0, "regen rate is clamped at zero");
    assert.is(
      engine.state.energyDiffusionRate,
      0.9,
      "diffusion rate accepts valid values",
    );
    assert.ok(engine.pendingSlowUiUpdate, "energy tuning triggers leaderboard refresh");

    engine.pendingSlowUiUpdate = false;
    engine.setSimilarityThresholds({ societySimilarity: 2, enemySimilarity: -1 });

    assert.is(
      engine.state.societySimilarity,
      1,
      "society similarity clamps to upper bound",
    );
    assert.is(
      engine.state.enemySimilarity,
      0,
      "enemy similarity clamps to lower bound",
    );
    assert.ok(
      engine.pendingSlowUiUpdate,
      "similarity adjustments mark slow UI updates",
    );
  } finally {
    restore();
  }
});

test("setEnergyRates clamps to the unit interval", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setEnergyRates({ regen: 5, diffusion: 2 });

    assert.is(
      engine.state.energyRegenRate,
      1,
      "regen rate should not exceed the upper bound",
    );
    assert.is(
      engine.state.energyDiffusionRate,
      1,
      "diffusion rate should not exceed the upper bound",
    );
  } finally {
    restore();
  }
});

test("setMaxConcurrentEvents floors values and schedules slow UI work", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pendingSlowUiUpdate = false;
    engine.setMaxConcurrentEvents(4.7);

    assert.is(engine.state.maxConcurrentEvents, 4);
    assert.ok(engine.pendingSlowUiUpdate, "changing concurrency flags slow UI updates");

    engine.pendingSlowUiUpdate = false;
    engine.setMaxConcurrentEvents("oops");

    assert.is(engine.state.maxConcurrentEvents, 4);
    assert.is(
      engine.pendingSlowUiUpdate,
      false,
      "invalid input retains previous concurrency without scheduling work",
    );

    engine.setMaxConcurrentEvents(-2);

    assert.is(engine.state.maxConcurrentEvents, 0);
  } finally {
    restore();
  }
});

test("setLeaderboardInterval enforces minimum throttle", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setLeaderboardInterval(50);
    assert.is(
      engine.state.leaderboardIntervalMs,
      LEADERBOARD_INTERVAL_MIN_MS,
      "values below the minimum clamp to the configured floor",
    );

    engine.setLeaderboardInterval(0);
    assert.is(engine.state.leaderboardIntervalMs, 0, "zero disables throttling");

    engine.setLeaderboardInterval(-25);
    assert.is(
      engine.state.leaderboardIntervalMs,
      0,
      "negative values fall back to the previous cadence",
    );

    const updated = engine.setLeaderboardInterval(500);

    assert.is(updated, 500, "setter returns the normalized value");
    assert.is(engine.state.leaderboardIntervalMs, 500);
  } finally {
    restore();
  }
});

test("setLifeEventFadeTicks normalizes values and updates stats", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setLifeEventFadeTicks(18.6);

    assert.is(engine.state.lifeEventFadeTicks, 19);
    assert.is(engine.stats.lifeEventFadeTicks, 19);

    engine.setLifeEventFadeTicks(0);

    assert.is(engine.state.lifeEventFadeTicks, 1);

    engine.setLifeEventFadeTicks(1500);

    assert.is(engine.state.lifeEventFadeTicks, 1000);
    assert.is(engine.stats.lifeEventFadeTicks, 1000);
  } finally {
    restore();
  }
});

test("setLifeEventLimit enforces bounds", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setLifeEventLimit(12.6);
    assert.is(engine.state.lifeEventLimit, 12);

    engine.setLifeEventLimit(-5);
    assert.is(engine.state.lifeEventLimit, 0);

    engine.setLifeEventLimit(900);
    assert.is(engine.state.lifeEventLimit, 256);
  } finally {
    restore();
  }
});

test("updateSetting routes updatesPerSecond through the setter", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pendingSlowUiUpdate = false;
    engine.updateSetting("updatesPerSecond", 180);

    assert.is(engine.state.updatesPerSecond, 180);
    assert.ok(engine.pendingSlowUiUpdate, "setter marks slow UI work pending");
  } finally {
    restore();
  }
});

test("updateSetting routes maxConcurrentEvents through the setter", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pendingSlowUiUpdate = false;
    engine.updateSetting("maxConcurrentEvents", 6.2);

    assert.is(engine.state.maxConcurrentEvents, 6);
    assert.ok(engine.pendingSlowUiUpdate, "setter marks slow UI work pending");
  } finally {
    restore();
  }
});

test("updateSetting routes lifeEventFadeTicks through the setter", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.updateSetting("lifeEventFadeTicks", 48);

    assert.is(engine.state.lifeEventFadeTicks, 48);
    assert.is(engine.stats.lifeEventFadeTicks, 48);
  } finally {
    restore();
  }
});

test("updateSetting routes lifeEventLimit through the setter", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.updateSetting("lifeEventLimit", 40.3);

    assert.is(engine.state.lifeEventLimit, 40);
  } finally {
    restore();
  }
});

test("setWorldGeometry resizes the grid and updates dependent systems", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(150, 150),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
    });

    engine.pendingSlowUiUpdate = false;

    const result = engine.setWorldGeometry({ cellSize: 6, rows: 48, cols: 72 });

    assert.is(result.cellSize, 6, "method returns the applied cell size");
    assert.is(result.rows, 48, "method returns the applied row count");
    assert.is(result.cols, 72, "method returns the applied column count");
    assert.is(engine.cellSize, 6, "engine updates its cell size");
    assert.is(engine.rows, 48, "engine updates its row count");
    assert.is(engine.cols, 72, "engine updates its column count");
    assert.is(engine.canvas.width, 6 * 72, "canvas width matches geometry");
    assert.is(engine.canvas.height, 6 * 48, "canvas height matches geometry");
    assert.is(engine.grid.rows, 48, "grid rows match geometry");
    assert.is(engine.grid.cols, 72, "grid cols match geometry");
    assert.is(engine.grid.cellSize, 6, "grid cell size updates");
    assert.is(engine.eventManager.rows, 48, "event manager rows update");
    assert.is(engine.eventManager.cols, 72, "event manager cols update");
    assert.is(engine.selectionManager.rows, 48, "selection manager rows update");
    assert.is(engine.selectionManager.cols, 72, "selection manager cols update");
    assert.ok(engine.pendingSlowUiUpdate, "geometry change schedules slow UI updates");
    assert.is(engine.state.gridRows, 48, "state snapshot includes updated row count");
    assert.is(engine.state.gridCols, 72, "state snapshot includes updated col count");
    assert.is(engine.state.cellSize, 6, "state snapshot includes updated cell size");

    const noChange = engine.setWorldGeometry({
      cellSize: "ignored",
      rows: 0,
      cols: -5,
    });

    assert.is(noChange.rows, 48, "invalid updates fall back to previous row count");
    assert.is(noChange.cols, 72, "invalid updates fall back to previous column count");
    assert.is(noChange.cellSize, 6, "invalid updates fall back to previous cell size");
  } finally {
    restore();
  }
});

test("setWorldGeometry only repopulates when reseed is requested", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;

  const engine = new SimulationEngine({
    canvas: new MockCanvas(200, 200),
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
  });

  engine.resetWorld();

  assert.is(
    engine.grid.activeCells.size,
    0,
    "baseline reset should leave the grid empty",
  );

  engine.setWorldGeometry({ rows: 50, cols: 50, reseed: false });

  assert.is(
    engine.grid.activeCells.size,
    0,
    "reseed=false should prevent new organisms when geometry changes",
  );

  engine.setWorldGeometry({ rows: 60, cols: 60, reseed: true });

  assert.ok(
    engine.grid.activeCells.size > 0,
    "reseed=true should repopulate the world after resizing",
  );

  engine.destroy?.();
});

test("setWorldGeometry treats string reseed flags as truthy", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;

  const engine = new SimulationEngine({
    canvas: new MockCanvas(200, 200),
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
  });

  engine.resetWorld();

  assert.is(engine.grid.activeCells.size, 0, "baseline reset clears the grid");

  engine.setWorldGeometry({
    rows: engine.rows,
    cols: engine.cols,
    cellSize: engine.cellSize,
    reseed: "true",
  });

  assert.ok(
    engine.grid.activeCells.size > 0,
    "string reseed flag should trigger a fresh seeding",
  );

  engine.destroy?.();
});

test("setWorldGeometry applies obstacle changes without resizing", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      rng: () => 0,
    });

    engine.grid.clearObstacles();
    engine.grid.currentObstaclePreset = "none";

    const baselineObstacles = engine.grid.obstacles.some((row) => row.some(Boolean));

    assert.is(baselineObstacles, false, "baseline grid should be obstacle free");

    const result = engine.setWorldGeometry({ obstaclePreset: "midline" });

    assert.is(
      result.rows,
      engine.rows,
      "rows remain unchanged when only preset changes",
    );
    assert.is(
      result.cols,
      engine.cols,
      "cols remain unchanged when only preset changes",
    );
    assert.is(
      engine.grid.currentObstaclePreset,
      "midline",
      "engine updates the current obstacle preset",
    );
    assert.ok(
      engine.grid.obstacles.some((row) => row.some(Boolean)),
      "applying a preset paints obstacles",
    );

    engine.grid.clearObstacles();
    engine.grid.currentObstaclePreset = "none";

    engine.setWorldGeometry({ randomizeObstacles: true });

    assert.notEqual(
      engine.grid.currentObstaclePreset,
      "none",
      "randomization selects a preset",
    );
    assert.ok(
      engine.grid.obstacles.some((row) => row.some(Boolean)),
      "randomized preset repaints obstacles",
    );
  } finally {
    restore();
  }
});

test("setWorldGeometry respects string boolean flags for obstacle randomization", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      rng: () => 0,
    });

    engine.grid.clearObstacles();
    engine.grid.currentObstaclePreset = "none";

    engine.setWorldGeometry({ randomizeObstacles: "false" });

    assert.is(
      engine.grid.currentObstaclePreset,
      "none",
      "string 'false' should not trigger random obstacle selection",
    );
    assert.is(
      engine.grid.obstacles.some((row) => row.some(Boolean)),
      false,
      "grid remains obstacle free when randomization disabled",
    );
  } finally {
    restore();
  }
});

test("resetWorld respects string boolean flags for obstacle randomization", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = new SimulationEngine({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      rng: () => 0,
    });

    engine.grid.clearObstacles();
    engine.grid.currentObstaclePreset = "none";

    engine.resetWorld({ randomizeObstacles: "false" });

    assert.is(
      engine.grid.currentObstaclePreset,
      "none",
      "string 'false' should not randomize obstacles during reset",
    );
    assert.is(
      engine.grid.obstacles.some((row) => row.some(Boolean)),
      false,
      "reset preserves obstacle-free state when randomization disabled",
    );
  } finally {
    restore();
  }
});

test("resetWorld treats string reseed flags as truthy", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;

  const engine = new SimulationEngine({
    canvas: new MockCanvas(160, 160),
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: () => {},
    cancelAnimationFrame: () => {},
  });

  engine.resetWorld();

  assert.is(engine.grid.activeCells.size, 0, "reset without reseed clears the grid");

  engine.resetWorld({ reseed: "true" });

  assert.ok(
    engine.grid.activeCells.size > 0,
    "string reseed flag should spawn a fresh population",
  );

  engine.destroy?.();
});

test("pausing stops the animation loop until work is requested", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;

  const callbacks = [];
  let nextHandle = 1;
  const raf = (cb) => {
    callbacks.push(cb);

    return nextHandle++;
  };
  const caf = () => {};

  const engine = new SimulationEngine({
    canvas: new MockCanvas(200, 200),
    autoStart: true,
    performanceNow: () => 0,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
  });

  assert.is(callbacks.length, 1, "start schedules an initial frame");

  engine.pause();

  const pausedFrame = callbacks.shift();

  pausedFrame?.(16);

  assert.is(
    callbacks.length,
    0,
    "paused loops should not enqueue another frame automatically",
  );

  engine.requestFrame();

  assert.is(
    callbacks.length,
    1,
    "manual frame requests still schedule work while paused",
  );

  const requestedFrame = callbacks.shift();

  requestedFrame?.(32);

  assert.is(
    callbacks.length,
    0,
    "requested work should render once without rearming the loop",
  );

  engine.resume();

  assert.is(callbacks.length, 1, "resuming restarts the animation loop");

  engine.destroy?.();
});

test("overlay visibility toggles mutate only requested flags", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pendingSlowUiUpdate = false;
    engine.setOverlayVisibility({
      showObstacles: false,
      showDensity: undefined,
      showAge: true,
      showFitness: true,
      showLifeEventMarkers: true,
    });

    assert.is(engine.state.showObstacles, false);
    assert.is(engine.state.showAge, true);
    assert.is(engine.state.showFitness, true);
    assert.is(engine.state.showLifeEventMarkers, true);
    assert.is(engine.state.showGridLines, false);
    assert.is(
      engine.state.showDensity,
      false,
      "unset overlay flags retain their existing values",
    );
    assert.is(
      engine.pendingSlowUiUpdate,
      false,
      "overlay toggles do not schedule leaderboard work",
    );
  } finally {
    restore();
  }
});

test("overlay visibility coercion handles string inputs", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setOverlayVisibility({
      showObstacles: "false",
      showEnergy: " ",
      showDensity: "TRUE",
      showAge: "yes",
      showFitness: "0",
      showLifeEventMarkers: "on",
      showGridLines: "true",
    });

    assert.is(engine.state.showObstacles, false);
    assert.is(
      engine.state.showEnergy,
      false,
      "blank strings fall back to current state",
    );
    assert.is(engine.state.showDensity, true);
    assert.is(engine.state.showAge, true);
    assert.is(engine.state.showFitness, false);
    assert.is(engine.state.showLifeEventMarkers, true);
    assert.is(engine.state.showGridLines, true);
  } finally {
    restore();
  }
});

test("overlay toggles redraw when the engine is idle", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const drawInvocations = [];
    const engine = new modules.SimulationEngine({
      canvas: new MockCanvas(16, 16),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {
        throw new Error("requestAnimationFrame should not be used while idle");
      },
      cancelAnimationFrame: () => {},
      drawOverlays: (...args) => {
        drawInvocations.push(args);
      },
    });

    drawInvocations.length = 0;
    engine.setOverlayVisibility({ showEnergy: true });

    assert.is(
      drawInvocations.length,
      1,
      "toggling overlays while stopped should trigger a redraw",
    );
  } finally {
    restore();
  }
});

test("overlay visibility changes request a redraw while paused", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);
  const scheduled = [];

  try {
    let handle = 0;
    const engine = new modules.SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: (cb) => {
        scheduled.push(cb);

        return ++handle;
      },
      cancelAnimationFrame: () => {},
    });

    engine.start();
    engine.pause();

    while (scheduled.length) {
      const callback = scheduled.shift();

      callback?.(0);
    }

    assert.is(
      scheduled.length,
      0,
      "paused engines should clear pending frames without rearming the loop",
    );

    engine.setOverlayVisibility({ showEnergy: true });

    assert.is(
      scheduled.length,
      1,
      "overlay toggles while paused should request a redraw",
    );

    engine.destroy?.();
  } finally {
    restore();
  }
});

test("setAutoPauseOnBlur coerces string inputs", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.setAutoPauseOnBlur(true);
    assert.is(engine.autoPauseOnBlur, true, "true boolean enables auto pause");

    engine.setAutoPauseOnBlur("false");
    assert.is(engine.autoPauseOnBlur, false, "string 'false' disables auto pause");

    engine.setAutoPauseOnBlur("0");
    assert.is(engine.autoPauseOnBlur, false, "numeric string '0' disables auto pause");

    engine.setAutoPauseOnBlur("1");
    assert.is(engine.autoPauseOnBlur, true, "numeric string '1' enables auto pause");
  } finally {
    restore();
  }
});

test("auto pause does not restart a stopped engine on focus", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  const addListener = (registry, event, handler) => {
    if (!registry.has(event)) {
      registry.set(event, new Set());
    }

    registry.get(event).add(handler);
  };
  const removeListener = (registry, event, handler) => {
    const handlers = registry.get(event);

    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      registry.delete(event);
    }
  };
  const emitEvent = (registry, event) => {
    const handlers = registry.get(event);

    if (!handlers) {
      return;
    }

    [...handlers].forEach((handler) => {
      if (typeof handler === "function") {
        handler();
      }
    });
  };

  try {
    const windowListeners = new Map();
    const documentListeners = new Map();
    const stubWindow = {
      devicePixelRatio: 1,
      addEventListener: (event, handler) =>
        addListener(windowListeners, event, handler),
      removeEventListener: (event, handler) =>
        removeListener(windowListeners, event, handler),
    };
    const stubDocument = {
      visibilityState: "visible",
      hidden: false,
      addEventListener: (event, handler) =>
        addListener(documentListeners, event, handler),
      removeEventListener: (event, handler) =>
        removeListener(documentListeners, event, handler),
      getElementById: () => null,
    };
    const fireWindowEvent = (event) => emitEvent(windowListeners, event);

    const engine = new modules.SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      window: stubWindow,
      document: stubDocument,
      config: { autoPauseOnBlur: true },
    });

    engine.start();

    assert.is(engine.running, true, "engine should start running");
    assert.is(engine.isPaused(), false, "engine should begin unpaused");

    stubDocument.visibilityState = "visible";
    fireWindowEvent("blur");

    assert.is(engine.isPaused(), true, "blur should pause the engine");
    assert.is(
      engine.state.autoPausePending,
      true,
      "auto pause should mark pending resume",
    );

    engine.stop();

    assert.is(engine.running, false, "engine.stop should stop the loop");
    assert.is(
      engine.state.autoPausePending,
      false,
      "stopping should clear pending auto pause resumes",
    );

    fireWindowEvent("focus");

    assert.is(engine.running, false, "focus should not restart a stopped engine");
    assert.is(engine.isPaused(), true, "engine should remain paused after focus");

    engine.destroy?.();
  } finally {
    restore();
  }
});

test("setPaused coerces string inputs", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.pause();
    assert.is(engine.isPaused(), true, "pause() should set paused state to true");

    engine.setPaused("false");
    assert.is(engine.isPaused(), false, "string 'false' should resume the engine");

    engine.setPaused("true");
    assert.is(engine.isPaused(), true, "string 'true' should pause the engine");

    engine.setPaused(0);
    assert.is(engine.isPaused(), false, "numeric zero should resume the engine");

    engine.destroy?.();
  } finally {
    restore();
  }
});

test("SimulationEngine exposes a callable overlay renderer by default", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    assert.type(engine.drawOverlays, "function");
    assert.not.throws(() =>
      engine.drawOverlays(engine.grid, engine.ctx, engine.cellSize, {}),
    );
  } finally {
    restore();
  }
});

// Regression test: ensure overlay visibility flags flow into the renderer so toggles
// actually change what is drawn on the simulation canvas.
test("tick forwards overlay visibility flags to the renderer", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const overlayCalls = [];
    const { SimulationEngine } = modules;
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      drawOverlays: (...args) => overlayCalls.push(args),
    });

    engine.setOverlayVisibility({
      showEnergy: true,
      showDensity: true,
      showAge: true,
      showFitness: true,
      showLifeEventMarkers: true,
    });

    engine.tick(0);

    const lastCall = overlayCalls.at(-1);

    assert.ok(lastCall, "overlay renderer was invoked during tick");

    const [, , , options] = lastCall;

    assert.is(options.showEnergy, true);
    assert.is(options.showDensity, true);
    assert.is(options.showAge, true);
    assert.is(options.showFitness, true);
    assert.is(options.showObstacles, true, "obstacles stay enabled by default");
    assert.is(options.showLifeEventMarkers, true);
  } finally {
    restore();
  }
});

test("setLeaderboardSize adjusts telemetry output", async () => {
  const modules = await loadSimulationModules();
  const { restore, snapshot } = patchSimulationPrototypes(modules);

  snapshot.entries = Array.from({ length: 4 }, (_, index) => ({
    row: index,
    col: index,
    fitness: 10 - index,
    cell: { color: `#${index}${index}${index}` },
  }));

  try {
    const { SimulationEngine } = modules;
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      config: { leaderboardSize: 1 },
    });

    const emittedSizes = [];
    const originalSetter = engine.telemetry.setLeaderboardSize.bind(engine.telemetry);

    engine.telemetry.setLeaderboardSize = (value) => {
      emittedSizes.push(value);

      return originalSetter(value);
    };

    const eventSizes = [];

    engine.on("leaderboard", ({ entries }) => {
      eventSizes.push(entries.length);
    });

    engine.tick(0);
    engine.tick(16);

    assert.ok(eventSizes.length > 0, "leaderboard events should be emitted");
    assert.is(eventSizes.at(-1), 1, "initial leaderboard size should apply");

    engine.setLeaderboardSize(3);

    engine.tick(32);
    engine.tick(48);

    assert.is(engine.state.leaderboardSize, 3);
    assert.is(emittedSizes.at(-1), 3, "telemetry setter receives sanitized size");
    assert.is(eventSizes.at(-1), 3, "updated leaderboard size should affect output");
  } finally {
    restore();
  }
});

test("autoPauseOnBlur setter keeps engine state aligned", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    assert.is(engine.state.autoPauseOnBlur, false, "autopause defaults to disabled");

    engine.setAutoPauseOnBlur(true);

    assert.is(engine.state.autoPauseOnBlur, true, "enabling autopause updates state");
    assert.is(engine.autoPauseOnBlur, true, "instance flag mirrors enabled state");

    engine._autoPauseResumePending = true;
    engine.state.autoPausePending = true;
    engine.setAutoPauseOnBlur(false);

    assert.is(engine.state.autoPauseOnBlur, false, "disabling autopause updates state");
    assert.is(engine.autoPauseOnBlur, false, "instance flag mirrors disabled state");
    assert.is(
      engine.state.autoPausePending,
      false,
      "disabling autopause clears pending flag in state",
    );
    assert.is(
      engine._autoPauseResumePending,
      false,
      "disabling autopause clears any pending auto-resume markers",
    );
  } finally {
    restore();
  }
});

test("disabling autopause leaves the simulation paused when an auto pause is pending", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.start();
    engine.setAutoPauseOnBlur(true);

    engine.pause();
    engine._autoPauseResumePending = true;
    engine.state.autoPausePending = true;

    assert.is(
      engine.isPaused(),
      true,
      "engine should be paused before disabling autopause",
    );

    engine.setAutoPauseOnBlur(false);

    assert.is(
      engine.isPaused(),
      true,
      "disabling autopause should not resume the simulation",
    );
    assert.is(engine._autoPauseResumePending, false);
    assert.is(engine.state.autoPausePending, false);
    engine.resume();
    assert.is(
      engine.isPaused(),
      false,
      "simulation can still resume manually after disabling autopause",
    );
  } finally {
    restore();
  }
});

test("pause clears pending auto-resume flags", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine._autoPauseResumePending = true;
    engine.state.autoPausePending = true;

    engine.pause();

    assert.is(engine._autoPauseResumePending, false);
    assert.is(engine.state.autoPausePending, false);
  } finally {
    restore();
  }
});

test("resetWorld clears pending auto-resume flags when stopped", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    engine.state.paused = true;
    engine._autoPauseResumePending = true;
    engine.state.autoPausePending = true;

    engine.stop();

    engine.resetWorld();

    assert.is(
      engine._autoPauseResumePending,
      false,
      "resetWorld clears the internal auto-resume flag when the loop is stopped",
    );
    assert.is(
      engine.state.autoPausePending,
      false,
      "resetWorld clears autoPausePending in engine state when stopped",
    );
  } finally {
    restore();
  }
});

test("engine.resetWorld clears custom selection zones when requested", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const { SimulationEngine } = modules;
    const { default: SelectionManager } = await import(
      "../src/grid/selectionManager.js"
    );
    const engine = new SimulationEngine({
      canvas: new MockCanvas(20, 20),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      selectionManagerFactory: (rows, cols) => new SelectionManager(rows, cols),
    });
    const selectionManager = engine.selectionManager;

    assert.ok(selectionManager, "engine should expose a selection manager");

    const activated = selectionManager.togglePattern("centralSanctuary", true);

    assert.ok(activated, "toggling a zone should mark it active");
    assert.ok(
      selectionManager.hasActiveZones(),
      "selection manager should report active zones after activation",
    );

    engine.resetWorld({ clearCustomZones: true });

    assert.is(
      selectionManager.hasActiveZones(),
      false,
      "resetWorld should clear active zones when clearCustomZones is true",
    );

    engine.destroy();
  } finally {
    restore();
  }
});

test("SimulationEngine.burstRandomCells returns the number of spawned cells", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const { SimulationEngine } = modules;
    const engine = new SimulationEngine({
      canvas: new MockCanvas(30, 30),
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      rng: () => 0,
    });

    engine.resetWorld();
    engine.grid.clearObstacles();
    engine.grid.currentObstaclePreset = "none";

    const before = engine.grid.activeCells?.size ?? 0;
    const placed = engine.burstRandomCells({ count: 12, radius: 3 });
    const after = engine.grid.activeCells?.size ?? 0;

    assert.type(placed, "number", "engine burstRandomCells should return a count");
    assert.ok(
      placed > 0,
      "burstRandomCells should report placed cells when space is available",
    );
    assert.is(
      after - before,
      placed,
      "returned count should match the number of new active cells",
    );
  } finally {
    restore();
  }
});
