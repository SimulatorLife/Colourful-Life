const { test } = require('uvu');
const assert = require('uvu/assert');

class MockGradient {
  addColorStop() {}
}

class MockContext {
  constructor(width, height) {
    this.canvas = { width, height };
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  createLinearGradient() {
    return new MockGradient();
  }
  fillText() {}
  strokeText() {}
}

class MockCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._context = new MockContext(width, height);
  }

  getContext(type) {
    if (type !== '2d') return null;

    return this._context;
  }
}

async function loadModules() {
  const [simulationModule, gridModule, statsModule, eventModule] = await Promise.all([
    import('../src/simulationEngine.js'),
    import('../src/gridManager.js'),
    import('../src/stats.js'),
    import('../src/eventManager.js'),
  ]);

  return {
    SimulationEngine: simulationModule.default,
    GridManager: gridModule.default,
    Stats: statsModule.default,
    EventManager: eventModule.default,
  };
}

function patchPrototypes({ GridManager, Stats, EventManager }) {
  const snapshot = {
    entries: [
      {
        row: 0,
        col: 0,
        fitness: 1,
        smoothedFitness: 2,
        cell: {
          fitnessScore: 1,
          offspring: 3,
          fightsWon: 4,
          age: 5,
          color: '#123456',
        },
      },
    ],
    brainSnapshots: [],
  };
  const metrics = { averageEnergy: 0.5 };
  const fixedEventTemplate = {
    eventType: 'flood',
    duration: 10,
    remaining: 10,
    strength: 0.75,
    affectedArea: { x: 1, y: 2, width: 3, height: 4 },
  };

  const gridMethods = [
    'init',
    'recalculateDensityCounts',
    'rebuildActiveCells',
    'update',
    'draw',
    'getLastSnapshot',
    'setLingerPenalty',
    'setMatingDiversityOptions',
  ];
  const statsMethods = ['resetTick', 'logEvent', 'updateFromSnapshot', 'setMutationMultiplier'];

  const originals = {
    grid: {},
    stats: {},
    event: EventManager.prototype.generateRandomEvent,
  };
  const calls = {
    grid: Object.fromEntries(gridMethods.map((name) => [name, []])),
    stats: Object.fromEntries(statsMethods.map((name) => [name, []])),
    events: { generateRandomEvent: [] },
  };

  gridMethods.forEach((name) => {
    originals.grid[name] = GridManager.prototype[name];
    GridManager.prototype[name] = function stubbedGridMethod(...args) {
      calls.grid[name].push(args);

      if (name === 'update') {
        return snapshot;
      }

      if (name === 'getLastSnapshot') {
        return snapshot;
      }
    };
  });

  statsMethods.forEach((name) => {
    originals.stats[name] = Stats.prototype[name];
    Stats.prototype[name] = function stubbedStatsMethod(...args) {
      calls.stats[name].push(args);

      if (name === 'updateFromSnapshot') {
        return metrics;
      }

      return undefined;
    };
  });

  EventManager.prototype.generateRandomEvent = function stubbedGenerateRandomEvent(...args) {
    calls.events.generateRandomEvent.push(args);

    return {
      ...fixedEventTemplate,
      affectedArea: { ...fixedEventTemplate.affectedArea },
    };
  };

  return {
    calls,
    snapshot,
    metrics,
    fixedEventTemplate,
    restore() {
      gridMethods.forEach((name) => {
        GridManager.prototype[name] = originals.grid[name];
      });
      statsMethods.forEach((name) => {
        Stats.prototype[name] = originals.stats[name];
      });
      EventManager.prototype.generateRandomEvent = originals.event;
    },
  };
}

test('start schedules a frame and ticking through RAF uses sanitized defaults', async () => {
  const modules = await loadModules();
  const { SimulationEngine } = modules;
  const { restore, calls, snapshot } = patchPrototypes(modules);

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
  const modules = await loadModules();
  const { SimulationEngine } = modules;
  const { restore, snapshot, metrics } = patchPrototypes(modules);

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
  const modules = await loadModules();
  const { SimulationEngine } = modules;
  const { restore, calls } = patchPrototypes(modules);

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
