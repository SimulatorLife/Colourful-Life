import GridManager from "../src/grid/gridManager.js";

function createStatsStub() {
  return {
    resetTick() {},
    logEvent() {},
    setMutationMultiplier() {},
  };
}

class ProfilingGridManager extends GridManager {
  constructor(rows, cols, options = {}) {
    super(rows, cols, { ...options, stats: options.stats ?? createStatsStub() });
  }

  setMatingDiversityOptions() {}

  prepareTick() {
    return { densityGrid: this.densityGrid };
  }

  processCell(row, col, { processed } = {}) {
    const cell = this.grid[row]?.[col];

    if (!cell || !processed) {
      return;
    }

    if (processed.has(cell)) {
      return;
    }

    processed.add(cell);
  }

  buildSnapshot() {
    return {
      rows: this.rows,
      cols: this.cols,
      population: this.activeCells?.size ?? 0,
      totalEnergy: 0,
      totalAge: 0,
      maxFitness: 0,
      entries: [],
      brainSnapshots: [],
      populationScarcity: 0,
    };
  }
}

function createStubCell(initialEnergy) {
  return {
    age: 0,
    energy: initialEnergy,
    lifespan: 100,
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    matingAttempts: 0,
    matingSuccesses: 0,
    diverseMateScore: 0,
    complementaryMateScore: 0,
    similarityPenalty: 0,
    strategyPenalty: 0,
  };
}

function populate(manager) {
  const { rows, cols } = manager;
  const energy = manager.maxTileEnergy;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      manager.placeCell(r, c, createStubCell(energy));
    }
  }
}

function profile({ rows = 48, cols = 48, iterations = 200 } = {}) {
  const manager = new ProfilingGridManager(rows, cols);

  populate(manager);

  if (global.gc) {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;
  let peak = before;

  for (let i = 0; i < iterations; i += 1) {
    manager.update();
    const { heapUsed } = process.memoryUsage();

    if (heapUsed > peak) {
      peak = heapUsed;
    }
  }

  if (global.gc) {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return { rows, cols, iterations, before, peak, after };
}

const result = profile({
  rows: Number.parseInt(process.env.PROFILE_ROWS ?? "48", 10) || 48,
  cols: Number.parseInt(process.env.PROFILE_COLS ?? "48", 10) || 48,
  iterations: Number.parseInt(process.env.PROFILE_ITERS ?? "200", 10) || 200,
});

console.log(JSON.stringify(result));
