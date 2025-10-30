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

test("energy exclusivity scans occupancy when no active cells are registered", async () => {
  const [{ default: GridManager }, { default: DNA }] = await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/genome.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
    prepareTick(options) {
      return { densityGrid: this.densityGrid, ...options };
    }
    processCell() {}
    buildSnapshot() {
      return null;
    }
  }

  const rows = 160;
  const cols = 160;
  const gm = new TestGridManager(rows, cols, baseOptions);
  const dna = new DNA(5, 10, 15);

  const occupied = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if ((row + col) % 9 === 0) {
        const cell = gm.spawnCell(row, col, {
          dna,
          spawnEnergy: gm.maxTileEnergy / 3,
        });

        if (cell) {
          gm.energyGrid[row][col] = gm.maxTileEnergy;
          occupied.push([row, col]);
        }
      }
    }
  }

  assert.ok(
    occupied.length > 2000,
    "expected dense occupancy to exercise the optimized fallback path",
  );

  gm.activeCells.clear();

  const { performance } = await import("node:perf_hooks");

  const start = performance.now();

  gm.update({
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    eventStrengthMultiplier: 1,
    densityEffectMultiplier: 1,
  });

  const elapsed = performance.now() - start;

  for (const [row, col] of occupied) {
    assert.is(
      gm.energyGrid[row][col],
      0,
      `occupied tile (${row}, ${col}) should report zero stored energy after fallback scan`,
    );
  }

  assert.ok(
    elapsed <= 120,
    `fallback scan should complete within 120ms for a ${rows}x${cols} grid, observed ${elapsed.toFixed(3)}ms`,
  );
});

test("spawnCell reroutes leftover tile energy to open neighbors", async () => {
  const [{ default: GridManager }, { default: DNA }] = await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/genome.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  const gm = new TestGridManager(3, 3, baseOptions);
  const dna = new DNA(12, 24, 36);
  const sourceEnergy = gm.maxTileEnergy;
  const spawnEnergy = sourceEnergy / 2;

  gm.energyGrid[1][1] = sourceEnergy;
  gm.energyGrid[0][1] = 0;
  gm.energyGrid[2][1] = 0;
  gm.energyGrid[1][0] = 0;
  gm.energyGrid[1][2] = 0;

  const spawned = gm.spawnCell(1, 1, { dna, spawnEnergy });

  assert.ok(spawned, "spawnCell should materialize a resident when the tile is open");

  const expectedEnergy = Math.min(gm.maxTileEnergy, spawnEnergy, sourceEnergy);

  assert.is(
    spawned.energy,
    expectedEnergy,
    "new residents must not absorb more energy than the cleared tile provided",
  );

  assert.is(gm.energyGrid[1][1], 0, "occupied tile should report zero stored energy");

  const redistributed =
    gm.energyGrid[0][1] +
    gm.energyGrid[2][1] +
    gm.energyGrid[1][0] +
    gm.energyGrid[1][2];

  assert.is(
    redistributed,
    sourceEnergy - spawnEnergy,
    "leftover tile energy should spill into adjacent empty cells",
  );
});

test("reproduction immediately clears spawn tile energy", async () => {
  const [
    { default: GridManager },
    { default: Cell },
    { default: DNA },
    { MAX_TILE_ENERGY },
  ] = await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/cell.js"),
    import("../src/genome.js"),
    import("../src/config.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  let birth = null;
  const stats = {
    onBirth(offspring, details) {
      birth = { offspring, details };
    },
    onDeath() {},
    recordMateChoice() {},
    recordReproductionBlocked() {},
  };

  const gm = new TestGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.densityGrid = Array.from({ length: gm.rows }, () =>
    Array.from({ length: gm.cols }, () => 0),
  );

  const parentDNA = new DNA(0, 0, 0);
  const mateDNA = new DNA(0, 0, 0);
  const parent = new Cell(1, 1, parentDNA, MAX_TILE_ENERGY);
  const mate = new Cell(1, 2, mateDNA, MAX_TILE_ENERGY);

  for (const individual of [parent, mate]) {
    individual.dna.reproductionThresholdFrac = () => 0;
    individual.dna.parentalInvestmentFrac = () => 0.4;
    individual.dna.starvationThresholdFrac = () => 0;
  }

  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(parent.row, parent.col, parent);
  gm.setCell(mate.row, mate.col, mate);

  const energizedTiles = new Map();

  const recordEnergy = (row, col, energy) => {
    const key = `${row},${col}`;

    energizedTiles.set(key, energy);
  };

  for (let r = 0; r < gm.rows; r++) {
    for (let c = 0; c < gm.cols; c++) {
      if (gm.getCell(r, c)) continue;

      const hasParentNeighbor =
        Math.abs(r - parent.row) <= 1 && Math.abs(c - parent.col) <= 1;
      const hasMateNeighbor =
        Math.abs(r - mate.row) <= 1 && Math.abs(c - mate.col) <= 1;

      if (hasParentNeighbor || hasMateNeighbor) {
        gm.energyGrid[r][c] = gm.maxTileEnergy / 2;
        recordEnergy(r, c, gm.energyGrid[r][c]);
      }
    }
  }

  const reproductionArgs = {
    mates: [mateEntry],
    society: [],
  };
  const context = {
    stats,
    densityGrid: gm.densityGrid,
    densityEffectMultiplier: 1,
    mutationMultiplier: 1,
  };

  const reproduced = gm.handleReproduction(
    parent.row,
    parent.col,
    parent,
    reproductionArgs,
    context,
  );

  assert.is(reproduced, true, "reproduction attempt should succeed");
  assert.ok(birth, "stats should receive birth details");

  const spawnRow = birth.details.row;
  const spawnCol = birth.details.col;
  const spawnKey = `${spawnRow},${spawnCol}`;
  const preSpawnEnergy = energizedTiles.get(spawnKey);

  assert.ok(
    preSpawnEnergy > 0,
    "spawn tile should have stored energy before reproduction",
  );
  assert.is(
    gm.energyGrid[spawnRow][spawnCol],
    0,
    "spawn tile energy should be cleared immediately",
  );
  assert.ok(
    birth.offspring.energy > 0,
    "offspring should retain invested energy after absorbing the tile",
  );
});
