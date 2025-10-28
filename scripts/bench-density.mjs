import { performance } from "node:perf_hooks";
import { clamp } from "../src/utils/math.js";

function createContext(rows, cols, radius) {
  const counts = Array.from({ length: rows }, () => Array(cols).fill(0));
  const totals = Array.from({ length: rows }, () => Array(cols).fill(0));
  const live = Array.from({ length: rows }, () => Array(cols).fill(0));
  const dirty = new Set();

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const spanRows = Math.min(rows - 1, r + radius) - Math.max(0, r - radius) + 1;
      const spanCols = Math.min(cols - 1, c + radius) - Math.max(0, c - radius) + 1;
      const total = spanRows * spanCols - 1;

      totals[r][c] = total > 0 ? total : 0;
      const base = Math.floor(Math.random() * (totals[r][c] + 1));

      counts[r][c] = base;
      live[r][c] = totals[r][c] > 0 ? base / totals[r][c] : 0;
    }
  }

  return {
    rows,
    cols,
    densityRadius: radius,
    densityCounts: counts,
    densityTotals: totals,
    densityLiveGrid: live,
    densityDirtyTiles: dirty,
    markDensityDirty(row, col) {
      dirty.add(row * cols + col);
    },
  };
}

function cloneContext(context) {
  return {
    rows: context.rows,
    cols: context.cols,
    densityRadius: context.densityRadius,
    densityCounts: context.densityCounts.map((row) => row.slice()),
    densityTotals: context.densityTotals.map((row) => row.slice()),
    densityLiveGrid: context.densityLiveGrid.map((row) => row.slice()),
    densityDirtyTiles: new Set(),
    markDensityDirty(row, col) {
      this.densityDirtyTiles.add(row * this.cols + col);
    },
  };
}

function legacyApplyDensityDelta(ctx, row, col, delta, radius) {
  const totals = ctx.densityTotals;
  const liveGrid = ctx.densityLiveGrid;

  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const rr = row + dy;
      const cc = col + dx;

      if (rr < 0 || rr >= ctx.rows || cc < 0 || cc >= ctx.cols) continue;

      const countsRow = ctx.densityCounts[rr];
      const nextCount = (countsRow[cc] || 0) + delta;

      countsRow[cc] = nextCount;

      if (!liveGrid || !totals) continue;

      const total = totals[rr]?.[cc] ?? 0;
      const nextDensity = total > 0 ? clamp(nextCount / total, 0, 1) : 0;

      if (liveGrid[rr][cc] !== nextDensity) {
        liveGrid[rr][cc] = nextDensity;
        ctx.markDensityDirty(rr, cc);
      }
    }
  }
}

function optimizedApplyDensityDelta(ctx, row, col, delta, radius) {
  const counts = ctx.densityCounts;
  const liveGrid = ctx.densityLiveGrid;
  const totals = ctx.densityTotals;
  const canUpdateDensity = Array.isArray(liveGrid) && Array.isArray(totals);
  const minRow = Math.max(0, row - radius);
  const maxRow = Math.min(ctx.rows - 1, row + radius);
  const minCol = Math.max(0, col - radius);
  const maxCol = Math.min(ctx.cols - 1, col + radius);

  for (let rr = minRow; rr <= maxRow; rr += 1) {
    const countsRow = counts[rr];

    if (!countsRow) continue;

    const liveRow = canUpdateDensity ? liveGrid[rr] : null;
    const totalsRow = canUpdateDensity ? totals[rr] : null;
    const updateRow = liveRow && totalsRow;

    for (let cc = minCol; cc <= maxCol; cc += 1) {
      if (rr === row && cc === col) continue;

      const baseCount = countsRow[cc];
      const nextCount = (baseCount ?? 0) + delta;

      countsRow[cc] = nextCount;

      if (!updateRow) continue;

      const total = totalsRow[cc] ?? 0;

      if (!(total > 0)) {
        if (liveRow[cc] !== 0) {
          liveRow[cc] = 0;
          ctx.markDensityDirty(rr, cc);
        }

        continue;
      }

      const ratio = nextCount / total;
      const nextDensity = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;

      if (liveRow[cc] !== nextDensity) {
        liveRow[cc] = nextDensity;
        ctx.markDensityDirty(rr, cc);
      }
    }
  }
}

function runBenchmark(fn, baseContext, ops) {
  const ctx = cloneContext(baseContext);
  const start = performance.now();

  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i];

    fn(ctx, op.row, op.col, op.delta, op.radius);
  }

  return performance.now() - start;
}

function main() {
  const rows = 90;
  const cols = 90;
  const radius = 4;
  const operations = Array.from({ length: 5000 }, () => ({
    row: Math.floor(Math.random() * rows),
    col: Math.floor(Math.random() * cols),
    delta: Math.random() > 0.5 ? 1 : -1,
    radius,
  }));

  const base = createContext(rows, cols, radius);
  const legacyTime = runBenchmark(legacyApplyDensityDelta, base, operations);
  const optimizedTime = runBenchmark(optimizedApplyDensityDelta, base, operations);

  console.log(
    JSON.stringify(
      {
        rows,
        cols,
        radius,
        operations: operations.length,
        legacyTimeMs: legacyTime,
        optimizedTimeMs: optimizedTime,
        improvementPct: ((legacyTime - optimizedTime) / legacyTime) * 100,
      },
      null,
      2,
    ),
  );
}

main();
