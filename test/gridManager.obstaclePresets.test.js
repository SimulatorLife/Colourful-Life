import { assert, test } from "#tests/harness";

function snapshotObstacles(grid) {
  return grid.obstacles.map((row) => row.slice());
}

test("applyObstaclePreset ignores unknown ids without clearing existing obstacles", async () => {
  const originalWindow = global.window;

  if (typeof global.window === "undefined") {
    global.window = {};
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  try {
    const gm = new TestGridManager(4, 4, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    gm.setObstacle(0, 0, true);
    gm.setObstacle(1, 1, true);
    const before = snapshotObstacles(gm);

    gm.applyObstaclePreset("does-not-exist");

    assert.equal(snapshotObstacles(gm), before);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("checkerboard preset handles negative offsets without gaps", async () => {
  const originalWindow = global.window;

  if (typeof global.window === "undefined") {
    global.window = {};
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  try {
    const gm = new TestGridManager(6, 6, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    gm.applyObstaclePreset("checkerboard", {
      clearExisting: true,
      evict: true,
      presetOptions: {
        tileSize: 2,
        offsetRow: -1,
        offsetCol: -1,
        blockParity: 1,
      },
    });

    const pattern = gm.obstacles.map((row) =>
      row.map((value) => (value ? "1" : "0")).join(""),
    );

    assert.equal(
      pattern,
      ["011001", "100110", "100110", "011001", "011001", "100110"],
      "checkerboard should wrap offsets without dropping alternating tiles",
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("resetWorld randomize selects a non-empty obstacle preset", async () => {
  const originalWindow = global.window;

  if (typeof global.window === "undefined") {
    global.window = {};
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  try {
    const gm = new TestGridManager(12, 12, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
      rng: () => 0,
    });

    gm.resetWorld({ randomizeObstacles: true, reseed: false });

    assert.not.equal(
      gm.currentObstaclePreset,
      "none",
      "randomized preset should not fallback to open field when other layouts exist",
    );

    const blockedTiles = gm.obstacles.reduce(
      (total, row) => total + row.filter(Boolean).length,
      0,
    );

    assert.ok(
      blockedTiles > 0,
      "randomized obstacle layout should paint at least one blocked tile",
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("applyObstaclePreset normalizes the stored preset identifier", async () => {
  const originalWindow = global.window;

  if (typeof global.window === "undefined") {
    global.window = {};
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  try {
    const gm = new TestGridManager(8, 8, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    gm.applyObstaclePreset(" midline \t", { clearExisting: true });

    assert.equal(
      gm.currentObstaclePreset,
      "midline",
      "grid should retain the normalized preset identifier",
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

test("corner islands preset preserves organisms in carved pockets", async () => {
  const originalWindow = global.window;

  if (typeof global.window === "undefined") {
    global.window = {};
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  try {
    const gm = new TestGridManager(12, 12, {
      eventManager: { activeEvents: [] },
      stats: {},
      ctx: {},
      cellSize: 1,
    });

    const survivors = [
      { row: 3, col: 3, cell: { id: "tl" } },
      { row: 4, col: 7, cell: { id: "tr" } },
      { row: 7, col: 4, cell: { id: "bl" } },
      { row: 7, col: 7, cell: { id: "br" } },
    ];
    const casualties = [
      { row: 0, col: 0, cell: { id: "corner" } },
      { row: 2, col: 2, cell: { id: "near-wall" } },
      { row: 6, col: 9, cell: { id: "mid" } },
      { row: 10, col: 10, cell: { id: "tail" } },
    ];

    survivors.forEach(({ row, col, cell }) => gm.placeCell(row, col, cell));
    casualties.forEach(({ row, col, cell }) => gm.placeCell(row, col, cell));

    gm.applyObstaclePreset("corner-islands", { clearExisting: true, evict: true });

    survivors.forEach(({ row, col, cell }) => {
      assert.is(gm.getCell(row, col), cell, "cells inside islands should survive");
      assert.not.ok(gm.isObstacle(row, col), "island tiles should remain unblocked");
      assert.is(
        gm.energyGrid[row][col],
        gm.maxTileEnergy / 2,
        "carved tiles should be reset to base energy",
      );
    });

    casualties.forEach(({ row, col }) => {
      assert.not.ok(gm.getCell(row, col), "blocked tiles should evict existing cells");
      assert.ok(gm.isObstacle(row, col), "non-island tiles should become obstacles");
    });
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});
