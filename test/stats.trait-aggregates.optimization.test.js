import { test, assert } from "#tests/harness";
import { accumulateTraitAggregates } from "../src/utils/traitAggregation.js";

const hasOwn = Object.hasOwn;

function baselineAccumulateTraitAggregates(
  pool,
  traitComputes,
  traitThresholds,
  traitSums,
  traitActiveCounts,
) {
  const sources = Array.isArray(pool) ? pool : [];
  const computes = Array.isArray(traitComputes) ? traitComputes : [];
  const thresholds = Array.isArray(traitThresholds) ? traitThresholds : [];

  return sources.reduce((count, source) => {
    const cell =
      source && typeof source === "object" && hasOwn(source, "cell")
        ? source.cell
        : source;

    if (!cell || typeof cell !== "object") {
      return count;
    }

    computes.forEach((compute, traitIndex) => {
      const value = compute(cell) || 0;

      traitSums[traitIndex] += value;

      if (value >= thresholds[traitIndex]) {
        traitActiveCounts[traitIndex] += 1;
      }
    });

    return count + 1;
  }, 0);
}

function createTraitComputes(traitCount) {
  return Array.from({ length: traitCount }, (_, traitIndex) => (cell) => {
    const traits = cell?.traits;

    if (!Array.isArray(traits)) {
      return 0;
    }

    const value = traits[traitIndex];

    return typeof value === "number" ? value : 0;
  });
}

function createTraitThresholds(traitCount) {
  return Array.from({ length: traitCount }, (_, index) => 0.2 + (index % 5) * 0.15);
}

function createCellPool(cellCount, traitCount) {
  const computeValue = (seed, traitIndex) => {
    const angle = (seed * (traitIndex + 3)) % 360;

    return Math.abs(Math.sin((angle / 180) * Math.PI));
  };

  return Array.from({ length: cellCount }, (_, index) => {
    const traits = Array.from({ length: traitCount }, (_, traitIndex) =>
      computeValue(index + 1, traitIndex + 1),
    );
    const cell = { id: index, traits };

    return index % 2 === 0 ? { cell } : cell;
  });
}

test("accumulateTraitAggregates matches baseline results", () => {
  const traitCount = 12;
  const cellCount = 2500;
  const pool = createCellPool(cellCount, traitCount);
  const traitComputes = createTraitComputes(traitCount);
  const traitThresholds = createTraitThresholds(traitCount);

  const baselineSums = new Array(traitCount).fill(0);
  const baselineActiveCounts = new Array(traitCount).fill(0);
  const optimizedSums = new Array(traitCount).fill(0);
  const optimizedActiveCounts = new Array(traitCount).fill(0);

  const baselinePopulation = baselineAccumulateTraitAggregates(
    pool,
    traitComputes,
    traitThresholds,
    baselineSums,
    baselineActiveCounts,
  );
  const optimizedPopulation = accumulateTraitAggregates(
    pool,
    traitComputes,
    traitThresholds,
    optimizedSums,
    optimizedActiveCounts,
  );

  assert.is(optimizedPopulation, baselinePopulation);
  assert.equal(optimizedSums, baselineSums);
  assert.equal(optimizedActiveCounts, baselineActiveCounts);
});

test("accumulateTraitAggregates tolerates empty and invalid inputs", () => {
  const traitComputes = [() => 0.4, () => 0.9];
  const thresholds = [0.3, 0.5];
  const pool = [null, undefined, 42, { foo: "bar" }, { cell: null }];

  const baselineSums = new Array(2).fill(0);
  const baselineActiveCounts = new Array(2).fill(0);
  const optimizedSums = new Array(2).fill(0);
  const optimizedActiveCounts = new Array(2).fill(0);

  const baselinePopulation = baselineAccumulateTraitAggregates(
    pool,
    traitComputes,
    thresholds,
    baselineSums,
    baselineActiveCounts,
  );
  const optimizedPopulation = accumulateTraitAggregates(
    pool,
    traitComputes,
    thresholds,
    optimizedSums,
    optimizedActiveCounts,
  );

  assert.is(optimizedPopulation, baselinePopulation);
  assert.equal(optimizedSums, baselineSums);
  assert.equal(optimizedActiveCounts, baselineActiveCounts);

  const zeroPopulation = accumulateTraitAggregates(
    [],
    traitComputes,
    thresholds,
    optimizedSums,
    optimizedActiveCounts,
  );

  assert.is(zeroPopulation, 0);
});
