import { performance } from "node:perf_hooks";
import GridManager from "../src/grid/gridManager.js";
import EventManager from "../src/events/eventManager.js";
import Stats from "../src/stats.js";
import SelectionManager from "../src/ui/selectionManager.js";

if (typeof globalThis.window === "undefined") {
  globalThis.window = {};
}

const rows = 80;
const cols = 80;
const rng = Math.random;
const stats = new Stats();
const eventManager = new EventManager(rows, cols, rng, { startWithEvent: false });
const selectionManager = new SelectionManager(rows, cols);
const ctx = {
  canvas: { width: cols * 5, height: rows * 5 },
  clearRect() {},
  fillRect() {},
  strokeRect() {},
  save() {},
  restore() {},
  beginPath() {},
  stroke() {},
  createLinearGradient() {
    return {
      addColorStop() {},
    };
  },
  fillText() {},
  strokeText() {},
};

const grid = new GridManager(rows, cols, {
  eventManager,
  stats,
  selectionManager,
  cellSize: 5,
  randomizeInitialObstacles: false,
  initialObstaclePreset: "none",
  ctx,
});

grid.seed(0, Math.floor(rows * cols * 0.4));

grid.rebuildActiveCells();

const metrics = new Map();

function wrapTiming(target, method) {
  const original = target[method];

  if (typeof original !== "function") {
    throw new Error(`Cannot wrap missing method ${method}`);
  }

  target[method] = function wrapped(...args) {
    const start = performance.now();

    try {
      return original.apply(this, args);
    } finally {
      const duration = performance.now() - start;

      metrics.set(method, (metrics.get(method) ?? 0) + duration);
    }
  };
}

wrapTiming(grid, "regenerateEnergyGrid");
wrapTiming(grid, "processCell");
wrapTiming(grid, "findTargets");
wrapTiming(grid, "handleMovement");
wrapTiming(grid, "handleReproduction");
wrapTiming(grid, "handleCombat");

const warmupTicks = 5;
const measuredTicks = 20;

for (let i = 0; i < warmupTicks; i++) {
  grid.update();
}

metrics.clear();
let totalDuration = 0;

for (let i = 0; i < measuredTicks; i++) {
  const start = performance.now();

  grid.update();
  totalDuration += performance.now() - start;
}

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      population: grid.activeCells.size,
      measuredTicks,
      averageTickMs: totalDuration / measuredTicks,
      durations: Object.fromEntries(
        Array.from(metrics.entries()).map(([key, value]) => [
          key,
          value / measuredTicks,
        ]),
      ),
    },
    null,
    2,
  ),
);
