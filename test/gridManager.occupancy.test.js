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

test("GridManager prevents moves into occupied cells", async () => {
  const [{ default: GridManager }, { default: Cell }, { default: DNA }] =
    await Promise.all([
      import("../src/grid/gridManager.js"),
      import("../src/cell.js"),
      import("../src/genome.js"),
    ]);

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);

  const dnaA = new DNA(10, 20, 30);
  const dnaB = new DNA(40, 50, 60);

  const cellA = new Cell(1, 1, dnaA, 10);
  const cellB = new Cell(1, 2, dnaB, 10);

  gm.setCell(1, 1, cellA);
  gm.setCell(1, 2, cellB);

  const moved = gm.boundTryMove(gm.grid, 1, 1, 0, 1, gm.rows, gm.cols);

  assert.is(moved, false, "movement should fail when destination is occupied");
  assert.is(gm.grid[1][1], cellA, "origin cell should remain in place");
  assert.is(gm.grid[1][2], cellB, "destination cell should remain unchanged");
  assert.is(cellA.row, 1, "origin cell row should remain unchanged");
  assert.is(cellA.col, 1, "origin cell column should remain unchanged");
  assert.is(cellB.row, 1, "blocking cell row should remain unchanged");
  assert.is(cellB.col, 2, "blocking cell column should remain unchanged");
});

test("GridManager relocation respects occupied destinations", async () => {
  const [{ default: GridManager }, { default: Cell }, { default: DNA }] =
    await Promise.all([
      import("../src/grid/gridManager.js"),
      import("../src/cell.js"),
      import("../src/genome.js"),
    ]);

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);

  const dnaA = new DNA(5, 15, 25);
  const dnaB = new DNA(35, 45, 55);

  const cellA = new Cell(1, 1, dnaA, 8);
  const cellB = new Cell(1, 2, dnaB, 9);

  gm.grid[1][1] = cellA;
  gm.grid[1][2] = cellB;

  const relocated = gm.relocateCell(1, 1, 1, 2);

  assert.is(relocated, false, "relocation should fail when destination is occupied");
  assert.is(gm.grid[1][1], cellA, "origin slot should remain occupied by the mover");
  assert.is(
    gm.grid[1][2],
    cellB,
    "destination slot should remain occupied by the blocker",
  );
  assert.is(cellA.row, 1, "mover row should remain unchanged");
  assert.is(cellA.col, 1, "mover column should remain unchanged");
  assert.is(cellB.row, 1, "blocker row should remain unchanged");
  assert.is(cellB.col, 2, "blocker column should remain unchanged");
});

test("GridManager relocation rejects non-adjacent destinations", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(5, 5, baseOptions);

  const relocated = gm.relocateCell(0, 0, 3, 3);

  assert.is(relocated, false, "relocation should fail when target is not adjacent");
});
