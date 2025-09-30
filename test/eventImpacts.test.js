import { test } from "uvu";
import * as assert from "uvu/assert";
import { approxEqual } from "./helpers/assertions.js";

if (typeof globalThis.window === "undefined") {
  globalThis.window = {};
}

test("GridManager.regenerateEnergyGrid applies event effect modifiers", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const affectedArea = { x: 0, y: 0, width: 1, height: 1 };

  const floodManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
  });

  floodManager.energyGrid = [[1]];
  floodManager.energyNext = [[0]];
  floodManager.regenerateEnergyGrid(
    [{ eventType: "flood", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(floodManager.energyGrid[0][0], 2.05);

  const droughtManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
  });

  droughtManager.energyGrid = [[1]];
  droughtManager.energyNext = [[0]];
  droughtManager.regenerateEnergyGrid(
    [{ eventType: "drought", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(droughtManager.energyGrid[0][0], 1.14);
});

test("Cell.applyEventEffects uses event mapping and DNA resistance", async () => {
  const { default: Cell } = await import("../src/cell.js");

  const event = {
    eventType: "heatwave",
    strength: 1,
    affectedArea: { x: 0, y: 0, width: 2, height: 2 },
  };

  const cell = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0.4,
      heatResist: () => 0.3,
    },
  });

  cell.applyEventEffects(0, 0, event, 1, 5);
  approxEqual(cell.energy, 1.804, 1e-3);

  const unaffected = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0,
      heatResist: () => 0,
    },
  });

  unaffected.applyEventEffects(5, 5, event, 1, 5);
  assert.is(unaffected.energy, 2);
});

test.run();
