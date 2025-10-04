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

test("GridManager.tryMove rejects non-adjacent steps", async () => {
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

  const gm = new TestGridManager(5, 5, baseOptions);
  const dna = new DNA(7, 11, 13);
  const cell = new Cell(2, 2, dna, 10);

  gm.setCell(2, 2, cell);

  const moved = gm.boundTryMove(gm.grid, 2, 2, 0, 2, gm.rows, gm.cols);

  assert.is(moved, false, "movement should fail when skipping intermediate tiles");
  assert.is(gm.grid[2][2], cell, "origin tile should still contain the mover");
  assert.is(gm.grid[2][4], null, "destination tile should remain empty");
  assert.is(cell.row, 2, "cell row should remain unchanged after blocked move");
  assert.is(cell.col, 2, "cell column should remain unchanged after blocked move");
});

test("GridManager clears energy when placing cells on energized tiles", async () => {
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
  const dna = new DNA(1, 2, 3);
  const cell = new Cell(1, 1, dna, 10);

  gm.energyGrid[1][1] = gm.maxTileEnergy;
  gm.energyNext[1][1] = gm.maxTileEnergy;

  gm.setCell(1, 1, cell);

  assert.is(gm.energyGrid[1][1], 0, "active energy should drop to zero immediately");
  assert.is(gm.energyNext[1][1], 0, "next buffer should also clear after placement");

  gm.energyGrid[1][1] = gm.maxTileEnergy / 2;
  gm.energyNext[1][1] = gm.maxTileEnergy / 3;

  gm.regenerateEnergyGrid();

  assert.is(
    gm.energyGrid[1][1],
    0,
    "regeneration should keep energy at zero while the tile is occupied",
  );
  assert.is(
    gm.energyNext[1][1],
    0,
    "alternate buffer should remain zero after regeneration",
  );
});

test("GridManager movement clears destination energy and blocks regeneration", async () => {
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
  const dna = new DNA(4, 5, 6);
  const cell = new Cell(1, 1, dna, 10);

  gm.setCell(1, 1, cell);
  gm.energyGrid[1][2] = gm.maxTileEnergy;
  gm.energyNext[1][2] = gm.maxTileEnergy;

  const moved = gm.boundTryMove(gm.grid, 1, 1, 0, 1, gm.rows, gm.cols);

  assert.is(moved, true, "movement into an empty tile should succeed");
  assert.is(gm.grid[1][2], cell, "cell should occupy the destination after moving");
  assert.is(
    gm.energyGrid[1][2],
    0,
    "destination energy should be cleared after movement",
  );
  assert.is(
    gm.energyNext[1][2],
    0,
    "destination next buffer should also clear after movement",
  );

  gm.energyGrid[1][2] = gm.maxTileEnergy / 2;
  gm.energyNext[1][2] = gm.maxTileEnergy / 4;

  gm.regenerateEnergyGrid();

  assert.is(
    gm.energyGrid[1][2],
    0,
    "regeneration should keep moved-to tile at zero while occupied",
  );
  assert.is(
    gm.energyNext[1][2],
    0,
    "regeneration should keep the alternate buffer at zero for the occupied tile",
  );
});
