import { assert, test } from "#tests/harness";

class StubStats {
  constructor() {
    this.deaths = [];
  }

  onDeath(cell, details) {
    this.deaths.push({ cell, details });
  }
}

test("GridManager supplies senescence context to cells", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
    prepareTick(options) {
      const output = super.prepareTick(options);

      if (output?.densityGrid?.[0]?.[0] != null) {
        output.densityGrid[0][0] = this.mockDensity;
      }

      this.densityGrid = output?.densityGrid ?? this.densityGrid;

      return output;
    }
  }

  const stats = new StubStats();
  const rng = () => 0.9;
  const gm = new TestGridManager(1, 1, {
    stats,
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    rng,
  });

  gm.mockDensity = 0.6;
  gm.energyGrid[0][0] = gm.maxTileEnergy;

  const contexts = [];
  const cell = {
    row: 0,
    col: 0,
    age: 20,
    lifespan: 40,
    energy: gm.maxTileEnergy * 0.75,
    lastEventPressure: 0.35,
    computeSenescenceHazard(context) {
      contexts.push(context);

      return 0;
    },
    applyEventEffects() {},
    manageEnergy() {
      return false;
    },
    dna: {
      activityRate: () => 0,
    },
  };

  const initialAge = cell.age;
  const expectedEnergyFraction =
    cell.energy / (gm.maxTileEnergy > 0 ? gm.maxTileEnergy : 1);

  gm.setCell(0, 0, cell);
  gm.update({ densityEffectMultiplier: 1.3 });

  assert.is(contexts.length, 1, "hazard should be evaluated exactly once");
  const [context] = contexts;
  const expectedAgeFraction = (initialAge + 1) / cell.lifespan;

  assert.ok(
    Math.abs(context.ageFraction - expectedAgeFraction) < 1e-6,
    "age fraction should reflect post-increment age",
  );
  assert.is(
    context.localDensity,
    gm.mockDensity,
    "local density should mirror prepared grid",
  );
  assert.is(
    context.densityEffectMultiplier,
    1.3,
    "density multiplier should be forwarded",
  );
  assert.ok(
    Math.abs(context.energyFraction - expectedEnergyFraction) < 1e-6,
    "energy fraction should normalize against tile capacity",
  );
  assert.is(
    context.eventPressure,
    cell.lastEventPressure,
    "event pressure should pass through",
  );
  assert.is(gm.grid[0][0], cell, "cell should remain when hazard reports zero");
});

test("GridManager applies senescence hazard probabilities", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const stats = new StubStats();
  const gm = new TestGridManager(1, 1, {
    stats,
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    rng: () => 0.99,
  });

  const hazardValue = 0.4;
  const cell = {
    row: 0,
    col: 0,
    age: 30,
    lifespan: 40,
    energy: gm.maxTileEnergy * 0.5,
    lastEventPressure: 0,
    computeSenescenceHazard: () => hazardValue,
    resolveRng() {
      return () => 0.2;
    },
    applyEventEffects() {},
    manageEnergy() {
      return false;
    },
    dna: {
      activityRate: () => 0,
    },
  };

  gm.setCell(0, 0, cell);
  gm.update();

  assert.is(gm.grid[0][0], null, "hazard roll below threshold should remove the cell");
  assert.is(stats.deaths.length, 1, "senescence death should be recorded exactly once");
  const [{ details }] = stats.deaths;

  assert.is(details.cause, "senescence", "death cause should identify senescence");
  assert.ok(
    Math.abs(details.hazard - hazardValue) < 1e-6,
    "reported hazard should match the computed probability",
  );
});
