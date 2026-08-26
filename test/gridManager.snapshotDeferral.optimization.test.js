import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
  },
  ctx: {},
  cellSize: 1,
};

function createCell(row, col, energy, age) {
  return {
    row,
    col,
    energy,
    age,
    lifespan: 20,
    fightsWon: 2,
    fightsLost: 0,
    offspring: 3,
    color: "#abc",
  };
}

test("lightweight snapshots defer detailed entry allocation until requested", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(2, 2, baseOptions);
  const first = createCell(0, 0, 4, 2);
  const second = createCell(1, 1, 3, 5);

  gm.grid = [
    [first, null],
    [null, second],
  ];
  gm.rebuildActiveCells();

  const snapshot = gm.buildSnapshot(undefined, { includeEntries: false });

  assert.is(snapshot.population, 2);
  assert.is(snapshot.totalEnergy, 7);
  assert.is(snapshot.totalAge, 7);
  assert.equal(snapshot.entries, []);
  assert.type(snapshot.materializeEntries, "function");

  snapshot.materializeEntries();

  assert.is(snapshot.entries.length, 2);
  assert.ok(snapshot.maxFitness > 0);
  assert.equal(snapshot.entries.map(({ row, col }) => `${row},${col}`).sort(), [
    "0,0",
    "1,1",
  ]);
});

test("normal snapshots retain detailed entries by default", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(1, 1, baseOptions);

  gm.grid = [[createCell(0, 0, 4, 2)]];
  gm.rebuildActiveCells();

  const snapshot = gm.buildSnapshot();

  assert.is(snapshot.entries.length, 1);
  assert.is(snapshot.materializeEntries, undefined);
});
