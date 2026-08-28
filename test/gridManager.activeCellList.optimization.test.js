import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: { onDeath() {}, onBirth() {} },
  ctx: {},
  cellSize: 1,
};

function createCell(row, col, id) {
  return { row, col, id, energy: 1, age: 0 };
}

test("GridManager processes a stable active-cell phase without revisiting births", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class MutationGrid extends GridManager {
    init() {}

    prepareTick() {
      return { densityGrid: this.densityGrid };
    }

    processCell(row, col) {
      this.processed.push(this.grid[row][col]);

      if (this.tickCount === 1 && !this.spawned) {
        this.spawned = true;
        this.placeCell(0, 1, createCell(0, 1, "birth"));
      }
    }
  }

  const grid = new MutationGrid(1, 2, baseOptions);
  const parent = createCell(0, 0, "parent");

  grid.processed = [];
  grid.setCell(0, 0, parent);
  grid.update();

  assert.equal(
    grid.processed.map((cell) => cell.id),
    ["parent"],
    "a birth appended during the decision phase must wait for the next tick",
  );
  assert.is(grid.activeCells.size, 2, "the birth should be active after the tick");

  grid.processed = [];
  grid.update();

  assert.equal(
    grid.processed.map((cell) => cell.id).sort(),
    ["birth", "parent"],
    "the next tick should process the compacted active population exactly once",
  );
});
