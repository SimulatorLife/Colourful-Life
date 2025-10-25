import { performance } from "node:perf_hooks";
import GridManager from "../src/grid/gridManager.js";
import DNA from "../src/genome.js";
import Cell from "../src/cell.js";

const rows = 160;
const cols = 160;
const population = 1200;
const sight = 35;
const iterations = 400;
const warmupIterations = 50;

function createRng(seed = 1) {
  let state = seed >>> 0;

  return () => {
    state = (state * 48271) % 0x7fffffff;

    return state / 0x7fffffff;
  };
}

const rng = createRng(12345);

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

  cell.sight = sight;

  return cell;
}

const usedPositions = new Set();

function addCell(row, col) {
  const key = row * cols + col;

  if (usedPositions.has(key)) return;

  const cell = createCell(row, col);

  manager.placeCell(row, col, cell);
  usedPositions.add(key);
}

for (let i = 0; i < population; i++) {
  const row = Math.floor(rng() * rows);
  const col = Math.floor(rng() * cols);

  if (row === 0 && col === 0) continue;

  addCell(row, col);
}

const actorRow = Math.floor(rows / 2);
const actorCol = Math.floor(cols / 2);
const actor = createCell(actorRow, actorCol);

manager.placeCell(actorRow, actorCol, actor);

manager.recalculateDensityCounts();

function runOnce() {
  return manager.findTargets(actorRow, actorCol, actor, {
    densityEffectMultiplier: 1,
    societySimilarity: 0.7,
    enemySimilarity: 0.3,
  });
}

for (let i = 0; i < warmupIterations; i++) {
  runOnce();
}

const start = performance.now();

for (let i = 0; i < iterations; i++) {
  runOnce();
}

const duration = performance.now() - start;
const perIteration = duration / iterations;
const result = runOnce();

console.log(
  JSON.stringify(
    {
      revision: "current",
      rows,
      cols,
      population: usedPositions.size,
      sight,
      iterations,
      durationMs: Number(duration.toFixed(3)),
      avgPerCallMs: Number(perIteration.toFixed(4)),
      mates: result.mates.length,
      enemies: result.enemies.length,
      society: result.society.length,
    },
    null,
    2,
  ),
);
