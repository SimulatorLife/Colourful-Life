import { test } from 'uvu';
import * as assert from 'uvu/assert';

const simulationModulePromise = import('../src/main.js');

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

test.run();
