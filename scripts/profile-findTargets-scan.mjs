import { performance } from "node:perf_hooks";

import GridManager from "../src/grid/gridManager.js";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onDeath() {},
    onBirth() {},
    recordPerformanceSample() {},
  },
  ctx: {},
  cellSize: 1,
};

class BenchmarkGridManager extends GridManager {
  init() {}
  consumeEnergy() {}
}

function createStubCell({
  id,
  sight = 0,
  allyThreshold = 0.8,
  enemyThreshold = 0.2,
  riskTolerance = 0.5,
} = {}) {
  const similarity = new Map();

  const cell = {
    id,
    sight,
    density: {
      enemyBias: { min: 0, max: 0 },
    },
    dna: {
      allyThreshold: () => allyThreshold,
      enemyThreshold: () => enemyThreshold,
      riskTolerance: () => riskTolerance,
    },
    getRiskTolerance: () => riskTolerance,
    setSimilarity(other, value) {
      if (!other) return;

      similarity.set(other.id, value);
    },
    similarityTo(other) {
      if (!other) return 0;

      return similarity.get(other.id) ?? 0;
    },
  };

  return cell;
}

function buildSparseScenario({ rows = 128, cols = 128, sight = 48 } = {}) {
  const gm = new BenchmarkGridManager(rows, cols, baseOptions);
  const origin = createStubCell({
    id: "origin",
    sight,
    allyThreshold: 0.7,
    enemyThreshold: 0.3,
  });

  gm.placeCell(Math.floor(rows / 2), Math.floor(cols / 2), origin);

  const originRow = origin.row;
  const originCol = origin.col;
  const occupancyRows = Array.from({ length: gm.rows }, () => new Set());

  for (let dist = 1; dist <= sight; dist++) {
    const topRow = originRow - dist;
    const bottomRow = originRow + dist;
    const rightCol = originCol + dist;
    const leftCol = originCol - dist;

    if (topRow >= 0) {
      const ally = createStubCell({ id: `ally-top-${dist}` });

      origin.setSimilarity(ally, 0.6);
      ally.setSimilarity(origin, 0.6);
      gm.placeCell(topRow, Math.min(gm.cols - 1, Math.max(0, rightCol)), ally);
      occupancyRows[topRow].add(ally.col);
    }

    if (bottomRow < gm.rows) {
      const enemy = createStubCell({ id: `enemy-bottom-${dist}` });

      origin.setSimilarity(enemy, 0.4);
      enemy.setSimilarity(origin, 0.4);
      gm.placeCell(bottomRow, Math.min(gm.cols - 1, Math.max(0, leftCol)), enemy);
      occupancyRows[bottomRow].add(enemy.col);
    }
  }

  return { gm, origin, occupancyRows };
}

function simulateLegacyScans({ occupancyRows, origin, gm }) {
  const row = origin.row;
  const col = origin.col;
  const sight = Math.max(0, Math.floor(origin.sight));
  const minRow = Math.max(0, row - sight);
  const maxRow = Math.min(gm.rows - 1, row + sight);
  const minCol = Math.max(0, col - sight);
  const maxCol = Math.min(gm.cols - 1, col + sight);
  let probes = 0;

  for (let dist = 1; dist <= sight; dist++) {
    const topRow = row - dist;

    if (topRow >= minRow) {
      const bucket = occupancyRows[topRow];

      if (bucket && bucket.size > 0) {
        const startCol = Math.max(minCol, col - dist);
        const endCol = Math.min(maxCol, col + dist);

        for (let newCol = startCol; newCol <= endCol; newCol++) {
          probes += 1;
          bucket.has(newCol);
        }
      }
    }

    const bottomRow = row + dist;

    if (bottomRow <= maxRow && bottomRow !== topRow) {
      const bucket = occupancyRows[bottomRow];

      if (bucket && bucket.size > 0) {
        const startCol = Math.max(minCol, col - dist);
        const endCol = Math.min(maxCol, col + dist);

        for (let newCol = startCol; newCol <= endCol; newCol++) {
          probes += 1;
          bucket.has(newCol);
        }
      }
    }
  }

  return probes;
}

function simulateOptimizedScans({ occupancyRows, origin, gm }) {
  const row = origin.row;
  const col = origin.col;
  const sight = Math.max(0, Math.floor(origin.sight));
  const minRow = Math.max(0, row - sight);
  const maxRow = Math.min(gm.rows - 1, row + sight);
  const minCol = Math.max(0, col - sight);
  const maxCol = Math.min(gm.cols - 1, col + sight);
  let probes = 0;

  const iterateRow = (targetRow, bucket, dist) => {
    if (!bucket || bucket.size === 0) return;

    const startCol = Math.max(minCol, col - dist);
    const endCol = Math.min(maxCol, col + dist);

    if (startCol > endCol) return;

    const rangeLength = endCol - startCol + 1;

    if (bucket.size < rangeLength && typeof bucket.values === "function") {
      for (const value of bucket.values()) {
        if (value < startCol || value > endCol) continue;

        probes += 1;
      }

      return;
    }

    for (let newCol = startCol; newCol <= endCol; newCol++) {
      probes += 1;
      bucket.has(newCol);
    }
  };

  for (let dist = 1; dist <= sight; dist++) {
    const topRow = row - dist;

    if (topRow >= minRow) {
      iterateRow(topRow, occupancyRows[topRow], dist);
    }

    const bottomRow = row + dist;

    if (bottomRow <= maxRow && bottomRow !== topRow) {
      iterateRow(bottomRow, occupancyRows[bottomRow], dist);
    }
  }

  return probes;
}

async function run() {
  const { gm, origin, occupancyRows } = buildSparseScenario();

  // Warm up the cache to avoid constructor overhead in measurements.
  gm.findTargets(origin.row, origin.col, origin);

  const iterations = 200;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    gm.findTargets(origin.row, origin.col, origin);
  }

  const elapsed = performance.now() - start;
  const legacyProbes = simulateLegacyScans({ occupancyRows, origin, gm });
  const optimizedProbes = simulateOptimizedScans({ occupancyRows, origin, gm });
  const savings = legacyProbes - optimizedProbes;
  const reduction = legacyProbes > 0 ? (savings / legacyProbes) * 100 : 0;

  console.log("findTargets sparse-row benchmark");
  console.log(`legacy-style column probes: ${legacyProbes}`);
  console.log(`optimized column probes: ${optimizedProbes}`);
  console.log(
    `probe reduction: ${savings} (${reduction.toFixed(2)}% fewer column checks)`,
  );
  console.log(
    `optimized findTargets runtime: ${elapsed.toFixed(2)}ms over ${iterations} iterations`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
