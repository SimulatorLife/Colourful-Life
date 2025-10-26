import { assert, test } from "#tests/harness";

function naiveLocalDensity(grid, row, col, radius) {
  const normalizedRadius = Math.max(
    0,
    Math.floor(Number.isFinite(radius) ? radius : 0),
  );
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;

  if (
    rows === 0 ||
    cols === 0 ||
    row < 0 ||
    row >= rows ||
    col < 0 ||
    col >= cols ||
    normalizedRadius === 0
  ) {
    return 0;
  }

  let count = 0;
  let total = 0;

  const minRow = Math.max(0, row - normalizedRadius);
  const maxRow = Math.min(rows - 1, row + normalizedRadius);
  const minCol = Math.max(0, col - normalizedRadius);
  const maxCol = Math.min(cols - 1, col + normalizedRadius);

  for (let rr = minRow; rr <= maxRow; rr++) {
    for (let cc = minCol; cc <= maxCol; cc++) {
      if (rr === row && cc === col) continue;

      total += 1;

      if (grid[rr][cc]) {
        count += 1;
      }
    }
  }

  return total > 0 ? count / total : 0;
}

test("GridManager.localDensity fallback matches naive counts", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const rows = 16;
  const cols = 18;
  const gm = new TestGridManager(rows, cols, { stats: {} });

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row * 13 + col * 17) % 7 === 0) {
        gm.placeCell(row, col, { id: `cell-${row}-${col}` });
      }
    }
  }

  const radius = 4; // ensure the fallback path is exercised
  const samplePoints = [
    [0, 0],
    [0, cols - 1],
    [rows - 1, 0],
    [rows - 1, cols - 1],
    [Math.floor(rows / 2), Math.floor(cols / 2)],
    [3, 7],
    [10, 12],
  ];

  for (const [row, col] of samplePoints) {
    const actual = gm.localDensity(row, col, radius);
    const expected = naiveLocalDensity(gm.grid, row, col, radius);

    const delta = Math.abs(actual - expected);

    assert.ok(delta <= 1e-9, `density mismatch at (${row}, ${col}); Δ=${delta}`);
  }
});

test("GridManager.localDensity sanitizes degenerate radii", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(5, 5, { stats: {} });

  gm.placeCell(2, 2, { id: "center" });

  const cases = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];

  for (const radius of cases) {
    assert.is(gm.localDensity(2, 2, radius), 0, `radius ${radius} should yield zero`);
  }

  const oversized = gm.localDensity(2, 2, 999);
  const expected = naiveLocalDensity(gm.grid, 2, 2, 999);

  const oversizedDelta = Math.abs(oversized - expected);

  assert.ok(oversizedDelta <= 1e-9, `oversized radius mismatch; Δ=${oversizedDelta}`);
});
