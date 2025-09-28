import { test } from 'uvu';
import * as assert from 'uvu/assert';
import { drawDensityHeatmap } from '../src/overlays.js';
import { lerp } from '../src/utils.js';

function densityToRgba(normalizedValue, { opaque = false } = {}) {
  const clampedValue = Number.isFinite(normalizedValue) ? normalizedValue : 0;
  const t = Math.min(1, Math.max(0, clampedValue));
  const stops = [
    { t: 0, color: [59, 76, 192] },
    { t: 0.5, color: [221, 244, 255] },
    { t: 1, color: [220, 36, 31] },
  ];

  let start = stops[0];
  let end = stops[stops.length - 1];

  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      start = stops[i - 1];
      end = stops[i];
      break;
    }
  }

  const segmentSpan = end.t - start.t || 1;
  const localT = (t - start.t) / segmentSpan;
  const r = Math.round(lerp(start.color[0], end.color[0], localT));
  const g = Math.round(lerp(start.color[1], end.color[1], localT));
  const b = Math.round(lerp(start.color[2], end.color[2], localT));
  const alpha = opaque ? 1 : 0.18 + 0.65 * t;

  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function getDensityAtBaseline(grid, r, c) {
  if (typeof grid.getDensityAt === 'function') return grid.getDensityAt(r, c);
  if (Array.isArray(grid.densityGrid)) return grid.densityGrid[r]?.[c] ?? 0;
  if (typeof grid.localDensity === 'function') return grid.localDensity(r, c, 1);

  return 0;
}

function drawDensityHeatmapBaseline(grid) {
  const { rows, cols } = grid;
  const total = rows * cols;
  const densities = new Array(total);
  const colors = Array.from({ length: rows }, () => Array(cols));
  let minDensity = Infinity;
  let maxDensity = -Infinity;
  let index = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawDensity = getDensityAtBaseline(grid, r, c);
      const density = Number.isFinite(rawDensity) ? rawDensity : 0;

      densities[index++] = density;
      if (density < minDensity) minDensity = density;
      if (density > maxDensity) maxDensity = density;
    }
  }

  const originalMin = minDensity;
  const originalMax = maxDensity;

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) {
    return { colors, originalMin, originalMax };
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

  return { colors, originalMin, originalMax };
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
    font: '',
    textBaseline: 'top',
    textAlign: 'left',
  };
}

function assertHeatmapMatches(grid, cellSize) {
  const baseline = drawDensityHeatmapBaseline(grid, cellSize);
  const ctx = createRecordingContext(grid.rows, grid.cols, cellSize);

  drawDensityHeatmap(grid, ctx, cellSize);

  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      assert.is.not(ctx.cells[r][c], null, 'cell should be painted');
      assert.is(ctx.cells[r][c], baseline.colors[r][c]);
    }
  }

  const minText = ctx.texts.find((text) => text.startsWith('Min:'));
  const maxText = ctx.texts.find((text) => text.startsWith('Max:'));

  if (Number.isFinite(baseline.originalMin)) {
    assert.is(minText, `Min: ${baseline.originalMin.toFixed(2)}`);
  }
  if (Number.isFinite(baseline.originalMax)) {
    assert.is(maxText, `Max: ${baseline.originalMax.toFixed(2)}`);
  }
}

test('drawDensityHeatmap matches baseline output when using densityGrid', () => {
  const grid = {
    rows: 4,
    cols: 5,
    densityGrid: Array.from({ length: 4 }, (_, r) =>
      Array.from({ length: 5 }, (_, c) => Math.sin(r + c / 2) * 3)
    ),
  };

  assertHeatmapMatches(grid, 8);
});

test('drawDensityHeatmap matches baseline output when using getDensityAt', () => {
  const grid = {
    rows: 3,
    cols: 3,
    getDensityAt(r, c) {
      return (r + 1) * (c + 2);
    },
  };

  assertHeatmapMatches(grid, 10);
});

test('drawDensityHeatmap handles uniform densities with epsilon adjustment', () => {
  const uniformValue = 5;
  const grid = {
    rows: 2,
    cols: 4,
    densityGrid: Array.from({ length: 2 }, () => Array(4).fill(uniformValue)),
  };

  assertHeatmapMatches(grid, 6);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  test.run();
}
