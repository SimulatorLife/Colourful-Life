import { assert, test } from "#tests/harness";
import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from "./helpers/simulationEngine.js";

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
      showFitness: true,
      showLifeEventMarkers: true,
    });

    assert.is(engine.state.showObstacles, false);
    assert.is(engine.state.showFitness, true);
    assert.is(engine.state.showLifeEventMarkers, true);
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
      showFitness: "0",
      showLifeEventMarkers: "on",
    });

    assert.is(engine.state.showObstacles, false);
    assert.is(
      engine.state.showEnergy,
      false,
      "blank strings fall back to current state",
    );
    assert.is(engine.state.showDensity, true);
    assert.is(engine.state.showFitness, false);
    assert.is(engine.state.showLifeEventMarkers, true);
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
      showFitness: true,
      showLifeEventMarkers: true,
    });

    engine.tick(0);

    const lastCall = overlayCalls.at(-1);

    assert.ok(lastCall, "overlay renderer was invoked during tick");

    const [, , , options] = lastCall;

    assert.is(options.showEnergy, true);
    assert.is(options.showDensity, true);
    assert.is(options.showFitness, true);
    assert.is(options.showObstacles, true, "obstacles stay enabled by default");
    assert.is(options.showLifeEventMarkers, true);
  } finally {
    restore();
  }
});

test("setBrainSnapshotCollector stores collector and forwards to grid", async () => {
  const modules = await loadSimulationModules();
  const { restore, calls } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    const collector = { captureFromEntries: () => {} };

    engine.setBrainSnapshotCollector(collector);

    assert.is(engine.brainSnapshotCollector, collector);
    assert.equal(calls.grid.setBrainSnapshotCollector.at(-1), [collector]);

    engine.setBrainSnapshotCollector();

    assert.is(
      engine.brainSnapshotCollector,
      null,
      "collector defaults to null when omitted",
    );
    assert.equal(calls.grid.setBrainSnapshotCollector.at(-1), [undefined]);
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
