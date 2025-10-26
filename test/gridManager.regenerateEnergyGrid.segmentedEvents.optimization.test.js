import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const EMPTY_EVENTS = Object.freeze([]);

test("GridManager.regenerateEnergyGrid matches accumulated modifiers for segmented events", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { accumulateEventModifiers } = await import("../src/energySystem.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const rows = 4;
  const cols = 4;
  const regenRate = 0.18;
  const diffusionRate = 0.07;
  const gm = new TestGridManager(rows, cols, {
    stats: {},
    maxTileEnergy: 10,
  });

  const baseline = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (r + c + 1) * 0.6),
  );

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      gm.energyGrid[r][c] = baseline[r][c];
      gm.energyNext[r][c] = 0;
      gm.energyDeltaGrid[r][c] = 0;
    }
  }

  const event = {
    eventType: "drought",
    strength: 0.75,
    affectedArea: { x: 1, y: 0, width: 3, height: 3 },
  };
  const events = [event];

  const state = baseline.map((row) => row.slice());
  const isEventAffecting = gm.eventContext.isEventAffecting;
  const getEventEffect = gm.eventContext.getEventEffect;

  const simulateWithAccumulate = () => {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const currentEnergy = state[r][c];
        const deficit = gm.maxTileEnergy - currentEnergy;
        let regen = 0;

        if (deficit > 0) {
          regen = regenRate * deficit;
        }

        const eventsForTile = isEventAffecting(event, r, c) ? events : EMPTY_EVENTS;
        const modifiers = accumulateEventModifiers({
          events: eventsForTile,
          row: r,
          col: c,
          eventStrengthMultiplier: 1,
          isEventAffecting,
          getEventEffect,
          effectCache: gm.eventEffectCache,
          collectAppliedEvents: false,
        });

        regen *= modifiers.regenMultiplier;
        regen += modifiers.regenAdd;

        let neighborSum = 0;
        let neighborCount = 0;

        if (r > 0) {
          neighborSum += state[r - 1][c];
          neighborCount += 1;
        }

        if (r < rows - 1) {
          neighborSum += state[r + 1][c];
          neighborCount += 1;
        }

        if (c > 0) {
          neighborSum += state[r][c - 1];
          neighborCount += 1;
        }

        if (c < cols - 1) {
          neighborSum += state[r][c + 1];
          neighborCount += 1;
        }

        let nextEnergy = currentEnergy + regen;

        if (neighborCount > 0) {
          nextEnergy += diffusionRate * (neighborSum / neighborCount - currentEnergy);
        }

        nextEnergy -= modifiers.drainAdd;

        if (nextEnergy <= 0) {
          nextEnergy = 0;
        } else if (nextEnergy >= gm.maxTileEnergy) {
          nextEnergy = gm.maxTileEnergy;
        }

        state[r][c] = nextEnergy;
      }
    }

    return state.map((row) => row.slice());
  };

  const expected = simulateWithAccumulate();

  gm.regenerateEnergyGrid(events, 1, regenRate, diffusionRate);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      approxEqual(
        gm.energyGrid[r][c],
        expected[r][c],
        1e-9,
        `energy mismatch at (${r}, ${c})`,
      );
    }
  }

  assert.ok(true, "segmented regeneration matched accumulated reference");
});
