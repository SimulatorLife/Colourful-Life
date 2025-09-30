import { performance } from 'node:perf_hooks';

/**
 * Benchmarks the grid energy preparation loop in a headless Node environment.
 * Use the PERF_* environment variables to tune grid size, warmup, and iteration
 * counts when profiling changes to the energy system.
 */
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {};
}

const rows = Number.parseInt(process.env.PERF_ROWS ?? '', 10) || 120;
const cols = Number.parseInt(process.env.PERF_COLS ?? '', 10) || 120;
const warmup = Number.parseInt(process.env.PERF_WARMUP ?? '', 10) || 10;
const iterations = Number.parseInt(process.env.PERF_ITERATIONS ?? '', 10) || 60;

const [
  { default: GridManager },
  { default: EventManager },
  { ENERGY_REGEN_RATE_DEFAULT, ENERGY_DIFFUSION_RATE_DEFAULT },
  { default: Stats },
] = await Promise.all([
  import('../src/gridManager.js'),
  import('../src/eventManager.js'),
  import('../src/config.js'),
  import('../src/stats.js'),
]);

const eventManager = new EventManager(rows, cols, Math.random);
const stats = new Stats();
const grid = new GridManager(rows, cols, {
  eventManager,
  stats,
  ctx: null,
  cellSize: 5,
  rng: Math.random,
});

const tickOptions = {
  eventManager,
  eventStrengthMultiplier: 1,
  energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
  energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
  densityEffectMultiplier: 1,
};

const runTick = () => {
  grid.prepareTick(tickOptions);
};

for (let i = 0; i < warmup; i++) {
  runTick();
  eventManager.updateEvent();
}

const start = performance.now();

for (let i = 0; i < iterations; i++) {
  runTick();
  eventManager.updateEvent();
}
const totalMs = performance.now() - start;

const averageMsPerTick = totalMs / iterations;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      warmup,
      iterations,
      totalMs,
      averageMsPerTick,
      activeEvents: eventManager.activeEvents.length,
      population: grid.activeCells.size,
    },
    null,
    2
  )
);
