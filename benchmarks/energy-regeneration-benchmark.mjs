import { performance } from 'node:perf_hooks';

import EventManager from '../src/eventManager.js';
import GridManager from '../src/gridManager.js';
import SelectionManager from '../src/selectionManager.js';
import Stats from '../src/stats.js';

// GridManager references the browser `window` global for optional fallbacks.
// Provide a minimal stub so the benchmark can run in Node without additional
// guards in the production code.
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    ctx: null,
    cellSize: 8,
    stats: null,
    eventManager: null,
  };
}

const ROWS = Number.parseInt(process.env.BENCH_ROWS ?? '120', 10);
const COLS = Number.parseInt(process.env.BENCH_COLS ?? '120', 10);
const ITERATIONS = Number.parseInt(process.env.BENCH_ITERATIONS ?? '50', 10);

const eventManager = new EventManager(ROWS, COLS, Math.random);
const stats = new Stats();
const selectionManager = new SelectionManager(ROWS, COLS);

const grid = new GridManager(ROWS, COLS, {
  eventManager,
  stats,
  selectionManager,
  rng: Math.random,
});

// Seed a handful of cells to create non-zero densities.
for (let i = 0; i < ROWS * COLS * 0.05; i++) {
  const row = Math.floor(Math.random() * ROWS);
  const col = Math.floor(Math.random() * COLS);

  grid.spawnCell(row, col, { recordBirth: false });
}

grid.recalculateDensityCounts();
const densityGrid = grid.computeDensityGrid();

const regenRate = GridManager.energyRegenRate;
const diffusionRate = GridManager.energyDiffusionRate;

// Warm-up run to stabilise JIT compilation effects.
for (let i = 0; i < 5; i++) {
  grid.regenerateEnergyGrid(eventManager.activeEvents, 1, regenRate, diffusionRate, densityGrid, 1);
}

grid.regenerateEnergyGrid(eventManager.activeEvents, 1, regenRate, diffusionRate, densityGrid, 1);

const start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  grid.regenerateEnergyGrid(eventManager.activeEvents, 1, regenRate, diffusionRate, densityGrid, 1);
}
const duration = performance.now() - start;

const avg = duration / ITERATIONS;

console.log(
  JSON.stringify(
    {
      rows: ROWS,
      cols: COLS,
      iterations: ITERATIONS,
      totalMs: Number(duration.toFixed(3)),
      avgMs: Number(avg.toFixed(3)),
    },
    null,
    2
  )
);
