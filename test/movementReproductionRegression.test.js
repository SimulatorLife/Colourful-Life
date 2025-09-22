const { test } = require('uvu');
const assert = require('uvu/assert');

test("GridManager.tryMove updates a cell's stored coordinates", async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: Cell } = await import('../src/cell.js');
  const { default: DNA } = await import('../src/genome.js');

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

test("Breeding uses the mover's refreshed coordinates for offspring placement", async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: Cell } = await import('../src/cell.js');
  const { default: DNA } = await import('../src/genome.js');

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

test('handleReproduction returns false when offspring cannot be placed', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: Cell } = await import('../src/cell.js');
  const { default: DNA } = await import('../src/genome.js');
  const { MAX_TILE_ENERGY } = await import('../src/config.js');

  const gm = new GridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  gm.grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ blocker: true })));
  gm.densityGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0));

  const parent = new Cell(1, 1, new DNA(0, 0, 0), MAX_TILE_ENERGY);
  const mate = new Cell(1, 2, new DNA(0, 0, 0), MAX_TILE_ENERGY);

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
    mode: 'preference',
  });
  parent.findBestMate = () => mateEntry;

  gm.grid[1][1] = parent;
  gm.grid[1][2] = mate;

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

  Math.random = () => 0;

  try {
    const reproduced = gm.handleReproduction(
      1,
      1,
      parent,
      { mates: [mateEntry], society: [] },
      { stats, densityGrid: gm.densityGrid, densityEffectMultiplier: 1 }
    );

    assert.is(reproduced, false);
  } finally {
    Math.random = originalRandom;
  }

  assert.is(births, 0);
  assert.ok(recorded);
  assert.is(recorded.success, false);
});

test('processCell continues to combat when reproduction fails', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: Cell } = await import('../src/cell.js');
  const { default: DNA } = await import('../src/genome.js');
  const { MAX_TILE_ENERGY } = await import('../src/config.js');

  const gm = new GridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {}, recordMateChoice() {} },
  });

  gm.grid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => ({ blocker: true })));
  gm.energyGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => MAX_TILE_ENERGY));
  const densityGrid = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 0));

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
    mode: 'preference',
  });
  parent.findBestMate = () => mateEntry;

  gm.grid[1][1] = parent;
  gm.grid[1][2] = mate;
  gm.grid[0][1] = enemy;

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

  assert.ok(combatCalled, 'combat should still be evaluated when reproduction fails');
  assert.is(births, 0);
});

test.run();
