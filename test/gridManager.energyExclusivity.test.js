import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
    recordMateChoice() {},
  },
  ctx: {},
  cellSize: 1,
};

test("relocateCell immediately clears destination tile energy", async () => {
  const [{ default: GridManager }, { default: DNA }] = await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/genome.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(2, 2, baseOptions);
  const dna = new DNA(5, 10, 15);
  const cell = gm.spawnCell(0, 0, { dna, spawnEnergy: gm.maxTileEnergy / 2 });

  gm.energyGrid[0][1] = 2;

  const relocated = gm.relocateCell(0, 0, 0, 1);

  assert.ok(relocated, "relocateCell should succeed when destination is empty");

  assert.is(
    gm.energyGrid[0][1],
    0,
    "destination tile energy should be cleared immediately",
  );
  assert.ok(
    cell.energy >= gm.maxTileEnergy / 2,
    "mover should retain at least its pre-move reserves",
  );
});

test("update enforces energy exclusivity across the grid", async () => {
  const [{ default: GridManager }, { default: DNA }] = await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/genome.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);
  const dna = new DNA(20, 40, 60);

  const cell = gm.spawnCell(1, 1, { dna, spawnEnergy: gm.maxTileEnergy / 2 });

  gm.energyGrid[1][1] = 1.5;
  gm.energyGrid[0][1] = gm.maxTileEnergy;

  gm.update({
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    eventStrengthMultiplier: 1,
    densityEffectMultiplier: 1,
  });

  for (let row = 0; row < gm.rows; row++) {
    for (let col = 0; col < gm.cols; col++) {
      if (gm.grid[row][col]) {
        assert.is(
          gm.energyGrid[row][col],
          0,
          `occupied tile (${row}, ${col}) should not report stored energy`,
        );
      }
    }
  }

  assert.ok(
    cell.energy >= gm.maxTileEnergy / 2,
    "resident should retain at least its pre-update reserves",
  );
});
