import { assert, test } from "#tests/harness";

const statsModulePromise = import("../src/stats/index.js");

const createCellFactory = (seedCounters) => (id) => {
  const dna = {
    id,
    reproductionProb: () => 0,
    similarity(other) {
      if (!other || typeof other.id !== "number") {
        return 1;
      }

      return other.id === id ? 1 : 0.5;
    },
    seed() {
      const next = (seedCounters.get(id) ?? 0) + 1;

      seedCounters.set(id, next);

      return id;
    },
  };

  return { dna };
};

test("estimateDiversity caches DNA seeds across repeated invocations", async () => {
  const { default: Stats } = await statsModulePromise;
  const seedCounters = new Map();
  const makeCell = createCellFactory(seedCounters);
  const cells = Array.from({ length: 8 }, (_, index) => makeCell(index));
  const stats = new Stats();

  // First pass should resolve each seed once.
  stats.estimateDiversity(cells, Infinity);
  // Subsequent passes reuse cached seeds even when switching sampling modes.
  stats.estimateDiversity(cells, Infinity);
  stats.estimateDiversity(cells, 5);

  for (let index = 0; index < cells.length; index += 1) {
    assert.strictEqual(
      seedCounters.get(index),
      1,
      `expected seed() to run once for dna ${index}`,
    );
  }

  // Adding a new genome triggers a fresh seed lookup only for the newcomer.
  const newcomer = makeCell(cells.length);

  cells.push(newcomer);
  stats.estimateDiversity(cells, Infinity);

  assert.strictEqual(seedCounters.get(cells.length - 1), 1);
  for (let index = 0; index < cells.length - 1; index += 1) {
    assert.strictEqual(
      seedCounters.get(index),
      1,
      `cached dna ${index} should not recompute its seed`,
    );
  }
});
