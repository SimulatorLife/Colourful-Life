import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
};

const noopStats = {
  onBirth() {},
  onDeath() {},
  recordMateChoice() {},
  recordReproductionBlocked() {},
};

test("GridManager update never conjures new residents without reproduction", async () => {
  const [{ default: GridManager }] = await Promise.all([
    import("../src/grid/gridManager.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  let birthCount = 0;
  const stats = {
    ...noopStats,
    onBirth() {
      birthCount += 1;
    },
  };

  const gm = new TestGridManager(12, 12, {
    ...baseOptions,
    stats,
  });

  for (let row = 0; row < gm.rows; row += 1) {
    for (let col = 0; col < gm.cols; col += 1) {
      gm.energyGrid[row][col] = gm.maxTileEnergy;
    }
  }

  gm.recalculateDensityCounts();
  gm.rebuildActiveCells();

  assert.is(gm.activeCells.size, 0, "precondition: grid starts empty");

  const snapshot = gm.update({
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    eventStrengthMultiplier: 1,
    densityEffectMultiplier: 1,
  });

  assert.is(birthCount, 0, "Law 7 forbids births without living parents");
  assert.is(snapshot.population, 0, "snapshot should report zero residents");
  assert.is(gm.activeCells.size, 0, "activeCells should remain empty");
  assert.ok(
    gm.populationScarcitySignal > 0,
    "scarcity detection should not trigger spontaneous spawns",
  );

  for (let row = 0; row < gm.rows; row += 1) {
    for (let col = 0; col < gm.cols; col += 1) {
      assert.is(
        gm.grid[row][col],
        null,
        `tiles must remain empty without reproduction (row ${row}, col ${col})`,
      );
    }
  }
});
