const { test } = require('uvu');
const assert = require('uvu/assert');

const simulationModulePromise = import('../src/main.js');

class MockGradient {
  addColorStop() {}
}

class MockContext {
  constructor(width, height, calls) {
    this.canvas = { width, height };
    this.calls = calls;
  }

  clearRect() {
    this.calls.push({ type: 'clearRect' });
  }
  fillRect(x, y, w, h) {
    this.calls.push({ type: 'fillRect', args: [x, y, w, h] });
  }
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
  constructor(width, height, calls = []) {
    this.width = width;
    this.height = height;
    this._context = new MockContext(width, height, calls);
  }

  getContext(type) {
    if (type !== '2d') return null;

    return this._context;
  }
}

test('createSimulation runs in a headless Node environment', async () => {
  const { createSimulation } = await simulationModulePromise;
  const canvas = new MockCanvas(100, 100);
  const calls = [];

  const simulation = createSimulation({
    canvas,
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: (cb) => {
      const id = setTimeout(() => {
        calls.push('raf');
        cb(0);
      }, 0);

      return id;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
  });

  assert.ok(simulation.grid, 'grid is returned');
  assert.ok(simulation.uiManager, 'uiManager is returned');

  const result = simulation.step();

  assert.type(result, 'boolean', 'step returns whether a tick occurred');

  simulation.stop();
  assert.ok(Array.isArray(calls));
});

test('browser simulation pipes metrics and renders overlays via adapter', async () => {
  const { createSimulation } = await simulationModulePromise;
  const drawCalls = [];
  const canvas = new MockCanvas(100, 100, drawCalls);
  let uiCallbacks;
  const metricsCalls = [];
  const leaderboardCalls = [];
  const pauseStates = [];
  const lingerUpdates = [];
  let now = 0;

  const simulation = createSimulation({
    canvas,
    headless: false,
    autoStart: false,
    performanceNow: () => now,
    requestAnimationFrame: (cb) => {
      cb(now);

      return 1;
    },
    cancelAnimationFrame: () => {},
    config: {
      drawOverlays: (grid, ctx, cellSize, options) => {
        drawCalls.push({ grid, ctx, cellSize, options });
      },
      ui: {
        createManager: (callbacks) => {
          uiCallbacks = callbacks;

          return {
            renderMetrics: (stats, metrics) => metricsCalls.push({ stats, metrics }),
            renderLeaderboard: (entries) => leaderboardCalls.push(entries),
            setPauseState: (paused) => pauseStates.push(paused),
            getLingerPenalty: () => 0.5,
            setLingerPenalty: (value) => lingerUpdates.push(value),
          };
        },
      },
    },
  });

  assert.ok(uiCallbacks, 'UI callbacks exposed');

  now = 1000;
  simulation.engine.tick(now);
  assert.ok(metricsCalls.length > 0, 'metrics rendered at least once');
  assert.ok(leaderboardCalls.length > 0, 'leaderboard rendered at least once');
  assert.ok(drawCalls.length > 0, 'renderer invoked draw/overlay');
  assert.ok(pauseStates.length > 0, 'pause state forwarded to UI');
  assert.is(lingerUpdates[0], 0.5, 'linger penalty propagated to runtime and echoed to UI');

  const initialOverlay = drawCalls[drawCalls.length - 1].options;

  assert.is(initialOverlay.showEnergy, false, 'initial overlay disabled');

  uiCallbacks.onSettingChange('showEnergy', true);
  now += 1000;
  simulation.engine.tick(now);

  const latestOverlay = drawCalls[drawCalls.length - 1].options;

  assert.is(latestOverlay.showEnergy, true, 'overlay toggle propagates through renderer');

  simulation.destroy();
});

test.run();
