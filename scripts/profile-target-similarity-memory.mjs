import GridManager from "../src/grid/gridManager.js";

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = units.shift();

  while (units.length > 0 && value >= 1024) {
    value /= 1024;
    unit = units.shift();
  }

  return `${value.toFixed(2)} ${unit}`;
}

function captureHeapUsage() {
  if (typeof global.gc === "function") {
    global.gc();
  }

  return process.memoryUsage().heapUsed;
}

function resolveOption(envKey, fallback) {
  const raw = process.env[envKey];

  if (raw == null) {
    return fallback;
  }

  const numeric = Number(raw);

  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));

    [array[i], array[j]] = [array[j], array[i]];
  }
}

function createManager({ rows, cols, population, rng = Math.random }) {
  const manager = new GridManager(rows, cols, {
    rng,
    eventManager: { activeEvents: [] },
  });
  const coordinates = [];

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      coordinates.push([r, c]);
    }
  }

  shuffle(coordinates, rng);
  const limit = Math.min(population, coordinates.length);

  for (let i = 0; i < limit; i += 1) {
    const [row, col] = coordinates[i];

    manager.spawnCell(row, col);
  }

  manager.computeDensityGrid();

  const originalProcessCell = manager.processCell.bind(manager);

  manager.processCell = function processCellForMemoryProbe(row, col, context) {
    const cell = this.grid[row][col];

    if (!cell || context.processed.has(cell)) {
      return;
    }

    context.processed.add(cell);
    this.findTargets(row, col, cell, {
      densityEffectMultiplier: context.densityEffectMultiplier,
      societySimilarity: context.societySimilarity,
      enemySimilarity: context.enemySimilarity,
    });
  };

  manager.__restoreProcessCell = () => {
    manager.processCell = originalProcessCell;
  };

  return manager;
}

function runTrial({
  rows = 24,
  cols = 24,
  population = 180,
  warmupTicks = 3,
  measurementTicks = 12,
} = {}) {
  const manager = createManager({ rows, cols, population });

  for (let i = 0; i < warmupTicks; i += 1) {
    manager.update();
  }

  const before = captureHeapUsage();
  let peak = before;

  for (let i = 0; i < measurementTicks; i += 1) {
    manager.update();
    const current = process.memoryUsage().heapUsed;

    if (current > peak) {
      peak = current;
    }
  }

  const after = captureHeapUsage();

  manager.__restoreProcessCell?.();

  return {
    before,
    after,
    peak,
    delta: after - before,
    rows,
    cols,
    population,
    warmupTicks,
    measurementTicks,
  };
}

function main() {
  const rows = resolveOption("SIM_MEMORY_ROWS", 24);
  const cols = resolveOption("SIM_MEMORY_COLS", 24);
  const population = resolveOption("SIM_MEMORY_POPULATION", 180);
  const warmupTicks = resolveOption("SIM_MEMORY_WARMUP", 3);
  const measurementTicks = resolveOption("SIM_MEMORY_TICKS", 12);

  const trial = runTrial({
    rows,
    cols,
    population,
    warmupTicks,
    measurementTicks,
  });

  console.log(
    JSON.stringify(
      {
        rows: trial.rows,
        cols: trial.cols,
        population: trial.population,
        warmupTicks: trial.warmupTicks,
        measurementTicks: trial.measurementTicks,
        heapBefore: trial.before,
        heapAfter: trial.after,
        heapDelta: trial.delta,
        heapPeak: trial.peak,
        heapBeforePretty: formatBytes(trial.before),
        heapAfterPretty: formatBytes(trial.after),
        heapDeltaPretty: formatBytes(trial.delta),
        heapPeakPretty: formatBytes(trial.peak),
        gcExposed: typeof global.gc === "function",
      },
      null,
      2,
    ),
  );
}

main();
