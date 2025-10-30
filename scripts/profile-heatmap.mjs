import { performance } from "node:perf_hooks";
import { __profileDrawScalarHeatmap as drawScalarHeatmap } from "../src/ui/overlays.js";
import { clampFinite } from "../src/utils/math.js";

const CELL_SIZE = 4;
const ROWS = 180;
const COLS = 180;
const COLOR = "0,255,0";
const FRAMES = 48;

const alphaBuffer = new Float32Array(ROWS * COLS);

for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const index = r * COLS + c;
    const wave = Math.sin((r + 1) * 0.21) * Math.cos((c + 2) * 0.17);
    const ripple = Math.sin((r + c) * 0.035);
    const base = 0.4 + 0.35 * wave + 0.25 * ripple;

    alphaBuffer[index] = clampFinite(base, 0, 1, 0);
  }
}

const grid = Object.freeze({ rows: ROWS, cols: COLS });

const alphaAt = (r, c) => alphaBuffer[r * COLS + c];

function formatAlpha(alpha) {
  if (!(alpha > 0)) return "0";
  if (alpha >= 1) return "1";

  const safeAlpha = alpha < 0.001 ? 0.001 : alpha;
  const formatted = safeAlpha.toFixed(3);

  return formatted === "1.000" ? "1" : formatted;
}

function drawScalarHeatmapBaseline(localGrid, ctx, cellSize, localAlphaAt, color) {
  const rows = localGrid.rows;
  const cols = localGrid.cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const alpha = clampFinite(localAlphaAt(r, c), 0, 1, 0);

      if (alpha <= 0) continue;

      ctx.fillStyle = `rgba(${color},${formatAlpha(alpha)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}

function createMockContext() {
  return {
    fillStyle: "",
    fillRectCalls: 0,
    fillRect() {
      this.fillRectCalls += 1;
    },
  };
}

function profile(label, draw) {
  // Warm-up to reduce JIT noise.
  const warmCtx = createMockContext();

  draw(warmCtx);

  const ctx = createMockContext();
  const start = performance.now();

  for (let i = 0; i < FRAMES; i++) {
    draw(ctx);
  }

  const total = performance.now() - start;
  const avg = total / FRAMES;

  return { label, avg, fillRects: ctx.fillRectCalls / FRAMES };
}

const baseline = profile("baseline", (ctx) =>
  drawScalarHeatmapBaseline(grid, ctx, CELL_SIZE, alphaAt, COLOR),
);

const optimized = profile("optimized", (ctx) =>
  drawScalarHeatmap(grid, ctx, CELL_SIZE, alphaAt, COLOR),
);

const speedup = baseline.avg / optimized.avg;

const formatMs = (value) => `${value.toFixed(3)} ms`;

console.log("Scalar heatmap rendering profile (synthetic)");
console.log("Grid", `${ROWS}x${COLS}`, "cellSize", CELL_SIZE);
console.log(
  `Baseline:  ${formatMs(baseline.avg)} per frame, fillRect avg ${baseline.fillRects.toFixed(0)}`,
);
console.log(
  `Optimized: ${formatMs(optimized.avg)} per frame, fillRect avg ${optimized.fillRects.toFixed(0)}`,
);
console.log(`Speedup:   ${speedup.toFixed(2)}x faster`);
