import { assert, test } from "#tests/harness";

function naiveDensity(grid, radius) {
  const normalizedRadius = Math.max(
    0,
    Math.floor(Number.isFinite(radius) ? radius : 0),
  );
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const out = Array.from({ length: rows }, () => Array(cols).fill(0));

  if (rows === 0 || cols === 0 || normalizedRadius === 0) {
    return out;
  }

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let count = 0;
      let total = 0;

      for (let dx = -normalizedRadius; dx <= normalizedRadius; dx++) {
        for (let dy = -normalizedRadius; dy <= normalizedRadius; dy++) {
          if (dx === 0 && dy === 0) continue;
          const rr = row + dy;
          const cc = col + dx;

          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;

          total++;
          if (grid[rr][cc]) count++;
        }
      }

      out[row][col] = total > 0 ? count / total : 0;
    }
  }

  return out;
}

function assertMatrixClose(actual, expected, epsilon = 1e-9) {
  assert.is(actual.length, expected.length, "row counts should match");

  for (let row = 0; row < actual.length; row++) {
    const actualRow = actual[row];
    const expectedRow = expected[row];

    assert.is(actualRow.length, expectedRow.length, "column counts should match");

    for (let col = 0; col < actualRow.length; col++) {
      const delta = Math.abs(actualRow[col] - expectedRow[col]);

      assert.ok(
        delta <= epsilon,
        `cell (${row}, ${col}) differed by ${delta}; expected ${expectedRow[col]}, received ${actualRow[col]}`,
      );
    }
  }
}

test("GridManager.computeDensityGrid matches naive density for arbitrary radii", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const rows = 18;
  const cols = 22;
  const gm = new TestGridManager(rows, cols, { stats: {} });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row * 11 + col * 7) % 5 === 0) {
        gm.placeCell(row, col, { id: `c-${row}-${col}` });
      }
    }
  }

  const radius = 7;
  const optimized = gm.computeDensityGrid(radius);
  const expected = naiveDensity(gm.grid, radius);

  assertMatrixClose(optimized, expected);

  const oversizedRadius = Math.max(rows, cols) * 2;
  const wideOptimized = gm.computeDensityGrid(oversizedRadius);
  const wideExpected = naiveDensity(gm.grid, oversizedRadius);

  assertMatrixClose(wideOptimized, wideExpected);
});

test("GridManager.computeDensityGrid sanitizes degenerate radii", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(4, 4, { stats: {} });

  gm.placeCell(0, 0, { id: "origin" });
  gm.placeCell(1, 1, { id: "diagonal" });

  const zeroRadius = gm.computeDensityGrid(0);
  const nanRadius = gm.computeDensityGrid(Number.NaN);

  for (const matrix of [zeroRadius, nanRadius]) {
    for (const row of matrix) {
      for (const value of row) {
        assert.is(value, 0, "degenerate radius should yield zero density everywhere");
      }
    }
  }
});

test("GridManager.computeDensityGrid resets prefix scratch between runs", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const rows = 12;
  const cols = 14;
  const gm = new TestGridManager(rows, cols, { stats: {} });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 3 === 0) {
        gm.placeCell(row, col, { id: `seed-${row}-${col}` });
      }
    }
  }

  const radius = 4;

  gm.computeDensityGrid(radius);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row + col) % 5 === 0) {
        gm.removeCell(row, col);
      }
    }
  }

  const recomputed = gm.computeDensityGrid(radius);
  const expected = naiveDensity(gm.grid, radius);

  assertMatrixClose(recomputed, expected);
});
