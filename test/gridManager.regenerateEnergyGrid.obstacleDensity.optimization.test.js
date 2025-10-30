import { assert, test } from "#tests/harness";

test("GridManager.regenerateEnergyGrid skips density work for obstacle tiles", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class InstrumentedGridManager extends GridManager {
    constructor(rows, cols, options) {
      super(rows, cols, options);
      this.localDensityCallCount = 0;
    }

    localDensity(row, col, radius = GridManager.DENSITY_RADIUS) {
      this.localDensityCallCount += 1;

      return super.localDensity(row, col, radius);
    }
  }

  const rows = 12;
  const cols = 10;
  const gm = new InstrumentedGridManager(rows, cols, { stats: {} });

  gm.densityGrid = null;
  gm.densityLiveGrid = null;
  gm.densityCounts = null;
  gm.densityTotals = null;
  gm.densityRadius = 1;

  const blocked = new Set();

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if ((r * 7 + c * 13) % 9 === 0) {
        gm.setObstacle(r, c, true, { evict: false });
        blocked.add(r * cols + c);
      }

      gm.energyGrid[r][c] = (r + c + 1) * 0.1;
      gm.energyNext[r][c] = 0;
      gm.energyDeltaGrid[r][c] = 0;
    }
  }

  const maxTileEnergy = gm.maxTileEnergy;
  let expectedDensityCalls = 0;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (blocked.has(r * cols + c)) {
        continue;
      }

      const energy = gm.energyGrid[r][c];

      if (!Number.isFinite(maxTileEnergy) || maxTileEnergy <= 0) {
        expectedDensityCalls += 1;
      } else if (energy < maxTileEnergy) {
        expectedDensityCalls += 1;
      }
    }
  }

  gm.regenerateEnergyGrid(null, 1, 0.2, 0.05, null, 1);

  assert.is(
    gm.localDensityCallCount,
    expectedDensityCalls,
    "density fallback should ignore obstacle tiles",
  );
});
