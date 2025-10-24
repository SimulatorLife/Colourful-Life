import { performance } from "node:perf_hooks";
import GridManager from "../src/grid/gridManager.js";
import DNA from "../src/genome.js";
import Cell from "../src/cell.js";

function createRng(seed = 1) {
  let state = seed >>> 0;

  return () => {
    state = (state * 48271) % 0x7fffffff;

    return state / 0x7fffffff;
  };
}

const rows = 160;
const cols = 160;
const population = 2400;
const iterations = 60;
const warmupIterations = 10;
const rng = createRng(24680);

const eventManager = { activeEvents: [] };
const stats = {};
const manager = new GridManager(rows, cols, {
  maxTileEnergy: 100,
  eventManager,
  stats,
  ctx: null,
  environment: { eventManager, stats, ctx: null },
});

function createCell(row, col) {
  const dna = DNA.random(rng);
  const cell = new Cell(row, col, dna, manager.maxTileEnergy * 0.5);

  return cell;
}

const usedPositions = new Set();

for (let i = 0; i < population; i++) {
  const row = Math.floor(rng() * rows);
  const col = Math.floor(rng() * cols);
  const key = row * cols + col;

  if (usedPositions.has(key)) continue;

  usedPositions.add(key);
  manager.placeCell(row, col, createCell(row, col));
}

manager.recalculateDensityCounts();

for (let i = 0; i < warmupIterations; i++) {
  manager.recalculateDensityCounts();
}

const start = performance.now();

for (let i = 0; i < iterations; i++) {
  manager.recalculateDensityCounts();
}

const duration = performance.now() - start;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      population: usedPositions.size,
      iterations,
      durationMs: Number(duration.toFixed(3)),
      avgPerCallMs: Number((duration / iterations).toFixed(4)),
      densityRadius: manager.densityRadius,
    },
    null,
    2,
  ),
);
