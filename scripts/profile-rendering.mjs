import { performance } from "node:perf_hooks";

if (!globalThis.performance) {
  globalThis.performance = performance;
}

const { default: GridManager } = await import("../src/grid/gridManager.js");

class MockContext {
  constructor() {
    this.fillStyle = "#000";
    this.strokeStyle = "#000";
    this.lineWidth = 1;
    this.imageSmoothingEnabled = true;
    this._sink = 0;
  }

  clearRect() {}
  fillRect(x, y, w, h) {
    // Introduce lightweight work so batching effects are observable in Node.
    this._sink += x + y + w + h;
  }
  strokeRect() {}
  drawImage() {}
}

function buildPopulation(grid, palette, blockSize = 8) {
  const cells = [];

  for (let row = 0; row < grid.rows; row++) {
    const gridRow = grid.grid[row];

    for (let col = 0; col < grid.cols; col++) {
      const color =
        palette[Math.floor(col / blockSize + (row % palette.length)) % palette.length];
      const cell = { color };

      gridRow[col] = cell;
      cells.push(cell);
    }
  }

  grid.activeCells = new Set(cells);
}

function baselineLoop(grid, ctx, cellSize) {
  let painted = 0;

  for (let row = 0; row < grid.rows; row++) {
    const gridRow = grid.grid[row];

    if (!gridRow) continue;

    for (let col = 0; col < grid.cols; col++) {
      const cell = gridRow[col];

      if (!cell) continue;

      ctx.fillStyle = cell.color;
      ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      painted++;
    }
  }

  return painted;
}

function optimizedLoop(grid, ctx, cellSize) {
  let painted = 0;

  for (let row = 0; row < grid.rows; row++) {
    const gridRow = grid.grid[row];

    if (!gridRow) continue;

    const y = row * cellSize;
    let spanColor = null;
    let spanStart = -1;
    let spanLength = 0;

    for (let col = 0; col < grid.cols; col++) {
      const cell = gridRow[col];
      const color = cell ? cell.color : null;

      if (color) {
        painted++;

        if (color === spanColor) {
          spanLength += 1;
          continue;
        }

        if (spanLength > 0 && spanColor) {
          if (ctx.fillStyle !== spanColor) {
            ctx.fillStyle = spanColor;
          }
          ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
        }

        spanColor = color;
        spanStart = col;
        spanLength = 1;
      } else if (spanLength > 0 && spanColor) {
        if (ctx.fillStyle !== spanColor) {
          ctx.fillStyle = spanColor;
        }
        ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
        spanColor = null;
        spanStart = -1;
        spanLength = 0;
      }
    }

    if (spanLength > 0 && spanColor) {
      if (ctx.fillStyle !== spanColor) {
        ctx.fillStyle = spanColor;
      }
      ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
    }
  }

  return painted;
}

function measureLoop(loop, grid, iterations) {
  const ctx = new MockContext();
  const cellSize = grid.cellSize;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    loop(grid, ctx, cellSize);
  }

  const total = performance.now() - start;

  return {
    totalMs: total,
    avgMs: total / iterations,
    sink: ctx._sink,
  };
}

function runProfile({ rows = 120, cols = 120, iterations = 40 } = {}) {
  const ctx = new MockContext();
  const grid = new GridManager(rows, cols, {
    ctx,
    cellSize: 4,
    renderStrategy: "canvas",
    autoSeedEnabled: false,
  });

  const palette = ["#f94144", "#f8961e", "#f9c74f", "#90be6d", "#577590"];

  buildPopulation(grid, palette);

  const baseline = measureLoop(baselineLoop, grid, iterations);
  const optimized = measureLoop(optimizedLoop, grid, iterations);

  return {
    rows,
    cols,
    iterations,
    baseline,
    optimized,
  };
}

const result = runProfile();

console.log(JSON.stringify(result, null, 2));
