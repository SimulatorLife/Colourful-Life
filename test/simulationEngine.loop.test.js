import { test } from 'uvu';
import * as assert from 'uvu/assert';

import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from './helpers/simulationEngine.js';

test('start schedules a frame and ticking through RAF uses sanitized defaults', async () => {
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

    assert.is(rafCallback, null, 'no frame scheduled before start');

    engine.start();

    assert.type(rafCallback, 'function', 'start schedules the next frame');

    const updateCallsBefore = calls.grid.update.length;

    rafCallback(1000);
    assert.ok(
      calls.grid.update.length > updateCallsBefore,
      'grid.update invoked after RAF callback'
    );

    const updateArgs = calls.grid.update.at(-1)[0];

    assert.equal(updateArgs, {
      densityEffectMultiplier: 1,
      societySimilarity: 0.7,
      enemySimilarity: 0.4,
      eventStrengthMultiplier: 1,
      energyRegenRate: 0.007,
      energyDiffusionRate: 0.05,
      mutationMultiplier: 1,
      matingDiversityThreshold: 0.45,
      lowDiversityReproMultiplier: 0.1,
    });

    assert.is(engine.lastSnapshot, snapshot, 'snapshot from update stored on engine');
    assert.ok(calls.stats.resetTick.length > 0, 'stats.resetTick invoked during tick');

    const manualTickResult = engine.tick(2000);

    assert.ok(manualTickResult, 'manual tick returns true when interval satisfied');

    engine.stop();
  } finally {
    restore();
  }
});

test('tick emits events and clears pending slow UI updates after throttle interval', async () => {
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

    engine.on('tick', (payload) => tickEvents.push(payload));
    engine.on('metrics', (payload) => metricsEvents.push(payload));
    engine.on('leaderboard', (payload) => leaderboardEvents.push(payload));

    now = 1000;
    const result = engine.tick(now);

    assert.ok(result, 'tick returns true when enough time has elapsed');
    assert.is(tickEvents.length, 1, 'tick event emitted once');
    assert.is(tickEvents[0].snapshot, snapshot, 'tick event includes snapshot');
    assert.is(tickEvents[0].metrics, metrics, 'tick event includes metrics');
    assert.is(tickEvents[0].timestamp, now, 'tick event includes timestamp');

    assert.is(metricsEvents.length, 1, 'metrics event emitted once');
    assert.is(metricsEvents[0].metrics, metrics, 'metrics event payload matches');
    assert.is(metricsEvents[0].stats, engine.stats, 'metrics event returns stats instance');

    assert.is(leaderboardEvents.length, 1, 'leaderboard event emitted once');
    assert.equal(leaderboardEvents[0].entries, [
      {
        fitness: 1,
        smoothedFitness: 2,
        offspring: 3,
        fightsWon: 4,
        age: 5,
        color: '#123456',
      },
    ]);

    assert.is(engine.pendingSlowUiUpdate, false, 'pendingSlowUiUpdate cleared after emissions');
  } finally {
    restore();
  }
});

test('updateSetting speedMultiplier and setLingerPenalty propagate changes', async () => {
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

    engine.updateSetting('speedMultiplier', 2);
    assert.is(engine.state.updatesPerSecond, 120, 'speedMultiplier adjusts updatesPerSecond');
    assert.ok(engine.pendingSlowUiUpdate, 'speedMultiplier marks pendingSlowUiUpdate');

    const stateEvents = [];

    engine.on('state', (payload) => stateEvents.push(payload));

    engine.setLingerPenalty(3.5);

    const lingerCalls = calls.grid.setLingerPenalty;

    assert.ok(lingerCalls.length >= 2, 'setLingerPenalty called at least twice (initial + manual)');
    assert.equal(lingerCalls.at(-1), [3.5], 'grid receives sanitized linger penalty');

    assert.ok(stateEvents.length >= 1, 'state event emitted');
    const lastEvent = stateEvents.at(-1);

    assert.is(lastEvent.changes.lingerPenalty, 3.5, 'state change includes lingerPenalty');
    assert.is(lastEvent.state.lingerPenalty, 3.5, 'state snapshot reflects lingerPenalty');
    assert.is(engine.lingerPenalty, 3.5, 'engine stores new lingerPenalty');
  } finally {
    restore();
  }
});

test.run();
