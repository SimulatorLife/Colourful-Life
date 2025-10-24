import GridManager from "../src/grid/gridManager.js";

function createStubCell(id) {
  const baseSeed = id;
  const dna = {
    seed: () => baseSeed,
    allyThreshold: () => 0.75,
    enemyThreshold: () => 0.25,
    mateSimilarityBias: () => 0,
    riskTolerance: () => 0.5,
    reproductionThresholdFrac: () => 0.4,
  };

  return {
    id,
    sight: 5,
    diversityAppetite: 0.2,
    matePreferenceBias: 0,
    dna,
    density: {
      enemyBias: { min: 0.05, max: 0.15 },
    },
    getRiskTolerance: () => 0.5,
    similarityTo(other) {
      if (!other || typeof other !== "object") return 0;

      const delta = Math.abs((other.id ?? 0) - id);

      return Math.max(0, 1 - delta * 0.05);
    },
  };
}

function populateGrid(manager, width, height) {
  const cells = [];
  let counter = 0;

  for (let row = 2; row < height - 2; row += 2) {
    for (let col = 2; col < width - 2; col += 2) {
      const cell = createStubCell(counter++);

      manager.placeCell(row, col, cell, { absorbTileEnergy: false });
      cells.push({ row, col, cell });
    }
  }

  return cells;
}

function measureSimilarityCacheChurn({ iterations = 2500, gcInterval } = {}) {
  const rows = 24;
  const cols = 24;
  const manager = new GridManager(rows, cols, { stats: null });
  const placements = populateGrid(manager, rows, cols);
  const stats = [];
  let peakHeap = 0;
  let peakTick = 0;

  // Warm up to stabilize allocations before measuring.
  manager.tickCount = 0;
  for (const { row, col, cell } of placements) {
    manager.findTargets(row, col, cell);
  }

  if (global.gc && gcInterval) {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;

  for (let tick = 1; tick <= iterations; tick++) {
    manager.tickCount = tick;

    for (const { row, col, cell } of placements) {
      manager.findTargets(row, col, cell);
    }

    if (gcInterval && gcInterval > 0 && tick % gcInterval === 0 && global.gc) {
      global.gc();
      const heapUsed = process.memoryUsage().heapUsed;

      stats.push({ tick, heapUsed });

      if (heapUsed > peakHeap) {
        peakHeap = heapUsed;
        peakTick = tick;
      }
    }
  }

  if (global.gc && gcInterval) {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return {
    before,
    after,
    stats,
    placements: placements.length,
    iterations,
    peakHeap,
    peakTick,
  };
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

const iterations = Number.parseInt(process.env.ITERATIONS ?? "2000", 10);
const gcIntervalEnv = process.env.GC_INTERVAL;
const gcInterval = gcIntervalEnv != null ? Number.parseInt(gcIntervalEnv, 10) : 250;

const result = measureSimilarityCacheChurn({
  iterations: Number.isFinite(iterations) && iterations > 0 ? iterations : 2000,
  gcInterval: Number.isFinite(gcInterval) && gcInterval > 0 ? gcInterval : null,
});

console.log(
  JSON.stringify(
    {
      placements: result.placements,
      iterations: result.iterations,
      before: formatBytes(result.before),
      after: formatBytes(result.after),
      peak: formatBytes(result.peakHeap),
      peakTick: result.peakTick,
      deltas: result.stats.map((entry) => ({
        tick: entry.tick,
        heapUsed: formatBytes(entry.heapUsed),
      })),
    },
    null,
    2,
  ),
);
