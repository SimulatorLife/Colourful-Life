import { test } from "uvu";
import * as assert from "uvu/assert";

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
  const { default: GridManager } = await import("../src/gridManager.js");

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
  gm.rebuildActiveCells();
  assert.ok(gm.activeCells.has(manualCell), "rebuild should index manual grid edits");

  gm.clearCell(0, 0);
  assert.is(gm.activeCells.size, 0, "clearing a slot should purge active tracking");
});

test.run();
