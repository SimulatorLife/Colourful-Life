import { assert, test } from "#tests/harness";
import { drawAgeHeatmap } from "../src/ui/overlays.js";

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
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
  };
}

test("drawAgeHeatmap highlights older organisms", () => {
  const grid = {
    rows: 1,
    cols: 2,
    grid: [
      [
        { age: 0, lifespan: 100 },
        { age: 50, lifespan: 100 },
      ],
    ],
  };
  const ctx = createRecordingContext(grid.rows, grid.cols, 4);

  drawAgeHeatmap(grid, ctx, 4);

  assert.is(ctx.cells[0][0], null, "newborn tiles remain unshaded");
  assert.is(
    ctx.cells[0][1],
    "rgba(255, 138, 0,0.590)",
    "older organisms receive a warm overlay",
  );
});
