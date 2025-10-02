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
