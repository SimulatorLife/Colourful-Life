import { assert, test } from "#tests/harness";
import { drawEnergyHeatmap } from "../src/ui/overlays.js";

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
    save() {},
    restore() {},
    fillText() {},
    beginPath() {},
    stroke() {},
    strokeRect() {},
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
  };
}

test("drawEnergyHeatmap keeps tiny energy values visible", () => {
  const grid = {
    rows: 1,
    cols: 1,
    energyGrid: [[0.002]],
  };
  const ctx = createRecordingContext(grid.rows, grid.cols, 4);

  // Regression test: previously alpha values below 0.001 were rounded down to
  // 0.000, so enabling the overlays still painted a fully transparent tile.
  drawEnergyHeatmap(grid, ctx, 4, 5);

  assert.is(ctx.cells[0][0], "rgba(0,255,0,0.001)");
});
