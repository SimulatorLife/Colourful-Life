import { test } from "uvu";
import * as assert from "uvu/assert";

import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from "./helpers/simulationEngine.js";
import { drawOverlays as defaultDrawOverlays } from "../src/ui/overlays.js";

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
    });

    assert.is(engine.state.showObstacles, false);
    assert.is(engine.state.showFitness, true);
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

// Regression test: direct SimulationEngine constructions (like index.html) previously
// defaulted to a noop overlay renderer, leaving UI toggles with no visible effect.
test("SimulationEngine defaults to the shared overlay renderer", async () => {
  const modules = await loadSimulationModules();
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const engine = createEngine(modules);

    assert.is(engine.drawOverlays, defaultDrawOverlays);
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
    });

    engine.tick(0);

    const lastCall = overlayCalls.at(-1);

    assert.ok(lastCall, "overlay renderer was invoked during tick");

    const [, , , options] = lastCall;

    assert.is(options.showEnergy, true);
    assert.is(options.showDensity, true);
    assert.is(options.showFitness, true);
    assert.is(options.showObstacles, true, "obstacles stay enabled by default");
    assert.is(options.showCelebrationAuras, false);
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

    assert.is(engine.state.autoPauseOnBlur, true, "autopause defaults to enabled");

    engine._autoPauseResumePending = true;
    engine.setAutoPauseOnBlur(false);

    assert.is(engine.state.autoPauseOnBlur, false, "disabling autopause updates state");
    assert.is(engine.autoPauseOnBlur, false, "instance flag mirrors state change");
    assert.is(
      engine._autoPauseResumePending,
      false,
      "disabling autopause clears any pending auto-resume markers",
    );

    engine.setAutoPauseOnBlur(true);

    assert.is(
      engine.state.autoPauseOnBlur,
      true,
      "re-enabling autopause updates state",
    );
    assert.is(engine.autoPauseOnBlur, true, "instance flag mirrors re-enabled state");
  } finally {
    restore();
  }
});

test.run();
