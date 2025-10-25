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
  const rngInvocations = [];
  const rngSequence = [0.62, 0.71, 0.83, 0.64, 0.19, 0.58, 0.42, 0.27, 0.35];
  let rngCallIndex = 0;

  const rng = () => {
    if (rngCallIndex >= rngSequence.length) {
      throw new Error(`rngSequence exhausted at index ${rngCallIndex}`);
    }

    const value = rngSequence[rngCallIndex];

    rngCallIndex += 1;

    return value;
  };

  DNA.random = (rngFn) => {
    assert.type(
      rngFn,
      "function",
      "GridManager should supply an RNG factory to DNA.random",
    );

    const before = rngCallIndex;
    const sample = rngFn();
    const after = rngCallIndex;

    rngInvocations.push({ before, after, sample });

    return originalRandom(() => 0);
  };

  try {
    const { default: GridManager } = await import("../src/grid/gridManager.js");
    const manager = new GridManager(2, 2, { ...baseOptions, rng });

    manager.spawnCell(0, 0);
    manager.spawnCell(0, 1);
    assert.is(manager.burstAt(1, 1, { count: 1, radius: 0 }), 1);
  } finally {
    DNA.random = originalRandom;
  }

  assert.is(
    rngInvocations.length,
    3,
    "expected RNG-backed DNA generation for each spawn path",
  );

  const initialOffset = rngInvocations[0]?.before ?? 0;

  rngInvocations.forEach(({ before, after, sample }, index) => {
    assert.is(
      before,
      initialOffset + index,
      "RNG draws should advance sequentially per DNA spawn",
    );
    assert.is(
      after,
      before + 1,
      "DNA.random should consume the manager RNG exactly once",
    );
    assert.is(
      sample,
      rngSequence[before],
      `DNA.random invocation ${index + 1} should observe the injected RNG sequence`,
    );
  });

  const lastInvocation = rngInvocations[rngInvocations.length - 1];

  assert.is(
    rngCallIndex,
    lastInvocation?.after ?? rngCallIndex,
    "RNG call count should align with the final DNA.random invocation",
  );
});
