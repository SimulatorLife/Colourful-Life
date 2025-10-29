import GridManager from "../src/grid/gridManager.js";
import DNA from "../src/genome.js";

function createStatsStub() {
  return {
    onBirth() {},
    recordMateChoice() {},
    recordReproductionBlocked() {},
    getDiversityPressure() {
      return 0;
    },
    getBehavioralEvenness() {
      return 0;
    },
    getStrategyPressure() {
      return 0;
    },
    matingDiversityThreshold: 0.3,
    diversityPressure: 0,
    behavioralEvenness: 0,
    strategyPressure: 0,
  };
}

function createGrid() {
  const stats = createStatsStub();
  const grid = new GridManager(6, 6, {
    stats,
    rng: () => 0.5,
  });

  grid.stats = stats;
  grid.populationScarcitySignal = 0;
  grid.densityGrid = Array.from({ length: grid.rows }, () =>
    Array.from({ length: grid.cols }, () => 0),
  );

  const parent = grid.spawnCell(2, 2, {
    dna: DNA.random(() => 0.5),
    spawnEnergy: grid.maxTileEnergy,
  });
  const mate = grid.spawnCell(2, 3, {
    dna: DNA.random(() => 0.5),
    spawnEnergy: grid.maxTileEnergy,
  });

  const makeDeterministicRng = () => () => 0;

  parent.resolveSharedRng = () => makeDeterministicRng();
  mate.resolveSharedRng = () => makeDeterministicRng();
  parent.resolveRng = () => makeDeterministicRng();
  mate.resolveRng = () => makeDeterministicRng();

  return { grid, parent, mate, stats };
}

function resetParents(grid, parent, mate) {
  const energy = grid.maxTileEnergy;

  parent.energy = energy;
  mate.energy = energy;
  parent.reproductionCooldown = 0;
  mate.reproductionCooldown = 0;
  parent.age = 0;
  mate.age = 0;
  parent.lastEventPressure = 0;
  mate.lastEventPressure = 0;
}

function performReproduction(grid, parent, mate, stats) {
  resetParents(grid, parent, mate);

  const targets = grid.findTargets(parent.row, parent.col, parent, {
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
  });

  grid.handleReproduction(parent.row, parent.col, parent, targets, {
    stats,
    densityGrid: grid.densityGrid,
    densityEffectMultiplier: 1,
    mutationMultiplier: 1,
  });

  for (const cell of Array.from(grid.activeCells)) {
    if (cell !== parent && cell !== mate) {
      grid.removeCell(cell.row, cell.col);
    }
  }
}

function measure(iterations) {
  const { grid, parent, mate, stats } = createGrid();
  const warmup = Math.min(200, Math.floor(iterations / 10));

  for (let i = 0; i < warmup; i += 1) {
    performReproduction(grid, parent, mate, stats);
  }

  if (typeof global.gc === "function") {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i += 1) {
    performReproduction(grid, parent, mate, stats);
  }

  if (typeof global.gc === "function") {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return {
    iterations,
    warmup,
    before,
    after,
    delta: after - before,
  };
}

const iterations = Number.parseInt(process.argv[2] ?? "4000", 10);
const result = measure(
  Number.isFinite(iterations) && iterations > 0 ? iterations : 4000,
);

console.log(JSON.stringify(result));
