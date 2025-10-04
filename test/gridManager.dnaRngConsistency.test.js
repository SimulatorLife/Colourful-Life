import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
    recordMateChoice() {},
  },
  ctx: {},
  cellSize: 1,
};

test("burstAt uses the grid RNG for DNA generation", async () => {
  const [{ default: GridManager }] = await Promise.all([
    import("../src/grid/gridManager.js"),
  ]);

  class TestGridManager extends GridManager {
    init() {}
  }

  const rngValues = [0.1, 0.2, 0.3];
  let rngCallCount = 0;
  const rng = () => {
    const value = rngValues[rngCallCount % rngValues.length];

    rngCallCount += 1;

    return value;
  };

  const originalRandom = Math.random;
  let mathRandomCalls = 0;

  Math.random = () => {
    mathRandomCalls += 1;

    return 0.5;
  };

  try {
    const gm = new TestGridManager(5, 5, { ...baseOptions, rng });
    const before = mathRandomCalls;

    gm.burstAt(2, 2, { count: 1, radius: 0 });

    assert.is(
      mathRandomCalls,
      before,
      "burstAt should not invoke Math.random when generating DNA",
    );
    assert.ok(gm.grid[2][2], "burstAt should spawn a cell at the target tile");
    assert.ok(rngCallCount > 0, "burstAt should use the injected RNG for DNA");
  } finally {
    Math.random = originalRandom;
  }
});
