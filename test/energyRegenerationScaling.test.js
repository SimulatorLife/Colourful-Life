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
