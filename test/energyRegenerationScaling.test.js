import { assert, test } from "#tests/harness";

const gridManagerModulePromise = import("../src/grid/gridManager.js");

function createStubContext() {
  return {
    fillStyle: null,
    fillRect() {},
  };
}

test("energy regeneration scales with tile capacity", async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const originalInit = GridManager.prototype.init;

  try {
    GridManager.prototype.init = function initStub() {};
    const gm = new GridManager(1, 1, {
      eventManager: { activeEvents: [] },
      ctx: createStubContext(),
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
    });

    const startingEnergy = gm.maxTileEnergy / 2;

    gm.energyGrid[0][0] = startingEnergy;
    gm.regenerateEnergyGrid([], 1, 0.5, 0, [[0]], 0);

    const updatedEnergy = gm.energyGrid[0][0];
    const expectedEnergy = startingEnergy + 0.5 * (gm.maxTileEnergy - startingEnergy);

    const tolerance = 1e-9;
    const delta = Math.abs(updatedEnergy - expectedEnergy);

    assert.ok(
      delta <= tolerance,
      `regeneration should scale with remaining capacity (delta=${delta})`,
    );
  } finally {
    GridManager.prototype.init = originalInit;
  }
});

test("dirty regeneration recovers drained tiles and reports timings", async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const originalInit = GridManager.prototype.init;

  try {
    GridManager.prototype.init = function initStub() {};
    const timings = [];
    let timestamp = 0;
    const gm = new GridManager(1, 2, {
      eventManager: { activeEvents: [] },
      ctx: createStubContext(),
      cellSize: 1,
      stats: {
        onBirth() {},
        onDeath() {},
        onFight() {},
        onCooperate() {},
        recordEnergyStageTimings(entry) {
          timings.push(entry);
        },
      },
      performanceNow: () => {
        timestamp += 1;

        return timestamp;
      },
    });

    gm.energyGrid[0][0] = gm.maxTileEnergy;
    gm.energyGrid[0][1] = 0;
    gm.markEnergyDirty(0, 0, { radius: 1 });
    gm.markEnergyDirty(0, 1, { radius: 1 });

    gm.regenerateEnergyGrid([], 1, 0.5, 0.25);

    const afterFirst = gm.energyGrid[0][1];

    assert.ok(
      afterFirst > 0,
      "drained tile should regain energy after targeted regeneration",
    );

    gm.regenerateEnergyGrid([], 1, 0.5, 0.25);

    assert.ok(timings.length > 0, "timing hook should receive stage entries");
    const latest = timings.at(-1);

    assert.ok(Number.isFinite(latest.total), "timing entry should include total");
    assert.ok(latest.tileCount >= 1, "timing entry should include tile count");
  } finally {
    GridManager.prototype.init = originalInit;
  }
});

test("neighbor crowding traits modulate density penalties", async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const originalInit = GridManager.prototype.init;

  const densityGrid = [
    [0.5, 0.6, 0.5],
    [0.6, 0.85, 0.6],
    [0.5, 0.6, 0.5],
  ];
  const neighborCoords = [
    [0, 1],
    [1, 0],
    [1, 2],
    [2, 1],
  ];

  const createManager = () =>
    new GridManager(3, 3, {
      eventManager: { activeEvents: [] },
      ctx: createStubContext(),
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
    });

  const applyScenario = ({ tolerance, energyFraction }) => {
    const gm = createManager();
    const baseEnergy = gm.maxTileEnergy * 0.25;

    gm.energyGrid[1][1] = baseEnergy;

    const occupied = gm.grid;

    for (const [r, c] of neighborCoords) {
      occupied[r][c] = {
        energy: gm.maxTileEnergy * energyFraction,
        getCrowdingPreference: () => tolerance,
      };
    }

    gm.regenerateEnergyGrid([], 1, GridManager.energyRegenRate, 0, densityGrid, 1);

    return gm.energyGrid[1][1];
  };

  try {
    GridManager.prototype.init = function initStub() {};

    const suppressed = applyScenario({ tolerance: 0.1, energyFraction: 0.1 });
    const supportive = applyScenario({ tolerance: 0.9, energyFraction: 0.95 });

    const improvement = supportive - suppressed;

    assert.ok(
      improvement > 1e-6,
      `supportive crowding should reduce penalties (${supportive} <= ${suppressed})`,
    );
  } finally {
    GridManager.prototype.init = originalInit;
  }
});
