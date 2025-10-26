import { performance } from "node:perf_hooks";
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

function measure(fn, iterations, pool, computes, thresholds, traitCount) {
  const sums = new Array(traitCount).fill(0);
  const activeCounts = new Array(traitCount).fill(0);
  let population = 0;

  const start = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    sums.fill(0);
    activeCounts.fill(0);
    population += fn(pool, computes, thresholds, sums, activeCounts);
  }

  const duration = performance.now() - start;

  return { duration, population, sums, activeCounts };
}

function formatDuration(ms) {
  return `${ms.toFixed(2)}ms`;
}

function main() {
  const traitCount = 16;
  const cellCount = 6000;
  const iterations = 40;
  const pool = createCellPool(cellCount, traitCount);
  const traitComputes = createTraitComputes(traitCount);
  const traitThresholds = createTraitThresholds(traitCount);

  const baseline = measure(
    baselineAccumulateTraitAggregates,
    iterations,
    pool,
    traitComputes,
    traitThresholds,
    traitCount,
  );
  const optimized = measure(
    accumulateTraitAggregates,
    iterations,
    pool,
    traitComputes,
    traitThresholds,
    traitCount,
  );

  if (baseline.population !== optimized.population) {
    throw new Error("Population mismatch between baseline and optimized runs");
  }

  const improvement = baseline.duration - optimized.duration;
  const percent = baseline.duration > 0 ? (improvement / baseline.duration) * 100 : 0;

  console.log("Trait aggregate benchmark (higher is slower)");
  console.log(`Iterations: ${iterations}`);
  console.log(`Cells per iteration: ${cellCount}`);
  console.log(`Traits per cell: ${traitCount}`);
  console.log("---");
  console.log(`Baseline duration:   ${formatDuration(baseline.duration)}`);
  console.log(`Optimized duration:  ${formatDuration(optimized.duration)}`);
  console.log(
    `Improvement:        ${formatDuration(improvement)} (${percent.toFixed(1)}%)`,
  );
}

main();
