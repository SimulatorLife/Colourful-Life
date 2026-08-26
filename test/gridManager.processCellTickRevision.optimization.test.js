import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
    onFight() {},
    onCooperate() {},
    recordMateChoice() {},
  },
  ctx: {},
  cellSize: 1,
};

function createStubCell({
  id = "stub",
  energy = 5,
  age = 0,
  reproductionCooldown = 0,
} = {}) {
  return {
    id,
    row: 0,
    col: 0,
    age,
    lifespan: 1000,
    energy,
    reproductionCooldown,
    fitness: 0,
    fightsWon: 0,
    offspring: 0,
    density: { enemyBias: { min: 0, max: 0 } },
    dna: {
      activityRate: () => 0,
      reproductionThresholdFrac: () => 0,
      allyThreshold: () => 0.9,
      enemyThreshold: () => 0.1,
      riskTolerance: () => 0.5,
      matingThreshold: () => 0.5,
    },
    getRiskTolerance: () => 0.5,
    similarityTo() {
      return 0;
    },
    applyEventEffects() {},
    manageEnergy() {
      return false;
    },
    move() {
      return false;
    },
    tryMate() {
      return null;
    },
    resolveCombat() {
      return false;
    },
  };
}

test("processCell dedupes the same cell twice in one tick via the revision tracker", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class HooksGrid extends GridManager {
    init() {}
    findTargets() {
      return { mates: [], enemies: [], society: [] };
    }
  }

  const gm = new HooksGrid(2, 1, baseOptions);
  const cell = createStubCell({ id: "tick-rev", age: 4 });

  gm.setCell(0, 0, cell);
  // Force the activeCells snapshot to include the cell twice so the update
  // loop visits it twice and exercises the in-tick dedupe path.
  gm.activeCells.add(cell);

  const beforeAge = cell.age;

  gm.update({});

  assert.is(
    cell.age,
    beforeAge + 1,
    "second visit must be suppressed inside the same tick",
  );
});

test("processCell re-processes a cell on the next tick once the revision advances", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class HooksGrid extends GridManager {
    init() {}
    findTargets() {
      return { mates: [], enemies: [], society: [] };
    }
  }

  const gm = new HooksGrid(1, 1, baseOptions);
  const cell = createStubCell({ id: "next-tick", age: 2 });

  gm.setCell(0, 0, cell);

  gm.update({});
  const ageAfterFirst = cell.age;

  gm.update({});

  assert.ok(
    cell.age > ageAfterFirst,
    "cell must be processed again when the per-tick revision advances",
  );
});

test("processCell still honours an explicit WeakSet passed by legacy callers", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class HooksGrid extends GridManager {
    init() {}
    findTargets() {
      return { mates: [], enemies: [], society: [] };
    }
  }

  const gm = new HooksGrid(1, 1, baseOptions);
  const cell = createStubCell({ id: "legacy-weaks", age: 7 });

  gm.setCell(0, 0, cell);

  const stats = {
    onBirth() {},
    onDeath() {},
    onFight() {},
    onCooperate() {},
    recordMateChoice() {},
  };
  const processed = new WeakSet();

  gm.processCell(0, 0, {
    stats,
    eventManager: { activeEvents: [] },
    densityGrid: [[0]],
    processed,
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
    eventStrengthMultiplier: 1,
    mutationMultiplier: 1,
  });

  const ageAfterFirst = cell.age;

  gm.processCell(0, 0, {
    stats,
    eventManager: { activeEvents: [] },
    densityGrid: [[0]],
    processed,
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
    eventStrengthMultiplier: 1,
    mutationMultiplier: 1,
  });

  assert.is(
    cell.age,
    ageAfterFirst,
    "explicit WeakSet must still suppress duplicate processCell work",
  );
});

test("processCell revision tracker tolerates plain-object cells with no WeakSet helpers", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class HooksGrid extends GridManager {
    init() {}
    findTargets() {
      return { mates: [], enemies: [], society: [] };
    }
  }

  const gm = new HooksGrid(1, 1, baseOptions);
  // Object.create(null) intentionally avoids the prototype chain to confirm
  // the revision stamp lives on the cell record via a Symbol-keyed property.
  const cell = Object.create(null);

  cell.id = "plain";
  cell.row = 0;
  cell.col = 0;
  cell.age = 0;
  cell.lifespan = 1000;
  cell.energy = 5;
  cell.reproductionCooldown = 0;
  cell.fitness = 0;
  cell.fightsWon = 0;
  cell.offspring = 0;
  cell.density = { enemyBias: { min: 0, max: 0 } };
  cell.dna = {
    activityRate: () => 0,
    reproductionThresholdFrac: () => 0,
    allyThreshold: () => 0.9,
    enemyThreshold: () => 0.1,
    riskTolerance: () => 0.5,
    matingThreshold: () => 0.5,
  };
  cell.getRiskTolerance = () => 0.5;
  cell.similarityTo = () => 0;
  cell.applyEventEffects = () => {};
  cell.manageEnergy = () => false;
  cell.move = () => false;
  cell.tryMate = () => null;
  cell.resolveCombat = () => false;

  gm.setCell(0, 0, cell);

  gm.update({});

  assert.ok(cell.age > 0, "plain-object cells must survive the revision stamp path");
});
