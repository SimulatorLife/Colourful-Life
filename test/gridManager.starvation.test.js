import { assert, test } from "#tests/harness";

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

test("reseeding respects available tile energy reserves", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class ReseedTestGridManager extends GridManager {
    init() {}
  }

  const gm = new ReseedTestGridManager(10, 10, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {} },
    ctx: {},
    cellSize: 1,
    rng: () => 0.5,
  });

  const baseTileReserve = gm.maxTileEnergy / 2;
  const initialTotalTileEnergy = gm.energyGrid.reduce(
    (sum, row) => sum + row.reduce((rowSum, value) => rowSum + value, 0),
    0,
  );

  gm.activeCells.clear();
  gm.seed(0, gm.minPopulation);

  let tileEnergyAfter = 0;
  let cellEnergyAfter = 0;

  for (let row = 0; row < gm.rows; row++) {
    for (let col = 0; col < gm.cols; col++) {
      tileEnergyAfter += gm.energyGrid[row][col];
      const cell = gm.grid[row][col];

      if (cell) {
        cellEnergyAfter += cell.energy;
        assert.ok(
          cell.energy <= baseTileReserve,
          `Seeded cell energy should not exceed local tile reserves (received ${cell.energy})`,
        );
      }
    }
  }

  const totalEnergyAfter = tileEnergyAfter + cellEnergyAfter;

  assert.ok(
    totalEnergyAfter <= initialTotalTileEnergy + 1e-6,
    `Reseeding should not create energy (expected ≤ ${initialTotalTileEnergy}, received ${totalEnergyAfter})`,
  );
});

test("auto reseed prioritizes energetic, low-crowding tiles", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class AutoSeedGridManager extends GridManager {
    init() {}
  }

  const gm = new AutoSeedGridManager(4, 4, {
    eventManager: { activeEvents: [] },
    stats: { onBirth() {} },
    ctx: {},
    cellSize: 1,
    rng: () => 0,
  });

  gm.activeCells.clear();
  gm.grid.forEach((row) => row.fill(null));
  gm.energyGrid.forEach((row) => row.fill(0));

  gm.energyGrid[0][0] = gm.maxTileEnergy * 0.6;
  gm.energyGrid[1][1] = gm.maxTileEnergy * 0.55;
  gm.energyGrid[2][2] = gm.maxTileEnergy * 0.4;
  gm.energyGrid[3][3] = gm.maxTileEnergy * 0.02;

  gm.minPopulation = 3;

  gm.seed(0, gm.minPopulation);

  const seeded = [];

  gm.grid.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell) {
        seeded.push({ r, c, energy: cell.energy });
      }
    });
  });

  assert.deepEqual(
    seeded.map(({ r, c }) => `${r}:${c}`).sort(),
    ["0:0", "1:1", "2:2"],
    "auto seeding should prioritize the richest available tiles",
  );

  seeded.forEach(({ energy }) => {
    assert.ok(
      energy >= gm.maxTileEnergy * 0.25,
      `seeded cells should begin with a survivable reserve (received ${energy})`,
    );
  });
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
