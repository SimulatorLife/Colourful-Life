import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const gridManagerModulePromise = import("../src/grid/gridManager.js");

function createStubContext() {
  return {
    fillStyle: null,
    fillRect() {},
  };
}

const NEAR_ONE_EFFECT = {
  regenScale: { base: 1, change: 1e-10, min: 0 },
};

test("regenerateEnergyGrid skips regen multiplier when floating-point drift leaves the value within epsilon of 1", async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const originalInit = GridManager.prototype.init;

  try {
    GridManager.prototype.init = function initStub() {};

    const rows = 1;
    const cols = 2;
    const gm = new GridManager(rows, cols, {
      eventManager: { activeEvents: [] },
      ctx: createStubContext(),
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
      eventContext: {
        getEventEffect: (eventType) =>
          eventType === "near-one" ? NEAR_ONE_EFFECT : null,
      },
    });

    const startingEnergy = gm.maxTileEnergy / 2;

    gm.energyGrid[0][0] = startingEnergy;
    gm.energyGrid[0][1] = startingEnergy;
    gm.energyNext[0][0] = 0;
    gm.energyNext[0][1] = 0;
    gm.energyDeltaGrid[0][0] = 0;
    gm.energyDeltaGrid[0][1] = 0;

    const nearOneEvents = [
      {
        eventType: "near-one",
        strength: 1,
        affectedArea: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];

    gm.regenerateEnergyGrid(nearOneEvents, 1, 0.5, 0, [[0], [0]]);

    const tiledEnergy = gm.energyGrid[0][0];
    const cleanEnergy = gm.energyGrid[0][1];

    const regen = 0.5 * (gm.maxTileEnergy - startingEnergy);
    const cleanExpected = startingEnergy + regen;

    approxEqual(
      cleanEnergy,
      cleanExpected,
      1e-12,
      "tile with no events should regenerate at the base rate",
    );

    approxEqual(
      tiledEnergy,
      cleanExpected,
      1e-12,
      "tile whose regen multiplier is within floating-point noise of 1 should match the no-event baseline",
    );

    const divergence = Math.abs(tiledEnergy - cleanEnergy);

    assert.ok(
      divergence < 1e-11,
      `tile with near-one multiplier should not measurably diverge from baseline (|Δ|=${divergence})`,
    );

    const eventModifiers = (
      await import("../src/events/eventModifiers.js")
    ).accumulateEventModifiers({
      events: nearOneEvents,
      row: 0,
      col: 0,
      eventStrengthMultiplier: 1,
      isEventAffecting: gm.eventContext.isEventAffecting,
      getEventEffect: gm.eventContext.getEventEffect,
      collectAppliedEvents: false,
    });

    const drift = Math.abs(eventModifiers.regenMultiplier - 1);

    assert.ok(
      drift > 0 && drift < 1e-9,
      `regenMultiplier should drift from 1 but stay within epsilon (drift=${drift})`,
    );
  } finally {
    GridManager.prototype.init = originalInit;
  }
});
