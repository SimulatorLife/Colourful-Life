const { test } = require('uvu');
const assert = require('uvu/assert');

test('GridManager removes cells that report starvation', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const stats = {
    deaths: 0,
    onDeath() {
      this.deaths += 1;
    },
  };
  const eventManager = { activeEvents: [] };
  const gm = new TestGridManager(1, 1, {
    eventManager,
    stats,
    ctx: {},
    cellSize: 1,
  });

  const starvingCell = {
    row: 0,
    col: 0,
    age: 0,
    lifespan: 5,
    energy: 1,
    applyEventEffects() {},
    manageEnergy() {
      return true;
    },
  };

  gm.setCell(0, 0, starvingCell);

  gm.update();

  assert.is(gm.grid[0][0], null, 'starved cell should be removed from the grid');
  assert.is(stats.deaths, 1, 'starvation should be reported to stats');
  assert.is(gm.activeCells.size, 0, 'starved cell should be removed from active tracking');
});

test('GridManager respects dynamic max tile energy', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class HarvestTestGridManager extends GridManager {
    init() {}
  }

  const originalMax = GridManager.maxTileEnergy;
  const customMax = 12;

  GridManager.maxTileEnergy = customMax;

  try {
    const gm = new HarvestTestGridManager(1, 1, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    assert.is(gm.maxTileEnergy, customMax, 'instance should adopt overridden max');

    gm.energyGrid[0][0] = gm.maxTileEnergy;
    const cell = {
      dna: {
        forageRate: () => 1,
        harvestCapMin: () => 0.1,
        harvestCapMax: () => 1,
      },
      energy: gm.maxTileEnergy - 0.25,
    };

    gm.consumeEnergy(cell, 0, 0, [[0]]);
    assert.is(cell.energy, gm.maxTileEnergy, 'harvesting should clamp to custom max');
    assert.ok(gm.energyGrid[0][0] <= gm.maxTileEnergy, 'tile energy should not exceed max');

    gm.energyGrid[0][0] = 0;
    gm.regenerateEnergyGrid([], 1, gm.maxTileEnergy * 10, 0, [[0]]);
    assert.is(
      gm.energyGrid[0][0],
      gm.maxTileEnergy,
      'regeneration should clamp to the custom ceiling'
    );
  } finally {
    GridManager.maxTileEnergy = originalMax;
  }
});

test.run();
