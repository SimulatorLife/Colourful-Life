import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

test("GridManager.tryMove updates a cell's stored coordinates", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  const dna = new DNA(10, 20, 30);
  const cell = new Cell(0, 0, dna, 5);
  const grid = [[cell, null]];

  const moved = GridManager.tryMove(grid, 0, 0, 0, 1, 1, 2);

  assert.ok(moved);
  assert.is(grid[0][0], null);
  assert.is(grid[0][1], cell);
  assert.is(cell.row, 0);
  assert.is(cell.col, 1);
});

test("GridManager.tryMove ignores empty sources without mutating density data", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(2, 2, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  const initialCounts = gm.densityCounts.map((row) => row.slice());
  const initialDirtySize = gm.densityDirtyTiles.size;
  const initialActiveSize = gm.activeCells.size;

  const onMoveCalls = [];
  const onCellMovedCalls = [];

  const moved = GridManager.tryMove(gm.grid, 0, 0, 0, 1, gm.rows, gm.cols, {
    obstacles: gm.obstacles,
    onMove: (payload) => onMoveCalls.push(payload),
    onCellMoved: (...args) => onCellMovedCalls.push(args),
    activeCells: gm.activeCells,
  });

  assert.is(moved, false);
  assert.is(onMoveCalls.length, 0);
  assert.is(onCellMovedCalls.length, 0);
  assert.is(gm.grid[0][0], null);
  assert.is(gm.grid[0][1], null);
  assert.equal(gm.densityCounts, initialCounts);
  assert.is(gm.densityDirtyTiles.size, initialDirtySize);
  assert.is(gm.activeCells.size, initialActiveSize);
});

test("setObstacle with evict=false preserves the occupant and clears tile energy", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let deaths = 0;
  const gm = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    stats: {
      onBirth() {},
      onDeath() {
        deaths += 1;
      },
      recordMateChoice() {},
    },
  });

  const dna = new DNA(10, 20, 30);
  const cell = new Cell(0, 0, dna, 5);

  gm.setCell(0, 0, cell);

  gm.energyGrid[0][0] = 7;
  gm.energyNext[0][0] = 3;

  gm.setObstacle(0, 0, true, { evict: false });

  assert.is(gm.getCell(0, 0), cell);
  assert.is(deaths, 0);
  assert.is(gm.energyGrid[0][0], 0);
  assert.is(gm.energyNext[0][0], 0);
  assert.is(gm.isObstacle(0, 0), true);
});

test("Breeding uses the mover's refreshed coordinates for offspring placement", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  const dnaA = new DNA(40, 80, 120);
  const dnaB = new DNA(60, 90, 150);
  const parentA = new Cell(0, 0, dnaA, 10);
  const parentB = new Cell(0, 2, dnaB, 10);
  const grid = [[parentA, null, parentB]];

  const moved = GridManager.tryMove(grid, 0, 0, 0, 1, 1, 3);

  assert.ok(moved);
  assert.is(parentA.row, 0);
  assert.is(parentA.col, 1);
  assert.is(grid[0][1], parentA);

  const offspring = Cell.breed(parentA, parentB);

  grid[parentA.row][parentA.col] = offspring;

  assert.is(offspring.row, parentA.row);
  assert.is(offspring.col, parentA.col);
  assert.is(grid[0][1], offspring);
});

test("handleReproduction returns false when offspring cannot be placed", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      gm.setObstacle(r, c, true, { evict: false });
    }
  }
  gm.setObstacle(1, 1, false);
  gm.setObstacle(1, 2, false);
  gm.densityGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0));

  const parent = new Cell(1, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(1, 2, new DNA(0, 0, 0), MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.dna.parentalInvestmentFrac = () => 0.5;
  mate.dna.parentalInvestmentFrac = () => 0.5;
  parent.dna.starvationThresholdFrac = () => 0;
  mate.dna.starvationThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(1, 1, parent);
  gm.setCell(1, 2, mate);

  let births = 0;
  let recorded = null;
  const stats = {
    onBirth: () => {
      births += 1;
    },
    onDeath: () => {},
    recordMateChoice: (data) => {
      recorded = data;
    },
  };

  const originalRandom = Math.random;

  Math.random = () => 0.99;

  try {
    const reproduced = gm.handleReproduction(
      1,
      1,
      parent,
      { mates: [mateEntry], society: [] },
      { stats, densityGrid: gm.densityGrid, densityEffectMultiplier: 1 },
    );

    assert.is(reproduced, false);
  } finally {
    Math.random = originalRandom;
  }

  assert.is(births, 0);
  assert.ok(recorded);
  assert.is(recorded.success, false);
});

