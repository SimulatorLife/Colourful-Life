import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

test("GridManager.regenerateEnergyGrid matches accumulated modifiers for segmented events", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { accumulateEventModifiers } = await import("../src/events/eventModifiers.js");

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

  const events = [
    {
      eventType: "drought",
      strength: 0.75,
      affectedArea: { x: 0, y: 0, width: 4, height: 3 },
    },
    {
      eventType: "flood",
      strength: 0.5,
      affectedArea: { x: 2, y: 1, width: 2, height: 2 },
    },
  ];

  const isEventAffecting = gm.eventContext.isEventAffecting;
  const getEventEffect = gm.eventContext.getEventEffect;

  const simulateWithAccumulate = () => {
    const energy = baseline.map((row) => row.slice());
    const delta = baseline.map(() => Array(cols).fill(0));
    const next = baseline.map(() => Array(cols).fill(0));

    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const currentEnergy = energy[r][c];
        const deficit = gm.maxTileEnergy - currentEnergy;
        let regen = 0;

        if (deficit > 0) {
          regen = regenRate * deficit;
        }

        const eventsForTile = events.filter((ev) => isEventAffecting(ev, r, c));
        const modifiers = accumulateEventModifiers({
          events: eventsForTile,
          row: r,
          col: c,
          eventStrengthMultiplier: 1,
          isEventAffecting,
          getEventEffect,
          collectAppliedEvents: false,
        });

        regen *= modifiers.regenMultiplier;
        regen += modifiers.regenAdd;

        let neighborSum = 0;
        let neighborCount = 0;

        if (r > 0) {
          neighborSum += energy[r - 1][c];
          neighborCount += 1;
        }

        if (r < rows - 1) {
          neighborSum += energy[r + 1][c];
          neighborCount += 1;
        }

        if (c > 0) {
          neighborSum += energy[r][c - 1];
          neighborCount += 1;
        }

        if (c < cols - 1) {
          neighborSum += energy[r][c + 1];
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

        energy[r][c] = nextEnergy;
        next[r][c] = nextEnergy;

        let normalizedDelta = (nextEnergy - currentEnergy) / gm.maxTileEnergy;

        if (!Number.isFinite(normalizedDelta)) {
          normalizedDelta = 0;
        } else if (normalizedDelta < -1) {
          normalizedDelta = -1;
        } else if (normalizedDelta > 1) {
          normalizedDelta = 1;
        }

        delta[r][c] = normalizedDelta;
      }
    }

    return {
      energy,
      next,
      delta,
    };
  };

  const expected = simulateWithAccumulate();

  gm.regenerateEnergyGrid(events, 1, regenRate, diffusionRate);

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      approxEqual(
        gm.energyGrid[r][c],
        expected.energy[r][c],
        1e-9,
        `energy mismatch at (${r}, ${c})`,
      );
      approxEqual(
        gm.energyNext[r][c],
        expected.next[r][c],
        1e-9,
        `next energy mismatch at (${r}, ${c})`,
      );
      approxEqual(
        gm.energyDeltaGrid[r][c],
        expected.delta[r][c],
        1e-9,
        `delta mismatch at (${r}, ${c})`,
      );
    }
  }

  const overlappingTile = { row: 1, col: 3 };

  assert.ok(
    overlappingTile.row < rows && overlappingTile.col < cols,
    "overlapping tile should be within bounds",
  );
  approxEqual(
    gm.energyGrid[overlappingTile.row][overlappingTile.col],
    expected.energy[overlappingTile.row][overlappingTile.col],
    1e-9,
    "tile influenced by multiple events should combine regen multiplier and additive effects",
  );

  const outsideTile = { row: rows - 1, col: cols - 1 };
  const outsideModifiers = accumulateEventModifiers({
    events,
    row: outsideTile.row,
    col: outsideTile.col,
    eventStrengthMultiplier: 1,
    isEventAffecting,
    getEventEffect,
    collectAppliedEvents: false,
  });

  approxEqual(
    outsideModifiers.regenMultiplier,
    1,
    1e-12,
    "tiles outside event bounds should not receive multiplicative modifiers",
  );
  approxEqual(
    outsideModifiers.regenAdd,
    0,
    1e-12,
    "tiles outside event bounds should not receive additive regen",
  );
  approxEqual(
    outsideModifiers.drainAdd,
    0,
    1e-12,
    "tiles outside event bounds should not incur drain",
  );

  assert.ok(
    gm.eventEffectCache.has("drought") && gm.eventEffectCache.has("flood"),
    "segmented regeneration should reuse cached event effects",
  );
});
