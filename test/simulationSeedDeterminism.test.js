const { test } = require('uvu');
const assert = require('uvu/assert');

async function loadModules() {
  const [gridModule, eventModule, statsModule, selectionModule, rngModule] = await Promise.all([
    import('../src/gridManager.js'),
    import('../src/eventManager.js'),
    import('../src/stats.js'),
    import('../src/selectionManager.js'),
    import('../src/rng.js'),
  ]);

  return {
    GridManager: gridModule.default,
    EventManager: eventModule.default,
    Stats: statsModule.default,
    SelectionManager: selectionModule.default,
    createRngController: rngModule.createRngController,
  };
}

function captureState(grid, eventManager, stats) {
  const cells = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.grid[row][col];

      if (!cell) continue;

      cells.push({
        row,
        col,
        age: cell.age,
        energy: cell.energy,
        strategy: cell.strategy,
        color: cell.color,
        genes: Array.from(cell.dna?.genes ?? []),
      });
    }
  }

  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  return {
    tick: grid.tickCount,
    cells,
    energyGrid: grid.energyGrid.map((row) => row.map((value) => Number(value))),
    obstacles: grid.obstacles.map((row) => row.slice()),
    densityGrid: grid.densityGrid.map((row) => row.map((value) => Number(value))),
    events: eventManager.activeEvents.map((event) => ({
      type: event.eventType,
      remaining: event.remaining,
      strength: event.strength,
      area: { ...event.affectedArea },
    })),
    totals: { ...stats.totals },
  };
}

async function runWithSeed(modules, seed) {
  const { GridManager, EventManager, Stats, SelectionManager, createRngController } = modules;
  const rows = 12;
  const cols = 12;
  const rng = createRngController(seed);
  const eventManager = new EventManager(rows, cols, () => rng.next());
  const stats = new Stats({ rng });
  const selectionManager = new SelectionManager(rows, cols);
  const grid = new GridManager(rows, cols, { eventManager, stats, selectionManager, rng });

  for (let i = 0; i < 8; i++) {
    grid.update({
      densityEffectMultiplier: 1,
      societySimilarity: 0.6,
      enemySimilarity: 0.3,
      eventStrengthMultiplier: 1,
    });
  }

  return captureState(grid, eventManager, stats);
}

test('shared RNG ensures seeded simulations are reproducible', async () => {
  const modules = await loadModules();
  const stateA = await runWithSeed(modules, 123456);
  const stateB = await runWithSeed(modules, 123456);
  const stateC = await runWithSeed(modules, 654321);

  assert.equal(stateB, stateA, 'Identical seeds should produce identical state snapshots');
  assert.not.equal(stateC, stateA, 'Different seeds should lead to divergent state snapshots');
});

test.run();
