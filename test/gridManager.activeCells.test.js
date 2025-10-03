import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onDeath() {},
    onBirth() {},
  },
  ctx: {},
  cellSize: 1,
};

test("GridManager keeps activeCells aligned with grid mutations", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);

  assert.is(gm.activeCells.size, 0, "initial grid should have no active cells");

  const spawned = gm.spawnCell(1, 1);

  assert.ok(spawned, "spawn should produce a cell");
  assert.ok(gm.activeCells.has(spawned), "spawned cell should be tracked");

  const startRow = spawned.row;
  const startCol = spawned.col;
  const moved = gm.boundTryMove(gm.grid, startRow, startCol, 1, 0, gm.rows, gm.cols);

  assert.ok(moved, "movement helper should relocate the cell");
  assert.ok(gm.activeCells.has(spawned), "moved cell should remain tracked");
  assert.is(
    gm.grid[spawned.row][spawned.col],
    spawned,
    "grid should reflect moved cell",
  );

  gm.setObstacle(spawned.row, spawned.col, true, { evict: true });
  assert.is(gm.activeCells.size, 0, "evicted cell should be removed from tracking");

  const manualCell = { row: 0, col: 0 };

  gm.grid[0][0] = manualCell;
  manualCell.row = 2;
  manualCell.col = 3;
  gm.rebuildActiveCells();
  assert.ok(gm.activeCells.has(manualCell), "rebuild should index manual grid edits");
  assert.is(manualCell.row, 0, "rebuild should realign cell row metadata");
  assert.is(manualCell.col, 0, "rebuild should realign cell column metadata");
  assert.equal(
    gm.cellPositions.get(manualCell),
    { row: 0, col: 0 },
    "position cache should store resolved coordinates",
  );

  gm.clearCell(0, 0);
  assert.is(gm.activeCells.size, 0, "clearing a slot should purge active tracking");
});

test("GridManager.resize preserves existing cells when reseed is false", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);
  const survivor = gm.spawnCell(1, 1);

  survivor.energy = 2.5;
  gm.energyGrid[1][1] = 1.75;

  gm.resize(5, 5, { reseed: false });

  assert.ok(
    gm.activeCells.has(survivor),
    "existing cell should remain active after resize",
  );
  assert.is(
    gm.grid[1][1],
    survivor,
    "cell should keep its grid position when still in bounds",
  );
  assert.is(survivor.row, 1, "cell row coordinate should be preserved");
  assert.is(survivor.col, 1, "cell column coordinate should be preserved");
  assert.is(
    gm.energyGrid[1][1],
    0,
    "occupied tiles should not retain stored energy after resize",
  );
  assert.is(
    survivor.energy,
    4.25,
    "preserved cells should absorb their former tile reserves",
  );

  const edgeCell = gm.spawnCell(4, 4);

  gm.resize(2, 2, { reseed: false });

  assert.ok(
    gm.activeCells.has(survivor),
    "in-bounds cell should survive shrinking the grid",
  );
  assert.not.ok(
    edgeCell && gm.activeCells.has(edgeCell),
    "out-of-bounds cell should be dropped",
  );
});
