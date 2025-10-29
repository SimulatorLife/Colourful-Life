import { performance } from "node:perf_hooks";
import GridManager from "../src/grid/gridManager.js";

const ITERATIONS = 40;
const ROW = 12;
const GRID_SIZE = 48;
const STALE_ROW = 18;
const STALE_COUNT = 36;

function createManager() {
  const manager = new GridManager(GRID_SIZE, GRID_SIZE, {
    rng: () => 0.42,
    performanceNow: () => performance.now(),
  });

  const anchor = manager.spawnCell(ROW, ROW, { recordBirth: false });

  for (let i = 0; i < STALE_COUNT; i += 1) {
    manager.spawnCell(STALE_ROW, i, { recordBirth: false });
  }

  for (let i = 0; i < STALE_COUNT; i += 1) {
    manager.grid[STALE_ROW][i] = null;
  }

  return { manager, anchor };
}

function runTrial() {
  const { manager, anchor } = createManager();

  manager.findTargets(ROW, ROW, anchor, {
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
  });
}

const start = performance.now();

for (let i = 0; i < ITERATIONS; i += 1) {
  runTrial();
}
const duration = performance.now() - start;

console.log(
  JSON.stringify({
    iterations: ITERATIONS,
    durationMs: Number(duration.toFixed(3)),
    averageMs: Number((duration / ITERATIONS).toFixed(6)),
  }),
);
