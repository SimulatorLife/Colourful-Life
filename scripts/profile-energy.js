import { performance } from "node:perf_hooks";
import GridManager from "../src/grid/gridManager.js";

if (!globalThis.window) {
  globalThis.window = {};
}

const rows = 96;
const cols = 96;
const iterations = Number.parseInt(process.argv[2] ?? "75", 10) || 75;
const regenRate = 0.12;
const diffusionRate = 0.08;
const eventStrengthMultiplier = 1;
const densityEffectMultiplier = 1;

const stubEventManager = { activeEvents: [] };
const grid = new GridManager(rows, cols, {
  eventManager: stubEventManager,
  stats: null,
  rng: Math.random,
  selectionManager: null,
  brainSnapshotCollector: null,
});

grid.activeCells.clear();

grid.energyGrid = Array.from({ length: rows }, () =>
  Array.from({ length: cols }, () => Math.random() * grid.maxTileEnergy),
);

grid.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));

grid.energyDeltaGrid = Array.from({ length: rows }, () => Array(cols).fill(0));

grid.obstacles = Array.from({ length: rows }, () => Array(cols).fill(false));

grid.densityGrid = Array.from({ length: rows }, () =>
  Array.from({ length: cols }, () => Math.random()),
);

const warmupIterations = 10;

for (let i = 0; i < warmupIterations; i++) {
  grid.regenerateEnergyGrid(
    stubEventManager.activeEvents,
    eventStrengthMultiplier,
    regenRate,
    diffusionRate,
    grid.densityGrid,
    densityEffectMultiplier,
  );
}

const start = performance.now();

for (let i = 0; i < iterations; i++) {
  grid.regenerateEnergyGrid(
    stubEventManager.activeEvents,
    eventStrengthMultiplier,
    regenRate,
    diffusionRate,
    grid.densityGrid,
    densityEffectMultiplier,
  );
}

const elapsedMs = performance.now() - start;
const perIteration = elapsedMs / iterations;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      iterations,
      elapsedMs,
      perIteration,
      regenRate,
      diffusionRate,
    },
    null,
    2,
  ),
);