test("handleReproduction requires parents to be adjacent before spawning", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let blockReason = null;
  const stats = {
    onBirth() {
      births += 1;
    },
    onDeath() {},
    recordMateChoice() {},
    recordReproductionBlocked(info) {
      blockReason = info?.reason ?? null;
    },
  };

  const gm = new TestGridManager(1, 6, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.rebuildActiveCells();

  const densityGrid = Array.from({ length: 1 }, () =>
    Array.from({ length: 6 }, () => 0),
  );

  const parent = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(0, 5, new DNA(0, 0, 0), MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.dna.parentalInvestmentFrac = () => 0.5;
  mate.dna.parentalInvestmentFrac = () => 0.5;
  parent.dna.starvationThresholdFrac = () => 0;
  mate.dna.starvationThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 1, parent);
  gm.setCell(0, 5, mate);

  const originalRandom = Math.random;

  Math.random = () => 0;

  let reproduced = null;

  try {
    reproduced = gm.handleReproduction(
      0,
      1,
      parent,
      { mates: [mateEntry], society: [] },
      {
        stats,
        densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.is(reproduced, false);
  assert.is(births, 0);
  assert.is(blockReason, "Parents out of reach");
  assert.is(parent.row, 0);
  assert.is(parent.col, 2);
  assert.is(gm.getCell(0, 2), parent);
  assert.is(gm.getCell(0, 5), mate);
});

test("handleReproduction enforces reproduction energy thresholds", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  const stats = {
    onBirth: () => {
      births += 1;
    },
    onDeath() {},
    recordMateChoice() {},
  };

  const gm = new TestGridManager(2, 3, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.rebuildActiveCells();

  const densityGrid = Array.from({ length: 2 }, () =>
    Array.from({ length: 3 }, () => 0),
  );

  const dnaA = new DNA(0, 0, 0);
  const dnaB = new DNA(0, 0, 0);

  dnaA.reproductionThresholdFrac = () => 0.6;
  dnaB.reproductionThresholdFrac = () => 0.3;
  dnaA.parentalInvestmentFrac = () => 0.5;
  dnaB.parentalInvestmentFrac = () => 0.5;
  dnaA.starvationThresholdFrac = () => 0.05;
  dnaB.starvationThresholdFrac = () => 0.05;

  const parent = new Cell(0, 1, dnaA, MAX_TILE_ENERGY * 0.55);
  const mate = new Cell(0, 2, dnaB, MAX_TILE_ENERGY * 0.75);
  const parentEnergyBefore = parent.energy;
  const mateEnergyBefore = mate.energy;

  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 1, parent);
  gm.setCell(0, 2, mate);

  const originalRandom = Math.random;

  Math.random = () => 0;

  let reproduced;

  try {
    reproduced = gm.handleReproduction(
      0,
      1,
      parent,
      {
        mates: [mateEntry],
        society: [],
      },
      {
        stats,
        densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.is(reproduced, false);
  assert.is(births, 0);

  const energyTolerance = MAX_TILE_ENERGY * 0.01; // reproduction failure should not drain meaningful energy

  assert.ok(
    Math.abs(parent.energy - parentEnergyBefore) <= energyTolerance,
    "parent energy should stay near the pre-check level",
  );
  assert.ok(
    Math.abs(mate.energy - mateEnergyBefore) <= energyTolerance,
    "mate energy should stay near the pre-check level",
  );
});

test("handleReproduction succeeds when DNA grants extended reach", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let blockReason = null;
  const stats = {
    onBirth() {
      births += 1;
    },
    onDeath() {},
    recordMateChoice() {},
    recordReproductionBlocked(info) {
      blockReason = info?.reason ?? null;
    },
  };

  const gm = new TestGridManager(1, 6, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.rebuildActiveCells();

  const densityGrid = Array.from({ length: 1 }, () =>
    Array.from({ length: 6 }, () => 0),
  );

  const parentDNA = new DNA(0, 0, 0);

  parentDNA.reproductionThresholdFrac = () => 0;
  parentDNA.parentalInvestmentFrac = () => 0.5;
  parentDNA.starvationThresholdFrac = () => 0;
  parentDNA.reproductionReachProfile = () => ({
    base: 3,
    min: 1.5,
    max: 3.2,
    densityPenalty: 0.05,
    energyBonus: 0.2,
    scarcityBoost: 0.3,
    affinityWeight: 0.25,
  });
  const mateDNA = new DNA(0, 0, 0);

  mateDNA.reproductionThresholdFrac = () => 0;
  mateDNA.parentalInvestmentFrac = () => 0.5;
  mateDNA.starvationThresholdFrac = () => 0;
  mateDNA.reproductionReachProfile = () => ({
    base: 2.6,
    min: 1.2,
    max: 3,
    densityPenalty: 0.1,
    energyBonus: 0.25,
    scarcityBoost: 0.25,
    affinityWeight: 0.2,
  });

  const parent = new Cell(0, 1, parentDNA, MAX_TILE_ENERGY);
  const mate = new Cell(0, 4, mateDNA, MAX_TILE_ENERGY);

  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 1, parent);
  gm.setCell(0, 4, mate);

  const originalRandom = Math.random;

  Math.random = () => 0;

  let reproduced = null;

  try {
    reproduced = gm.handleReproduction(
      0,
      1,
      parent,
      { mates: [mateEntry], society: [] },
      {
        stats,
        densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.is(reproduced, true);
  assert.is(births, 1);
  assert.is(blockReason, null);
});

test("handleReproduction does not wrap offspring placement across map edges", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  gm.rebuildActiveCells();
  const densityGrid = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => 0),
  );

  const parent = new Cell(0, 0, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.dna.starvationThresholdFrac = () => 0;
  mate.dna.starvationThresholdFrac = () => 0;
  parent.dna.parentalInvestmentFrac = () => 0.5;
  mate.dna.parentalInvestmentFrac = () => 0.5;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 0, parent);
  gm.setCell(0, 1, mate);

  gm.setObstacle(1, 1, true, { evict: false });
  gm.setObstacle(0, 2, true, { evict: false });
  gm.setObstacle(1, 2, true, { evict: false });

  const stats = {
    births: 0,
    onBirth() {
      this.births += 1;
    },
    onDeath() {},
    recordMateChoice() {},
  };

  const originalRandom = Math.random;

  Math.random = () => 0;

  try {
    gm.handleReproduction(
      0,
      0,
      parent,
      { mates: [mateEntry], society: [] },
      { stats, densityGrid, densityEffectMultiplier: 1, mutationMultiplier: 1 },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.is(stats.births, 1);
  assert.ok(
    gm.grid[1][0],
    "expected a new offspring in-bounds adjacent to the parents",
  );
  assert.is(
    gm.grid[2][2],
    null,
    "offspring should not appear on the wrapped opposite corner",
  );
});

test("handleReproduction bases reproduction decisions on the post-move density", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(1, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  const densityGrid = [[0.1, 0.75, 0.2]];

  const parentDNA = new DNA(0, 0, 0);

  parentDNA.reproductionReachProfile = () => ({
    base: 2.4,
    min: 1.2,
    max: 3,
    densityPenalty: 0.08,
    energyBonus: 0.25,
    scarcityBoost: 0.25,
    affinityWeight: 0.22,
  });
  const mateDNA = new DNA(0, 0, 0);

  mateDNA.reproductionReachProfile = () => ({
    base: 2.2,
    min: 1.1,
    max: 2.8,
    densityPenalty: 0.1,
    energyBonus: 0.25,
    scarcityBoost: 0.25,
    affinityWeight: 0.2,
  });
  const parent = new Cell(0, 0, parentDNA, MAX_TILE_ENERGY);
  const mate = new Cell(0, 2, mateDNA, MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;

  gm.setCell(0, 0, parent);
  gm.setCell(0, 2, mate);
  gm.densityGrid = densityGrid;

  const candidate = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: candidate,
    evaluated: [candidate],
    mode: "preference",
  });
  parent.findBestMate = () => candidate;

  const stats = {
    onBirth() {},
    onDeath() {},
    recordMateChoice() {},
  };

  const computeContexts = [];
  let decideContext = null;

  parent.computeReproductionProbability = (target, context) => {
    computeContexts.push(context);

    return 0;
  };
  parent.decideReproduction = (target, context) => {
    decideContext = context;

    return { probability: context.baseProbability ?? 0 };
  };

  const reproduced = gm.handleReproduction(
    0,
    0,
    parent,
    { mates: [candidate], society: [] },
    {
      stats,
      densityGrid,
      densityEffectMultiplier: 1,
      mutationMultiplier: 1,
    },
  );

  assert.is(reproduced, false);
  assert.is(parent.row, 0);
  assert.is(parent.col, 1);
  assert.is(gm.grid[0][1], parent);
  assert.ok(computeContexts.length > 0, "reproduction probability should be evaluated");
  assert.is(computeContexts[0].localDensity, densityGrid[0][1]);
  assert.ok(decideContext, "reproduction decision should be evaluated");
  assert.is(decideContext.localDensity, densityGrid[0][1]);
});

test("handleReproduction throttles near-clone pairings below the diversity floor", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let recorded = null;
  const stats = {
    onBirth() {
      births += 1;
    },
    onDeath() {},
    recordMateChoice(data) {
      recorded = data;
    },
    matingDiversityThreshold: 0.3,
  };

  const gm = new TestGridManager(1, 3, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.setMatingDiversityOptions({ threshold: 0.3, lowDiversityMultiplier: 0 });

  const parent = new Cell(0, 0, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  mateEntry.diversity = 0.01;
  mateEntry.similarity = 0.99;
  mateEntry.selectionWeight = 1;
  mateEntry.preferenceScore = 1;

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 0, parent);
  gm.setCell(0, 1, mate);
  gm.densityGrid = [[0, 0, 0]];

  const originalRandom = Math.random;

  Math.random = () => 0;

  try {
    gm.handleReproduction(
      0,
      0,
      parent,
      { mates: [mateEntry], society: [] },
      {
        stats,
        densityGrid: gm.densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.ok(recorded);
  assert.is(recorded.success, births > 0);
  assert.is(recorded.penalized, true);
  assert.ok(recorded.penaltyMultiplier >= 0);
  assert.ok(
    recorded.penaltyMultiplier < 0.85,
    `expected some penalty pressure, got ${recorded.penaltyMultiplier}`,
  );
});

test("handleReproduction strengthens low-diversity penalties when global pressure spikes", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const runScenario = async (pressure) => {
    const records = [];
    const stats = {
      onBirth() {},
      onDeath() {},
      recordMateChoice(data) {
        records.push(data);
      },
      matingDiversityThreshold: 0.4,
      getDiversityPressure: () => pressure,
    };

    const gm = new TestGridManager(1, 3, {
      eventManager: { activeEvents: [] },
      stats,
    });

    gm.setMatingDiversityOptions({ threshold: 0.4, lowDiversityMultiplier: 0.5 });

    const parent = new Cell(0, 0, new DNA(0, 0, 0), MAX_TILE_ENERGY);
    const mate = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);

    parent.dna.reproductionThresholdFrac = () => 0;
    mate.dna.reproductionThresholdFrac = () => 0;
    parent.computeReproductionProbability = () => 1;
    parent.decideReproduction = () => ({ probability: 1 });

    const mateEntry = parent.evaluateMateCandidate({
      row: mate.row,
      col: mate.col,
      target: mate,
    }) || {
      target: mate,
      row: mate.row,
      col: mate.col,
      similarity: 1,
      diversity: 0,
      selectionWeight: 1,
      preferenceScore: 1,
    };

    mateEntry.diversity = 0.05;
    mateEntry.similarity = 0.95;

    parent.selectMateWeighted = () => ({
      chosen: mateEntry,
      evaluated: [mateEntry],
      mode: "preference",
    });
    parent.findBestMate = () => mateEntry;

    gm.setCell(0, 0, parent);
    gm.setCell(0, 1, mate);
    gm.densityGrid = [[0, 0, 0]];

    const originalRandom = Math.random;

    Math.random = () => 0.99;

    try {
      gm.handleReproduction(
        0,
        0,
        parent,
        { mates: [mateEntry], society: [] },
        {
          stats,
          densityGrid: gm.densityGrid,
          densityEffectMultiplier: 1,
          mutationMultiplier: 1,
        },
      );
    } finally {
      Math.random = originalRandom;
    }

    assert.is(records.length, 1);

    return records[0]?.penaltyMultiplier ?? 1;
  };

  const lowPressure = await runScenario(0);
  const highPressure = await runScenario(0.9);

  assert.ok(
    highPressure < lowPressure,
    "penalty multiplier should shrink under high pressure",
  );
  assert.ok(highPressure < 1, "penalty multiplier should remain a dampening factor");
});

test("behavioral evenness amplifies low-diversity penalties", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const runScenario = async (behaviorEvenness) => {
    const records = [];
    const stats = {
      onBirth() {},
      onDeath() {},
      recordMateChoice(data) {
        records.push(data);
      },
      matingDiversityThreshold: 0.45,
      getDiversityPressure: () => 0.3,
      getBehavioralEvenness: () => behaviorEvenness,
    };

    const gm = new TestGridManager(1, 3, {
      eventManager: { activeEvents: [] },
      stats,
    });

    gm.setMatingDiversityOptions({ threshold: 0.45, lowDiversityMultiplier: 0.6 });

    const parent = new Cell(0, 0, new DNA(0, 0, 0), MAX_TILE_ENERGY);
    const mate = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);

    parent.dna.reproductionThresholdFrac = () => 0;
    mate.dna.reproductionThresholdFrac = () => 0;
    parent.computeReproductionProbability = () => 1;
    parent.decideReproduction = () => ({ probability: 1 });

    const mateEntry = parent.evaluateMateCandidate({
      row: mate.row,
      col: mate.col,
      target: mate,
    }) || {
      target: mate,
      row: mate.row,
      col: mate.col,
      similarity: 1,
      diversity: 0,
      selectionWeight: 1,
      preferenceScore: 1,
    };

    mateEntry.diversity = 0.05;
    mateEntry.similarity = 0.95;

    parent.selectMateWeighted = () => ({
      chosen: mateEntry,
      evaluated: [mateEntry],
      mode: "preference",
    });
    parent.findBestMate = () => mateEntry;

    gm.setCell(0, 0, parent);
    gm.setCell(0, 1, mate);
    gm.densityGrid = [[0, 0, 0]];

    const originalRandom = Math.random;

    Math.random = () => 0.99;

    try {
      gm.handleReproduction(
        0,
        0,
        parent,
        { mates: [mateEntry], society: [] },
        {
          stats,
          densityGrid: gm.densityGrid,
          densityEffectMultiplier: 1,
          mutationMultiplier: 1,
        },
      );
    } finally {
      Math.random = originalRandom;
    }

    return records[0]?.penaltyMultiplier ?? 1;
  };

  const balanced = await runScenario(0.85);
  const collapsed = await runScenario(0.1);

  assert.ok(collapsed < balanced, "lower evenness should intensify penalties");
  assert.ok(collapsed < 1, "penalty multiplier should remain below neutral");
});

test("low-diversity penalties respond to mate preferences and environment", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const records = [];
  const stats = {
    onBirth() {},
    onDeath() {},
    recordMateChoice(data) {
      records.push(data);
    },
    matingDiversityThreshold: 0.45,
  };

  const makeManager = () =>
    new TestGridManager(1, 3, {
      eventManager: { activeEvents: [] },
      stats,
    });

  const originalRandom = Math.random;

  Math.random = () => 0.99;

  try {
    const diversitySeeking = makeManager();

    diversitySeeking.setMatingDiversityOptions({
      threshold: 0.45,
      lowDiversityMultiplier: 0.1,
    });

    diversitySeeking.densityGrid = [[0.9, 0.9, 0.9]];
    diversitySeeking.energyGrid = [
      [MAX_TILE_ENERGY * 0.2, MAX_TILE_ENERGY * 0.2, MAX_TILE_ENERGY * 0.2],
    ];
    diversitySeeking.energyDeltaGrid = [[-0.3, -0.3, -0.3]];

    const seeker = new Cell(0, 0, new DNA(120, 200, 240), MAX_TILE_ENERGY);
    const seekerMate = new Cell(0, 1, new DNA(118, 198, 238), MAX_TILE_ENERGY);

    seeker.diversityAppetite = 1;
    seekerMate.diversityAppetite = 1;
    seeker.matePreferenceBias = -1;
    seekerMate.matePreferenceBias = -1;
    seeker.dna.reproductionThresholdFrac = () => 0.25;
    seekerMate.dna.reproductionThresholdFrac = () => 0.25;
    seeker.computeReproductionProbability = () => 1;
    seeker.decideReproduction = () => ({ probability: 1 });

    const seekerEntry = seeker.evaluateMateCandidate({
      row: seekerMate.row,
      col: seekerMate.col,
      target: seekerMate,
    }) || {
      target: seekerMate,
      row: seekerMate.row,
      col: seekerMate.col,
      similarity: 0.92,
      diversity: 0.08,
      selectionWeight: 1,
      preferenceScore: 1,
    };

    seekerEntry.diversity = Math.min(seekerEntry.diversity ?? 0.08, 0.1);
    seekerEntry.similarity = Math.max(seekerEntry.similarity ?? 0.92, 0.9);
    seeker.selectMateWeighted = () => ({
      chosen: seekerEntry,
      evaluated: [seekerEntry],
      mode: "preference",
    });
    seeker.findBestMate = () => seekerEntry;

    diversitySeeking.setCell(0, 0, seeker);
    diversitySeeking.setCell(0, 1, seekerMate);

    diversitySeeking.handleReproduction(
      0,
      0,
      seeker,
      { mates: [seekerEntry], society: [] },
      {
        stats,
        densityGrid: diversitySeeking.densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );

    const kinComfort = makeManager();

    kinComfort.setMatingDiversityOptions({
      threshold: 0.45,
      lowDiversityMultiplier: 0.1,
    });

    kinComfort.densityGrid = [[0.05, 0.05, 0.05]];
    kinComfort.energyGrid = [[MAX_TILE_ENERGY, MAX_TILE_ENERGY, MAX_TILE_ENERGY]];
    kinComfort.energyDeltaGrid = [[0.2, 0.2, 0.2]];

    const kinLover = new Cell(0, 0, new DNA(40, 80, 60), MAX_TILE_ENERGY);
    const kinMate = new Cell(0, 1, new DNA(42, 82, 62), MAX_TILE_ENERGY);

    kinLover.diversityAppetite = 0;
    kinMate.diversityAppetite = 0;
    kinLover.matePreferenceBias = 1;
    kinMate.matePreferenceBias = 1;
    kinLover.dna.reproductionThresholdFrac = () => 0.4;
    kinMate.dna.reproductionThresholdFrac = () => 0.4;
    kinLover.computeReproductionProbability = () => 1;
    kinLover.decideReproduction = () => ({ probability: 1 });

    const kinEntry = kinLover.evaluateMateCandidate({
      row: kinMate.row,
      col: kinMate.col,
      target: kinMate,
    }) || {
      target: kinMate,
      row: kinMate.row,
      col: kinMate.col,
      similarity: 0.92,
      diversity: 0.08,
      selectionWeight: 1,
      preferenceScore: 1,
    };

    kinEntry.diversity = Math.min(kinEntry.diversity ?? 0.08, 0.1);
    kinEntry.similarity = Math.max(kinEntry.similarity ?? 0.92, 0.9);
    kinLover.selectMateWeighted = () => ({
      chosen: kinEntry,
      evaluated: [kinEntry],
      mode: "preference",
    });
    kinLover.findBestMate = () => kinEntry;

    kinComfort.setCell(0, 0, kinLover);
    kinComfort.setCell(0, 1, kinMate);

    kinComfort.handleReproduction(
      0,
      0,
      kinLover,
      { mates: [kinEntry], society: [] },
      {
        stats,
        densityGrid: kinComfort.densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );
  } finally {
    Math.random = originalRandom;
  }

  assert.is(records.length, 2);

  const [diversityRecord, kinRecord] = records;

  assert.ok(diversityRecord.penalized);
  assert.ok(kinRecord.penalized);
  assert.ok(
    diversityRecord.penaltyMultiplier < kinRecord.penaltyMultiplier,
    "diversity-seeking pair should impose a stronger penalty than kin-preferring pair",
  );
  assert.ok(
    diversityRecord.penaltyMultiplier <= 0.25,
    `expected diversity seekers to push multiplier near floor, got ${diversityRecord.penaltyMultiplier}`,
  );
  assert.ok(
    kinRecord.penaltyMultiplier >= 0.7,
    `expected kin-friendly pair to retain high multiplier, got ${kinRecord.penaltyMultiplier}`,
  );
});

test("strategy pressure dampens homogeneous pair reproduction even above diversity threshold", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const records = [];
  const stats = {
    onBirth() {},
    onDeath() {},
    getBehavioralEvenness: () => 0.25,
    getDiversityPressure: () => 0.15,
    getStrategyPressure: () => 0.8,
    recordMateChoice(data) {
      records.push(data);
    },
    matingDiversityThreshold: 0.3,
  };

  const gm = new TestGridManager(1, 2, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.setMatingDiversityOptions({ threshold: 0.3, lowDiversityMultiplier: 0.1 });

  const parent = new Cell(0, 0, new DNA(10, 20, 30), MAX_TILE_ENERGY);
  const mate = new Cell(0, 1, new DNA(12, 22, 32), MAX_TILE_ENERGY);

  parent.interactionGenes = { cooperate: 0.9, fight: 0.05, avoid: 0.15 };
  mate.interactionGenes = { cooperate: 0.9, fight: 0.05, avoid: 0.15 };
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });
  parent.resolveSharedRng = () => () => 0;

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 0.5,
    diversity: 0.5,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  mateEntry.similarity = 0.5;
  mateEntry.diversity = 0.5;

  gm.setCell(0, 0, parent);
  gm.setCell(0, 1, mate);
  gm.densityGrid = [[0.1, 0.1]];
  gm.energyGrid = [[MAX_TILE_ENERGY, MAX_TILE_ENERGY]];
  gm.energyDeltaGrid = [[0, 0]];

  gm.handleReproduction(
    0,
    0,
    parent,
    { mates: [mateEntry], society: [] },
    {
      stats,
      densityGrid: gm.densityGrid,
      densityEffectMultiplier: 1,
      mutationMultiplier: 1,
    },
  );

  assert.ok(records.length >= 1, "expected reproduction attempt to be recorded");
  const [record] = records;

  assert.ok(record.penalized, "strategy pressure should mark pairing penalized");
  assert.ok(
    record.strategyPenaltyMultiplier < 1,
    `expected strategy penalty multiplier below 1, got ${record.strategyPenaltyMultiplier}`,
  );
  approxEqual(
    record.penaltyMultiplier,
    record.strategyPenaltyMultiplier,
    1e-9,
    "no genetic penalty should leave combined multiplier equal to strategy penalty",
  );
  assert.ok(
    parent.strategyPenalty > 0,
    "parent should accumulate strategy penalty exposure",
  );
});

test("handleReproduction leaves diverse pairs unaffected by low-diversity penalties", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let recorded = null;
  const stats = {
    onBirth() {
      births += 1;
    },
    onDeath() {},
    recordMateChoice(data) {
      recorded = data;
    },
    matingDiversityThreshold: 0.3,
  };

  const gm = new TestGridManager(1, 3, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.setMatingDiversityOptions({ threshold: 0.3, lowDiversityMultiplier: 0 });

  const parentDNA = new DNA(10, 20, 30);

  parentDNA.reproductionReachProfile = () => ({
    base: 2.3,
    min: 1.1,
    max: 2.9,
    densityPenalty: 0.08,
    energyBonus: 0.3,
    scarcityBoost: 0.25,
    affinityWeight: 0.24,
  });
  const mateDNA = new DNA(90, 40, 70);

  mateDNA.reproductionReachProfile = () => ({
    base: 2.1,
    min: 1,
    max: 2.6,
    densityPenalty: 0.1,
    energyBonus: 0.28,
    scarcityBoost: 0.25,
    affinityWeight: 0.22,
  });
  const parent = new Cell(0, 0, parentDNA, MAX_TILE_ENERGY);
  const mate = new Cell(0, 2, mateDNA, MAX_TILE_ENERGY);

  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.dna.parentalInvestmentFrac = () => 0.5;
  mate.dna.parentalInvestmentFrac = () => 0.5;
  parent.dna.starvationThresholdFrac = () => 0;
  mate.dna.starvationThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 0,
    diversity: 1,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  mateEntry.diversity = Math.max(0.8, mateEntry.diversity ?? 0);
  mateEntry.similarity = Math.min(0.2, mateEntry.similarity ?? 1);
  mateEntry.selectionWeight = 1;
  mateEntry.preferenceScore = 1;

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(0, 0, parent);
  gm.setCell(0, 2, mate);
  gm.densityGrid = [[0, 0, 0]];

  const originalRandom = Math.random;

  Math.random = () => 0;

  try {
    const reproduced = gm.handleReproduction(
      0,
      0,
      parent,
      { mates: [mateEntry], society: [] },
      {
        stats,
        densityGrid: gm.densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      },
    );

    assert.is(reproduced, true);
  } finally {
    Math.random = originalRandom;
  }

  assert.is(births, 1);
  assert.ok(recorded);
  assert.is(recorded.success, true);
  assert.is(recorded.penalized, false);
  assert.is(recorded.penaltyMultiplier, 1);
});

test("processCell continues to combat when reproduction fails", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      gm.setObstacle(r, c, true, { evict: false });
    }
  }
  gm.setObstacle(1, 1, false);
  gm.setObstacle(1, 2, false);
  gm.setObstacle(0, 1, false);
  gm.energyGrid = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => MAX_TILE_ENERGY),
  );
  const densityGrid = Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => 0),
  );

  const parent = new Cell(1, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(1, 2, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const enemy = new Cell(0, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);

  parent.lifespan = Number.MAX_SAFE_INTEGER;
  parent.age = 0;
  parent.applyEventEffects = () => {};
  parent.manageEnergy = () => false;
  parent.dna.activityRate = () => 1;
  parent.dna.reproductionThresholdFrac = () => 0;
  mate.dna.reproductionThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(1, 1, parent);
  gm.setCell(1, 2, mate);
  gm.setCell(0, 1, enemy);

  gm.findTargets = () => ({
    mates: [mateEntry],
    enemies: [{ row: enemy.row, col: enemy.col, target: enemy }],
    society: [],
  });

  let combatCalled = false;

  gm.handleCombat = () => {
    combatCalled = true;

    return false;
  };
  gm.handleMovement = () => {};

  let births = 0;
  const stats = {
    onBirth: () => {
      births += 1;
    },
    onDeath: () => {},
    recordMateChoice: () => {},
  };

  const processed = new WeakSet();
  const originalRandom = Math.random;

  Math.random = () => 0;

  try {
    gm.processCell(1, 1, {
      stats,
      eventManager: { activeEvents: [] },
      densityGrid,
      processed,
      densityEffectMultiplier: 1,
      societySimilarity: 1,
      enemySimilarity: 0,
      eventStrengthMultiplier: 1,
    });
  } finally {
    Math.random = originalRandom;
  }

  assert.ok(combatCalled, "combat should still be evaluated when reproduction fails");
  assert.is(births, 0);
});

