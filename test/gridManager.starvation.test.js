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
    age: 0,
    lifespan: 5,
    energy: 1,
    applyEventEffects() {},
    manageEnergy() {
      return true;
    },
  };

  gm.grid[0][0] = starvingCell;

  gm.update();

  assert.is(gm.grid[0][0], null, 'starved cell should be removed from the grid');
  assert.is(stats.deaths, 1, 'starvation should be reported to stats');
});

test.run();
