import { assert, test } from "#tests/harness";
import { drawTraitFocusOverlay } from "../src/ui/overlays.js";

function createRecordingContext(rows, cols, cellSize) {
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  let currentFillStyle = null;

  return {
    get cells() {
      return cells;
    },
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value) {
      currentFillStyle = value;
    },
    fillRect(x, y, width, height) {
      if (width === cellSize && height === cellSize) {
        const col = Math.round(x / cellSize);
        const row = Math.round(y / cellSize);

        if (row >= 0 && row < rows && col >= 0 && col < cols) {
          cells[row][col] = currentFillStyle;
        }
      }
    },
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText() {},
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    font: "",
    textBaseline: "top",
    textAlign: "left",
  };
}

test("drawTraitFocusOverlay highlights active trait intensity", () => {
  const intensities = new Map([
    ["low", 0.35],
    ["high", 0.9],
    ["none", 0],
  ]);
  const grid = {
    activeCells: new Set([
      { row: 0, col: 0, id: "low" },
      { row: 0, col: 1, id: "high" },
      { row: 1, col: 0, id: "none" },
    ]),
    rows: 2,
    cols: 2,
  };
  const ctx = createRecordingContext(grid.rows, grid.cols, 8);

  drawTraitFocusOverlay(grid, ctx, 8, {
    key: "cooperation",
    threshold: 0.6,
    compute: (cell) => intensities.get(cell.id) ?? 0,
  });

  assert.ok(ctx.cells[0][1], "high-intensity cell receives overlay tint");
  assert.ok(ctx.cells[0][0], "sub-threshold intensity is still faintly tinted");
  assert.is(ctx.cells[1][0], null, "zero intensity cells remain untouched");
  assert.not.equal(
    ctx.cells[0][0],
    ctx.cells[0][1],
    "different intensities map to distinct colours",
  );
});

test("drawTraitFocusOverlay exits when no active cells", () => {
  const grid = { activeCells: new Set(), rows: 1, cols: 1 };
  const ctx = createRecordingContext(1, 1, 8);

  assert.doesNotThrow(() => {
    drawTraitFocusOverlay(grid, ctx, 8, {
      compute: () => 1,
    });
  });
});
