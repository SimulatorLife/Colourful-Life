import GridManager from "../src/grid/gridManager.js";
import DNA from "../src/genome.js";

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

function createGrid(rows, cols) {
  const eventManager = {
    activeEvents: [],
    updateEvent() {},
    getColor() {
      return "#000";
    },
  };
  const stats = createStubStats();
  const grid = new GridManager(rows, cols, {
    eventManager,
    stats,
    rng: () => 0.5,
    renderStrategy: "canvas",
  });

  grid.interactionSystem = { resolveIntent() {} };

  return { grid, stats, eventManager };
}

function populateGrid(grid) {
  const dnaFactory = () => DNA.random(() => 0.5);

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const dna = dnaFactory();

      grid.spawnCell(row, col, { dna, spawnEnergy: grid.maxTileEnergy });
    }
  }
}

function saturateTargetPool(grid) {
  const centerRow = Math.floor(grid.rows / 2);
  const centerCol = Math.floor(grid.cols / 2);
  const cell = grid.getCell(centerRow, centerCol);

  if (!cell) {
    throw new Error("Center cell missing; ensure populateGrid was called.");
  }

  cell.sight = Math.max(grid.rows, grid.cols);
  cell.energy = grid.maxTileEnergy;
  cell.density.enemyBias = { min: 0, max: 1 };
  cell.executeMovementStrategy = (_gridArr, _row, _col, mates, enemies, society) => {
    lastTargetCounts = {
      mates: mates?.length ?? 0,
      enemies: enemies?.length ?? 0,
      society: society?.length ?? 0,
    };
  };
  cell.manageEnergy = () => false;
  cell.applyEventEffects = () => {};

  grid.handleReproduction = () => false;
  grid.handleCombat = () => false;
  grid.handleMovement = function (row, col, subject, targets) {
    const mates = targets?.mates ?? [];
    const enemies = targets?.enemies ?? [];
    const society = targets?.society ?? [];

    lastTargetCounts = {
      mates: mates.length,
      enemies: enemies.length,
      society: society.length,
    };
  };
  grid.consumeEnergy = () => {};
  grid.interactionSystem = { resolveIntent() {} };

  const processed = new WeakSet();

  grid.processCell(centerRow, centerCol, {
    stats: grid.stats,
    eventManager: grid.eventManager ?? { activeEvents: [] },
    densityGrid: grid.densityGrid,
    processed,
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
    eventStrengthMultiplier: 1,
    mutationMultiplier: 1,
    combatEdgeSharpness: 1,
    combatTerritoryEdgeFactor: 0.5,
  });
}

let lastTargetCounts = null;

function ensureGC() {
  if (typeof global.gc !== "function") {
    throw new Error("Run this script with `node --expose-gc` to enable manual GC.");
  }

  global.gc();
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main() {
  ensureGC();
  const before = process.memoryUsage().heapUsed;

  const { grid } = createGrid(120, 120);

  populateGrid(grid);
  saturateTargetPool(grid);

  ensureGC();
  const afterSaturation = process.memoryUsage().heapUsed;
  const poolSizeAfterSaturation = grid.getTargetDescriptorPoolSize
    ? grid.getTargetDescriptorPoolSize()
    : null;

  grid.resetWorld({ reseed: false, randomizeObstacles: false });
  ensureGC();
  const afterReset = process.memoryUsage().heapUsed;
  const poolSizeAfterReset = grid.getTargetDescriptorPoolSize
    ? grid.getTargetDescriptorPoolSize()
    : null;

  console.log(
    JSON.stringify(
      {
        before,
        afterSaturation,
        afterReset,
        deltaSaturation: afterSaturation - before,
        deltaReset: afterReset - before,
        beforeFormatted: formatBytes(before),
        afterSaturationFormatted: formatBytes(afterSaturation),
        afterResetFormatted: formatBytes(afterReset),
        deltaSaturationFormatted: formatBytes(afterSaturation - before),
        deltaResetFormatted: formatBytes(afterReset - before),
        targetCounts: lastTargetCounts,
        poolLengthEstimate: lastTargetCounts
          ? lastTargetCounts.mates + lastTargetCounts.enemies + lastTargetCounts.society
          : null,
        poolSizeAfterSaturation,
        poolSizeAfterReset,
      },
      null,
      2,
    ),
  );
}

main();
