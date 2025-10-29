import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onBirth() {},
    onDeath() {},
  },
  ctx: null,
};

test("initial seeding respects DNA-driven spawn buffers", async () => {
  const [{ default: DNA }, { default: GridManager }] = await Promise.all([
    import("../src/genome.js"),
    import("../src/grid/gridManager.js"),
  ]);
  const originalRandom = DNA.random;
  const spawnCalls = [];
  const createGenome = () => {
    const dna = new DNA(120, 120, 120);

    dna.spawnEnergyBufferFrac = (context) => {
      spawnCalls.push(context);

      return 0.14;
    };
    dna.starvationThresholdFrac = () => 0.28;

    return dna;
  };

  DNA.random = () => createGenome();

  const manager = new GridManager(12, 12, {
    ...baseOptions,
    rng: () => 0.99,
    initialTileEnergyFraction: 1,
  });

  try {
    manager.init();
  } finally {
    DNA.random = originalRandom;
  }

  assert.ok(
    spawnCalls.length > 0,
    "seeding should consult the genome's spawn buffer accessor",
  );

  const seededCells = [];

  for (let r = 0; r < manager.rows; r++) {
    for (let c = 0; c < manager.cols; c++) {
      const cell = manager.getCell(r, c);

      if (cell) seededCells.push(cell);
    }
  }

  assert.ok(seededCells.length > 0, "init should seed cells when population is low");

  const expectedFraction = 0.28 + 0.14;
  const expectedEnergy = manager.maxTileEnergy * expectedFraction;

  seededCells.forEach((cell) => {
    assert.ok(
      Math.abs(cell.energy - expectedEnergy) < 1e-6,
      `seeded cell energy should match DNA preference (expected ${expectedEnergy}, received ${cell.energy})`,
    );
  });

  assert.ok(
    spawnCalls.every((context) => context && context.scarcity === 0),
    "seeding should provide scarcity context even when the signal is zero",
  );
});
