const { test } = require('uvu');
const assert = require('uvu/assert');

const makeGrid = (rows, cols) => Array.from({ length: rows }, () => Array(cols).fill(null));

test('OrganismSystem.processCell spawns offspring when reproduction succeeds', async () => {
  const { default: OrganismSystem } = await import('../src/organismSystem.js');
  const { default: EnvironmentSystem } = await import('../src/environmentSystem.js');
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');
  const { default: DNA } = await import('../src/genome.js');
  const { default: Cell } = await import('../src/cell.js');

  const rows = 3;
  const cols = 3;
  const grid = makeGrid(rows, cols);
  const environment = new EnvironmentSystem(rows, cols, {
    maxTileEnergy: 10,
    isEventAffecting: () => false,
    getEventEffect: () => null,
  });

  environment.setCellGrid(grid);
  const obstacles = new ObstacleSystem(rows, cols);

  const placed = [];
  let mateEntry = null;
  const organisms = new OrganismSystem({
    grid,
    rows,
    cols,
    environment,
    obstacles,
    stats: { onBirth: () => placed.push('birth') },
    selectionManager: null,
    movement: {
      moveToTarget: () => true,
      moveAwayFromTarget: () => false,
      moveRandomly: () => false,
      tryMove: () => false,
    },
    setCell: (row, col, cell) => {
      grid[row][col] = cell;
      cell.row = row;
      cell.col = col;
    },
    removeCell: (row, col) => {
      const current = grid[row][col];

      grid[row][col] = null;

      return current;
    },
    relocateCell: (fromRow, fromCol, toRow, toCol) => {
      const moving = grid[fromRow][fromCol];

      if (!moving || grid[toRow][toCol]) return false;
      grid[toRow][toCol] = moving;
      grid[fromRow][fromCol] = null;
      moving.row = toRow;
      moving.col = toCol;

      return true;
    },
    maxTileEnergy: 10,
    findTargets: () => ({ mates: mateEntry ? [mateEntry] : [], enemies: [], society: [] }),
  });

  const parent = new Cell(1, 1, new DNA(1, 1, 1), 10);
  const partner = new Cell(1, 2, new DNA(1, 1, 1), 10);

  grid[1][1] = parent;
  grid[1][2] = partner;

  parent.dna.reproductionThresholdFrac = () => 0;
  partner.dna.reproductionThresholdFrac = () => 0;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  mateEntry = parent.evaluateMateCandidate({ row: partner.row, col: partner.col, target: partner });

  const densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
  const processed = new WeakSet();

  parent.manageEnergy = () => false;
  parent.applyEventEffects = () => {};
  parent.dna.activityRate = () => 1;

  organisms.processCell(1, 1, parent, {
    stats: { onBirth: () => placed.push('born') },
    eventManager: { activeEvents: [] },
    densityGrid,
    processed,
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
    eventStrengthMultiplier: 1,
    mutationMultiplier: 1,
  });

  assert.ok(placed.length > 0, 'stats callback should record a birth');
  const offspringCount = grid.flat().filter(Boolean).length;

  assert.ok(offspringCount >= 3, 'grid should contain a new offspring');
});

test('OrganismSystem.configure refreshes dependencies for reuse', async () => {
  const { default: OrganismSystem } = await import('../src/organismSystem.js');
  const { default: EnvironmentSystem } = await import('../src/environmentSystem.js');
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');

  const system = new OrganismSystem();
  const rows = 2;
  const cols = 2;
  const grid = makeGrid(rows, cols);
  const environment = new EnvironmentSystem(rows, cols, { maxTileEnergy: 5 });
  const obstacles = new ObstacleSystem(rows, cols);
  const movement = { tryMove: () => true };
  const stats = { seen: true };
  const selectionManager = { select() {} };

  environment.setCellGrid(grid);

  system.configure({
    grid,
    rows,
    cols,
    environment,
    obstacles,
    stats,
    selectionManager,
    movement,
    setCell: (row, col, cell) => {
      grid[row][col] = cell;

      return cell;
    },
    removeCell: (row, col) => {
      const current = grid[row][col];

      grid[row][col] = null;

      return current;
    },
    relocateCell: () => true,
    maxTileEnergy: 7,
  });

  assert.is(system.grid, grid, 'grid reference should be stored');
  assert.is(system.rows, rows, 'row count should update');
  assert.is(system.cols, cols, 'column count should update');
  assert.is(system.environment, environment, 'environment should be assigned');
  assert.is(system.obstacles, obstacles, 'obstacles should be assigned');
  assert.is(system.stats, stats, 'stats reference should update');
  assert.is(system.selectionManager, selectionManager, 'selection manager should update');
  assert.is(system.movement, movement, 'movement helpers should update');
  assert.is(system.maxTileEnergy, 7, 'max tile energy should update');

  const forageCell = {
    energy: 0,
    dna: {
      forageRate: () => 0.5,
      harvestCapMin: () => 0.1,
      harvestCapMax: () => 0.3,
    },
  };

  environment.setEnergyAt(0, 0, 1);
  system.consumeEnergyFn(forageCell, 0, 0);

  assert.ok(forageCell.energy > 0, 'default consume energy should draw from environment');
  assert.ok(environment.getEnergyAt(0, 0) < 1, 'environment energy should be reduced');

  system.configure({ selectionManager: null, maxTileEnergy: 9 });

  assert.is(system.selectionManager, null, 'configure should allow clearing selection manager');
  assert.is(system.maxTileEnergy, 9, 'subsequent configure calls should update values');
});

test.run();
