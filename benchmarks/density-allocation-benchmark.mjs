import { performance } from 'node:perf_hooks';
import { drawDensityHeatmap } from '../src/overlays.js';
import { lerp } from '../src/utils.js';

const cellSize = 6;
const rows = 80;
const cols = 80;
const iterations = 200;

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

function drawDensityHeatmapBaseline(grid, ctx, cellSizeArg) {
  const { rows: localRows, cols: localCols } = grid;
  const densities = [];
  let minDensity = Infinity;
  let maxDensity = -Infinity;

  for (let r = 0; r < localRows; r++) {
    densities[r] = [];
    for (let c = 0; c < localCols; c++) {
      const rawDensity = getDensityAtBaseline(grid, r, c);
      const density = Number.isFinite(rawDensity) ? rawDensity : 0;

      densities[r][c] = density;
      if (density < minDensity) minDensity = density;
      if (density > maxDensity) maxDensity = density;
    }
  }

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) return;

  let range = maxDensity - minDensity;

  if (range <= 1e-8) {
    const epsilon = Math.abs(maxDensity) * 0.01 || 0.5;

    minDensity -= epsilon;
    maxDensity += epsilon;
    range = maxDensity - minDensity;
  }

  for (let r = 0; r < localRows; r++) {
    for (let c = 0; c < localCols; c++) {
      const density = densities[r][c];
      const normalized = (density - minDensity) / range;

      ctx.fillStyle = densityToRgba(normalized);
      ctx.fillRect(c * cellSizeArg, r * cellSizeArg, cellSizeArg, cellSizeArg);
    }
  }
}

function createGrid() {
  return {
    rows,
    cols,
    getDensityAt(r, c) {
      return Math.sin(r * 0.31) + Math.cos(c * 0.17);
    },
  };
}

function createNoopContext() {
  return {
    fillRect() {},
    save() {},
    restore() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText() {},
    strokeRect() {},
    set fillStyle(value) {
      this._fillStyle = value;
    },
    get fillStyle() {
      return this._fillStyle;
    },
    font: '',
    textBaseline: 'top',
    textAlign: 'left',
    lineWidth: 1,
  };
}

function runBenchmark(label, fn) {
  if (typeof global.gc !== 'function') {
    throw new Error('Run this benchmark with --expose-gc to enable deterministic measurements');
  }

  const ctx = createNoopContext();
  const grid = createGrid();

  // warm-up
  fn(grid, ctx, cellSize);

  global.gc();
  const beforeHeap = process.memoryUsage().heapUsed;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    fn(grid, ctx, cellSize);
  }

  const duration = performance.now() - start;
  global.gc();
  const afterHeap = process.memoryUsage().heapUsed;

  console.log(
    `${label}: iterations=${iterations}, heapDelta=${afterHeap - beforeHeap} bytes, duration=${duration.toFixed(2)}ms`
  );
}

runBenchmark('Baseline nested arrays', drawDensityHeatmapBaseline);
runBenchmark('Updated reusable buffer', drawDensityHeatmap);
