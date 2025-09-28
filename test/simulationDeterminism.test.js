const { test } = require('uvu');
const assert = require('uvu/assert');

const simulationModulePromise = import('../src/main.js');
const rngModulePromise = import('../src/rng.js');

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

function formatNumber(value) {
  return Number.parseFloat(Number(value ?? 0).toFixed(4));
}

function snapshotSignature(snapshot) {
  const cells = (snapshot?.cells ?? []).map((cell) => ({
    row: cell.row,
    col: cell.col,
    energy: formatNumber(cell.energy),
    dna: Array.from(cell.dna?.genes ?? []).join(','),
  }));

  cells.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.col !== b.col) return a.col - b.col;

    return a.dna.localeCompare(b.dna);
  });

  return JSON.stringify({
    population: snapshot?.population ?? 0,
    totalEnergy: formatNumber(snapshot?.totalEnergy ?? 0),
    cells,
  });
}

test('identical seeds yield identical snapshots', async () => {
  const [{ createSimulation }, { createRngController }] = await Promise.all([
    simulationModulePromise,
    rngModulePromise,
  ]);

  const run = async (seed) => {
    const canvas = new MockCanvas(60, 60);
    const rng = createRngController(seed);
    const simulation = createSimulation({
      canvas,
      headless: true,
      autoStart: false,
      config: { cellSize: 5, rows: 6, cols: 6 },
      rng,
    });
    const signatures = [];

    for (let i = 0; i < 5; i++) {
      simulation.step();
      signatures.push(snapshotSignature(simulation.grid.getLastSnapshot()));
    }

    simulation.stop();

    return signatures;
  };

  const a = await run('deterministic-seed');
  const b = await run('deterministic-seed');
  const c = await run('another-seed');

  assert.equal(a, b, 'snapshots should match for identical seeds');
  assert.not.equal(a, c, 'snapshots should diverge for different seeds');
});

test.run();
