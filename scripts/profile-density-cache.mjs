import { performance as nodePerformance } from "node:perf_hooks";

const performanceApi =
  typeof globalThis.performance === "object" &&
  typeof globalThis.performance?.now === "function"
    ? globalThis.performance
    : (nodePerformance ?? { now: () => Date.now() });

if (
  typeof globalThis.performance !== "object" ||
  typeof globalThis.performance.now !== "function"
) {
  globalThis.performance = performanceApi;
}

const [{ default: GridManager }, { default: DNA }, { createRNG }] = await Promise.all([
  import("../src/grid/gridManager.js"),
  import("../src/genome.js"),
  import("../src/utils/math.js"),
]);

const rng = createRNG(1234);
const rows = 80;
const cols = 80;
const grid = new GridManager(rows, cols, {
  rng,
  stats: { onBirth() {}, onDeath() {} },
  ctx: { clearRect() {}, fillRect() {}, strokeRect() {} },
});

const totalCells = rows * cols;
const spawnCount = Math.floor(totalCells * 0.55);
const coordinates = [];

for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    coordinates.push([r, c]);
  }
}

for (let i = coordinates.length - 1; i > 0; i--) {
  const swapIndex = Math.floor(rng() * (i + 1));
  const temp = coordinates[i];

  coordinates[i] = coordinates[swapIndex];
  coordinates[swapIndex] = temp;
}

const maxEnergy =
  grid.maxTileEnergy > 0 ? grid.maxTileEnergy : GridManager.maxTileEnergy;
const spawnEnergy = maxEnergy * 0.5;

for (let i = 0; i < spawnCount; i++) {
  const [row, col] = coordinates[i];
  const dna = DNA.random(rng);

  grid.spawnCell(row, col, { dna, spawnEnergy, recordBirth: true });
}

grid.rebuildActiveCells();
grid.recalculateDensityCounts();

const displacedSample = coordinates.slice(
  spawnCount,
  spawnCount + Math.floor(totalCells * 0.1),
);

for (let i = 0; i < displacedSample.length; i++) {
  const [row, col] = displacedSample[i];
  const occupant = grid.getCell(row, col);

  if (occupant) {
    grid.removeCell(row, col);
    grid.spawnCell((row + 1) % rows, (col + 1) % cols, {
      dna: occupant.dna,
      spawnEnergy,
    });
  }
}

const targets = [];
const targetCount = 50000;

for (let i = 0; i < targetCount; i++) {
  const idx = Math.floor(rng() * coordinates.length);
  const [row, col] = coordinates[idx];

  targets.push([row, col]);
}

const localRadius = grid.densityRadius;

const oldGetDensityAt = (row, col) => {
  if (grid.densityGrid?.[row]?.[col] != null) {
    return grid.densityGrid[row][col];
  }

  return grid.localDensity(row, col, localRadius);
};

let warm = 0;

for (let i = 0; i < 1000; i++) {
  const [row, col] = targets[i % targets.length];

  warm += oldGetDensityAt(row, col);
}

for (let i = 0; i < 1000; i++) {
  const [row, col] = targets[i % targets.length];

  warm += grid.getDensityAt(row, col);
}

const baselineStart = performanceApi.now();
let baselineSum = 0;

for (let i = 0; i < targetCount; i++) {
  const [row, col] = targets[i];

  baselineSum += oldGetDensityAt(row, col);
}

const baselineDuration = performanceApi.now() - baselineStart;

const cachedStart = performanceApi.now();
let cachedSum = 0;

for (let i = 0; i < targetCount; i++) {
  const [row, col] = targets[i];

  cachedSum += grid.getDensityAt(row, col);
}

const cachedDuration = performanceApi.now() - cachedStart;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      spawnCount,
      targetCount,
      baselineDuration,
      cachedDuration,
      improvementMs: baselineDuration - cachedDuration,
      improvementPct:
        baselineDuration > 0
          ? ((baselineDuration - cachedDuration) / baselineDuration) * 100
          : 0,
      baselineSum,
      cachedSum,
      warm,
    },
    null,
    2,
  ),
);
