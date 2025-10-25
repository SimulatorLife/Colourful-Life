import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

test("GridManager removes cells that report starvation", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const stats = {
    deaths: 0,
    onDeath() {
      this.deaths += 1;
    },
  };
  const eventManager = { activeEvents: [] };
  const gm = new TestGridManager(1, 1, {
    eventManager,
    stats,
    ctx: {},
    cellSize: 1,
  });

  const starvingCell = {
    row: 0,
    col: 0,
    age: 0,
    lifespan: 5,
    energy: 1,
    applyEventEffects() {},
    manageEnergy() {
      return true;
    },
  };

  gm.setCell(0, 0, starvingCell);

  gm.update();

  assert.is(gm.grid[0][0], null, "starved cell should be removed from the grid");
  assert.is(stats.deaths, 1, "starvation should be reported to stats");
  assert.is(
    gm.activeCells.size,
    0,
    "starved cell should be removed from active tracking",
  );
});

test("GridManager respects configured initial tile energy fraction", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class FractionGridManager extends GridManager {
    init() {}
  }

  const fraction = 0.2;
  const gm = new FractionGridManager(3, 4, {
    eventManager: { activeEvents: [] },
    stats: {},
    ctx: {},
    cellSize: 1,
    initialTileEnergyFraction: fraction,
  });

  const expected = gm.maxTileEnergy * fraction;

  gm.energyGrid.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      approxEqual(
        value,
        expected,
        1e-12,
        `initial energy at (${rowIndex},${colIndex}) should match configured fraction`,
      );
    });
  });

  gm.resetWorld();

  gm.energyGrid.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      approxEqual(
        value,
        expected,
        1e-12,
        `reset should restore configured fraction at (${rowIndex},${colIndex})`,
      );
    });
  });
});

test("GridManager respects dynamic max tile energy", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class HarvestTestGridManager extends GridManager {
    init() {}
  }

  const originalMax = GridManager.maxTileEnergy;
  const customMax = 12;

  GridManager.maxTileEnergy = customMax;

  try {
    const gm = new HarvestTestGridManager(1, 1, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    assert.is(gm.maxTileEnergy, customMax, "instance should adopt overridden max");

    gm.energyGrid[0][0] = gm.maxTileEnergy;
    const cell = {
      dna: {
        forageRate: () => 1,
        harvestCapMin: () => 0.1,
        harvestCapMax: () => 1,
      },
      energy: gm.maxTileEnergy - 0.25,
    };

    gm.consumeEnergy(cell, 0, 0, [[0]]);
    assert.is(cell.energy, gm.maxTileEnergy, "harvesting should clamp to custom max");
    assert.ok(
      gm.energyGrid[0][0] <= gm.maxTileEnergy,
      "tile energy should not exceed max",
    );

    gm.energyGrid[0][0] = 0;
    gm.regenerateEnergyGrid([], 1, gm.maxTileEnergy * 10, 0, [[0]]);
    assert.is(
      gm.energyGrid[0][0],
      gm.maxTileEnergy,
      "regeneration should clamp to the custom ceiling",
    );
  } finally {
    GridManager.maxTileEnergy = originalMax;
  }
});

test("GridManager rehydrates empty tiles when initial energy fraction changes", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class EnergyRefreshGridManager extends GridManager {
    init() {}
  }

  const gm = new EnergyRefreshGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats: {},
    ctx: {},
    cellSize: 1,
  });

  gm.setCell(0, 0, { energy: 5 });
  gm.energyGrid[0][0] = 2;
  gm.energyGrid[1][1] = 0;
  gm.energyGrid[2][2] = 0;

  const nextFraction = 0.4;
  const expectedEnergy = gm.maxTileEnergy * nextFraction;

  gm.setInitialTileEnergyFraction(nextFraction);

  assert.is(gm.initialTileEnergyFraction, nextFraction);
  assert.is(gm.energyGrid[0][0], 2, "occupied tiles should retain their stored energy");
  assert.is(gm.energyGrid[1][1], expectedEnergy);
  assert.is(gm.energyGrid[2][2], expectedEnergy);

  gm.energyGrid[1][1] = 0;

  gm.setInitialTileEnergyFraction(nextFraction, {
    refreshEmptyTiles: true,
    forceRefresh: true,
  });

  assert.is(gm.energyGrid[1][1], expectedEnergy);
  assert.is(gm.energyNext[1][1], 0);
  assert.is(gm.energyDeltaGrid[1][1], 0);
});

test("population scarcity emits signal without forced reseeding", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class SparseGridManager extends GridManager {
    init() {}
  }

  const gm = new SparseGridManager(12, 12, {
    eventManager: { activeEvents: [] },
    stats: {},
    ctx: {},
    cellSize: 1,
    rng: () => 1,
  });

  gm.activeCells.clear();
  gm.grid.forEach((row, r) => {
    row.fill(null);
    gm.energyGrid[r].fill(gm.maxTileEnergy / 2);
  });

  const result = gm.update();

  assert.is(gm.activeCells.size, 0, "grid should remain empty without hard reseeding");
  assert.ok(
    gm.populationScarcitySignal > 0,
    "scarcity signal should reflect that population is below the minimum",
  );
  assert.ok(
    result.populationScarcity > 0,
    "snapshot should expose the scarcity indicator",
  );
});

test("resetWorld only repopulates when reseed is explicitly requested", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class ResetSeedGridManager extends GridManager {}

  const gm = new ResetSeedGridManager(8, 8, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {} },
    ctx: {},
    cellSize: 1,
    rng: () => 0.01,
  });

  assert.ok(gm.activeCells.size > 0, "constructor should perform initial seeding");

  gm.resetWorld();

  assert.is(gm.activeCells.size, 0, "default reset should leave the grid empty");

  gm.resetWorld({ reseed: true });

  assert.ok(
    gm.activeCells.size > 0,
    "explicit reseed should repopulate after clearing the world",
  );
});

test("init guarantees at least the minimum population", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  const rows = 24;
  const cols = 24;
  const gm = new GridManager(rows, cols, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {} },
    ctx: {},
    cellSize: 1,
    rng: () => 0.99,
  });

  assert.is(
    gm.activeCells.size,
    gm.minPopulation,
    "constructor seeding should top up to the minimum population",
  );
});
