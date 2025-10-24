import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
  },
  ctx: null,
  cellSize: 1,
};

test("GridManager DNA generation uses injected RNG", async () => {
  const { default: DNA } = await import("../src/genome.js");
  const originalRandom = DNA.random;
  const rngArgs = [];

  DNA.random = (rngFn) => {
    rngArgs.push(rngFn);

    return originalRandom(() => 0);
  };

  try {
    const { default: GridManager } = await import("../src/grid/gridManager.js");
    const rngSequence = [0.01, 0.5, 0.99, 0.02, 0.6];
    let index = 0;
    const rng = () => {
      const value = rngSequence[index % rngSequence.length];

      index += 1;

      return value;
    };
    const manager = new GridManager(4, 4, { ...baseOptions, rng });

    manager.spawnCell(0, 0);
    manager.init();
    manager.burstRandomCells({ count: 3, radius: 1 });
  } finally {
    DNA.random = originalRandom;
  }

  assert.ok(rngArgs.length > 0, "DNA.random should be invoked during grid operations");
  assert.ok(
    rngArgs.every((fn) => typeof fn === "function"),
    "GridManager should pass its RNG to DNA.random",
  );
});
