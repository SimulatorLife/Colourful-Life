import { assert, test } from "#tests/harness";
import { drawDensityHeatmap, densityToRgba } from "../src/ui/overlays.js";
import { getDensityAt } from "../src/grid/densityUtils.js";

function drawDensityHeatmapBaseline(grid) {
  const { rows, cols } = grid;
  const total = rows * cols;
  const densities = new Array(total);
  const colors = Array.from({ length: rows }, () => Array(cols));
  let minDensity = Infinity;
  let maxDensity = -Infinity;
  let minLocation = { row: 0, col: 0 };
  let maxLocation = { row: 0, col: 0 };
  let sum = 0;
  let index = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawDensity = getDensityAt(grid, r, c);
      const density = Number.isFinite(rawDensity) ? rawDensity : 0;

      densities[index++] = density;
      if (density < minDensity) {
        minDensity = density;
        minLocation = { row: r, col: c };
      }
      if (density > maxDensity) {
        maxDensity = density;
        maxLocation = { row: r, col: c };
      }
      sum += density;
    }
  }

  const originalMin = minDensity;
  const originalMax = maxDensity;
  const average = total > 0 ? sum / total : Number.NaN;

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) {
    return { colors, originalMin, originalMax, minLocation, maxLocation, average };
  }

  let range = maxDensity - minDensity;

  if (range <= 1e-8) {
    const epsilon = Math.abs(maxDensity) * 0.01 || 0.5;

    minDensity -= epsilon;
    maxDensity += epsilon;
    range = maxDensity - minDensity;
  }

  index = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const normalized = (densities[index++] - minDensity) / range;

      colors[r][c] = densityToRgba(normalized);
    }
  }

  return { colors, originalMin, originalMax, minLocation, maxLocation, average };
}

function createRecordingContext(rows, cols, cellSize) {
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  const texts = [];
  let currentFillStyle = null;

  return {
    get cells() {
      return cells;
    },
    get texts() {
      return texts;
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
    save() {},
    restore() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText(text) {
      texts.push(text);
    },
    beginPath() {},
    stroke() {},
    strokeRect() {},
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
  };
}

function assertHeatmapMatches(grid, cellSize) {
  const baseline = drawDensityHeatmapBaseline(grid, cellSize);
  const ctx = createRecordingContext(grid.rows, grid.cols, cellSize);

  drawDensityHeatmap(grid, ctx, cellSize);

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      assert.is.not(ctx.cells[r][c], null, "cell should be painted");
      assert.is(ctx.cells[r][c], baseline.colors[r][c]);
    }
  }

  const minText = ctx.texts.find((text) => text.startsWith("Min:"));
  const meanText = ctx.texts.find((text) => text.startsWith("Mean:"));
  const maxText = ctx.texts.find((text) => text.startsWith("Max:"));

  if (Number.isFinite(baseline.originalMin)) {
    assert.ok(minText, "Min legend line should be rendered");
    assert.match(minText, `Min: ${baseline.originalMin.toFixed(2)}`);
    assert.match(minText, "% occupancy");
    assert.match(minText, `(${baseline.minLocation.row}, ${baseline.minLocation.col})`);
  }

  if (Number.isFinite(baseline.average)) {
    assert.ok(meanText, "Mean legend line should be rendered");
    assert.match(meanText, `Mean: ${baseline.average.toFixed(2)}`);
    assert.match(meanText, "% occupancy");
  }

  if (Number.isFinite(baseline.originalMax)) {
    assert.ok(maxText, "Max legend line should be rendered");
    assert.match(maxText, `Max: ${baseline.originalMax.toFixed(2)}`);
    assert.match(maxText, "% occupancy");
    assert.match(maxText, `(${baseline.maxLocation.row}, ${baseline.maxLocation.col})`);
  }
}

test("drawDensityHeatmap matches baseline output when using densityGrid", () => {
  const grid = {
    rows: 4,
    cols: 5,
    densityGrid: Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => Math.sin(r + c / 2) * 3),
    ),
  };

  assertHeatmapMatches(grid, 8);
});

test("drawDensityHeatmap matches baseline output when using getDensityAt", () => {
  const grid = {
    rows: 3,
    cols: 3,
    getDensityAt(r, c) {
      return (r + 1) * (c + 2);
    },
  };

  assertHeatmapMatches(grid, 10);
});

test("drawDensityHeatmap handles uniform densities with epsilon adjustment", () => {
  const uniformValue = 5;
  const grid = {
    rows: 2,
    cols: 4,
    densityGrid: Array.from({ length: 2 }, () => Array(4).fill(uniformValue)),
  };

  assertHeatmapMatches(grid, 6);
});
