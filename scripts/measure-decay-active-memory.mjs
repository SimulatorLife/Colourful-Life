import GridManager from "../src/grid/gridManager.js";

function createStubStats() {
  return {
    onBirth() {},
    onDeath() {},
    recordEnergyStageTimings() {},
    recordInteraction() {},
    recordMovement() {},
    registerBlockedReproduction() {},
    logEvent() {},
    setMutationMultiplier() {},
    totals: { ticks: 0 },
    getRecentLifeEvents() {
      return [];
    },
  };
}

function createStubEventManager() {
  return {
    activeEvents: [],
    updateEvent() {},
    getColor() {
      return "#000";
    },
  };
}

function ensureGC() {
  if (typeof global.gc !== "function") {
    throw new Error("Run this script with `node --expose-gc` to enable manual GC.");
  }

  global.gc();
}

function createGrid(rows, cols) {
  const stats = createStubStats();
  const eventManager = createStubEventManager();
  const grid = new GridManager(rows, cols, {
    eventManager,
    stats,
    rng: () => 0.5,
    renderStrategy: "canvas",
  });

  grid.interactionSystem = { resolveIntent() {} };

  return { grid, eventManager };
}

function seedDecay(grid, { activeTiles, energyFraction = 0.65 } = {}) {
  const totalTiles = grid.rows * grid.cols;
  const target = Math.max(
    0,
    Math.min(totalTiles, Math.floor(activeTiles ?? totalTiles)),
  );
  let seeded = 0;

  for (let row = 0; row < grid.rows && seeded < target; row += 1) {
    const amountRow = grid.decayAmount[row];
    const ageRow = grid.decayAge[row];

    for (let col = 0; col < grid.cols && seeded < target; col += 1) {
      amountRow[col] = grid.maxTileEnergy * energyFraction;
      ageRow[col] = 0;
      grid.decayActive.add(row * grid.cols + col);
      seeded += 1;
    }
  }

  return seeded;
}

function formatBytes(bytes) {
  return Number((bytes / 1024 / 1024).toFixed(3));
}

function runDecayTicks(grid, eventManager, { ticks, sampleEvery }) {
  const samples = [];

  ensureGC();
  const initial = process.memoryUsage().heapUsed;
  let peak = initial;

  for (let i = 0; i < ticks; i += 1) {
    grid.prepareTick({
      eventManager,
      eventStrengthMultiplier: 1,
      energyRegenRate: 0,
      energyDiffusionRate: 0,
      densityEffectMultiplier: 1,
    });

    const heap = process.memoryUsage().heapUsed;

    if (heap > peak) {
      peak = heap;
    }

    if ((i + 1) % sampleEvery === 0 || i === ticks - 1) {
      ensureGC();
      const afterGc = process.memoryUsage().heapUsed;

      if (afterGc > peak) {
        peak = afterGc;
      }

      samples.push({
        tick: i + 1,
        heapUsedBytes: afterGc,
        heapUsedMB: formatBytes(afterGc),
      });
    }
  }

  ensureGC();
  const final = process.memoryUsage().heapUsed;

  if (final > peak) {
    peak = final;
  }

  return { initial, final, peak, samples };
}

function main() {
  ensureGC();

  const rows = Number.parseInt(process.env.DECAY_ROWS ?? "128", 10);
  const cols = Number.parseInt(process.env.DECAY_COLS ?? `${rows}`, 10);
  const ticks = Number.parseInt(process.env.DECAY_TICKS ?? "320", 10);
  const sampleEvery = Math.max(
    1,
    Number.parseInt(process.env.DECAY_SAMPLE_EVERY ?? "20", 10),
  );
  const activeTiles = Number.parseInt(
    process.env.DECAY_ACTIVE_TILES ?? `${Math.floor(rows * cols * 0.4)}`,
    10,
  );

  const { grid, eventManager } = createGrid(rows, cols);
  const seeded = seedDecay(grid, { activeTiles });
  const { initial, final, peak, samples } = runDecayTicks(grid, eventManager, {
    ticks,
    sampleEvery,
  });

  const summary = {
    rows,
    cols,
    ticks,
    sampleEvery,
    activeTilesRequested: activeTiles,
    activeTilesSeeded: seeded,
    initialHeapUsedBytes: initial,
    initialHeapUsedMB: formatBytes(initial),
    peakHeapUsedBytes: peak,
    peakHeapUsedMB: formatBytes(peak),
    finalHeapUsedBytes: final,
    finalHeapUsedMB: formatBytes(final),
    samples,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