test("density counts stay consistent through spawn, movement, and removal", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: DNA } = await import("../src/genome.js");

  const originalInit = GridManager.prototype.init;

  try {
    GridManager.prototype.init = function noopInit() {};
    const gm = new GridManager(2, 2, {
      eventManager: { activeEvents: [] },
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
    });

    const dna = new DNA(1, 1, 1);

    gm.spawnCell(0, 0, { dna });

    let density = gm.computeDensityGrid();

    assert.ok(Math.abs(density[0][1] - 1 / 3) < 1e-6);
    assert.ok(Math.abs(density[1][0] - 1 / 3) < 1e-6);
    assert.ok(Math.abs(density[1][1] - 1 / 3) < 1e-6);

    const moved = gm.boundTryMove(gm.grid, 0, 0, 0, 1, gm.rows, gm.cols);

    assert.ok(moved);

    density = gm.computeDensityGrid();

    assert.ok(Math.abs(density[0][0] - 1 / 3) < 1e-6);
    assert.ok(Math.abs(density[0][1]) < 1e-6);

    gm.removeCell(0, 1);

    density = gm.computeDensityGrid();

    assert.ok(density.every((row) => row.every((value) => Math.abs(value) < 1e-6)));
  } finally {
    GridManager.prototype.init = originalInit;
  }
});
