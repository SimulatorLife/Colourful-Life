import { assert, test } from "#tests/harness";

const { default: GridManager } = await import("../src/grid/gridManager.js");

class TestGridManager extends GridManager {
  init() {}
  consumeEnergy() {}
}

test("GridManager reuses density totals for repeated recalculations", () => {
  const gm = new TestGridManager(24, 36, { stats: {} });

  gm.recalculateDensityCounts();
  const firstTotals = gm.densityTotals;

  assert.ok(Array.isArray(firstTotals), "expected density totals to be allocated");
  assert.is(firstTotals.length, 24, "rows should match grid height");

  gm.recalculateDensityCounts();
  assert.is(
    gm.densityTotals,
    firstTotals,
    "density totals should be reused when radius remains unchanged",
  );

  gm.recalculateDensityCounts(3);
  const secondTotals = gm.densityTotals;

  assert.is.not(secondTotals, firstTotals);

  gm.recalculateDensityCounts();
  assert.is(
    gm.densityTotals,
    secondTotals,
    "density totals should be cached for subsequent calls at the new radius",
  );

  gm.resize(20, 28);
  const resizedTotals = gm.densityTotals;

  assert.is.not(resizedTotals, secondTotals);

  gm.recalculateDensityCounts();
  assert.is(
    gm.densityTotals,
    resizedTotals,
    "resizing should invalidate cache entries tied to the previous dimensions",
  );
});
