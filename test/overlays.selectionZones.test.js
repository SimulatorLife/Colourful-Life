import { test } from "uvu";
import * as assert from "uvu/assert";
import { drawSelectionZones } from "../src/overlays.js";
import SelectionManager from "../src/selectionManager.js";

function createMockContext() {
  const operations = [];
  let fillStyle = null;

  return {
    operations,
    save() {},
    restore() {},
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value) {
      fillStyle = value;
    },
    fillRect(x, y, width, height) {
      operations.push({ x, y, width, height, fillStyle });
    },
  };
}

function collectCellsFromOperations(operations, cellSize) {
  const cells = new Set();

  for (const op of operations) {
    if (!op) continue;
    const { x, y, width, height } = op;

    if (width <= 0 || height <= 0) continue;

    const startCol = Math.round(x / cellSize);
    const startRow = Math.round(y / cellSize);
    const colSpan = Math.round(width / cellSize);
    const rowSpan = Math.round(height / cellSize);

    for (let dr = 0; dr < rowSpan; dr++) {
      for (let dc = 0; dc < colSpan; dc++) {
        cells.add(`${startRow + dr}:${startCol + dc}`);
      }
    }
  }

  return cells;
}

function baselineCoverage(manager) {
  const rows = manager.rows;
  const cols = manager.cols;
  const zones = manager.getActiveZones();
  const cells = new Set();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      for (let z = 0; z < zones.length; z++) {
        const zone = zones[z];

        if (zone?.contains?.(r, c)) {
          cells.add(`${r}:${c}`);
          break;
        }
      }
    }
  }

  return cells;
}

function sortedSetValues(set) {
  return Array.from(set).sort();
}

test("drawSelectionZones matches tile coverage for predefined patterns", () => {
  const manager = new SelectionManager(10, 10);

  manager.togglePattern("eastHalf", true);
  manager.togglePattern("cornerPatches", true);

  const ctx = createMockContext();

  drawSelectionZones(manager, ctx, 5);

  const drawnCells = collectCellsFromOperations(ctx.operations, 5);
  const expectedCells = baselineCoverage(manager);

  assert.equal(sortedSetValues(drawnCells), sortedSetValues(expectedCells));
});

test("drawSelectionZones matches tile coverage for custom rectangles", () => {
  const manager = new SelectionManager(12, 12);

  manager.addCustomRectangle(2, 3, 6, 7);
  manager.addCustomRectangle(0, 0, 1, 4);

  const ctx = createMockContext();

  drawSelectionZones(manager, ctx, 8);

  const drawnCells = collectCellsFromOperations(ctx.operations, 8);
  const expectedCells = baselineCoverage(manager);

  assert.equal(sortedSetValues(drawnCells), sortedSetValues(expectedCells));
});

test("pattern geometry is cached after activation", () => {
  const manager = new SelectionManager(10, 10);
  const pattern = manager.patterns.get("alternatingBands");

  let containsCalls = 0;
  const originalContains = pattern.contains;

  pattern.contains = (row, col) => {
    containsCalls += 1;

    return originalContains(row, col);
  };

  manager.togglePattern("alternatingBands", true);
  assert.ok(containsCalls > 0, "toggling should compute initial geometry");

  containsCalls = 0;
  manager.getActiveZoneRenderData();
  assert.is(containsCalls, 0, "first render data call should reuse cached geometry");

  manager.getActiveZoneRenderData();
  assert.is(containsCalls, 0, "subsequent calls should not trigger recomputation");
});

test.run();
