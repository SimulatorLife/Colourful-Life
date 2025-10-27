import { performance } from "node:perf_hooks";
import { accumulateTraitAggregates } from "../src/stats/traitAggregation.js";

function createMockCell(index, traitCount) {
  const base = Math.sin(index * 0.13) * 0.5 + 0.5;

  return {
    id: index,
    genes: Array.from({ length: traitCount }, (_, traitIndex) => {
      const noise = Math.sin((index + 1) * (traitIndex + 3) * 0.017) * 0.5 + 0.5;

      return Math.min(1, Math.max(0, base * 0.6 + noise * 0.4));
    }),
  };
}

function createTraitComputes(traitCount) {
  const fns = new Array(traitCount);

  for (let traitIndex = 0; traitIndex < traitCount; traitIndex += 1) {
    fns[traitIndex] = (cell) => cell.genes[traitIndex] ?? 0;
  }

  return fns;
}

function runBenchmark({
  populationSize = 2000,
  traitCount = 16,
  iterations = 300,
  activeTraitIndexes = null,
} = {}) {
  const cells = new Array(populationSize);

  for (let i = 0; i < populationSize; i += 1) {
    cells[i] = createMockCell(i, traitCount);
  }

  const traitComputes = createTraitComputes(traitCount);
  const traitThresholds = new Float64Array(traitCount).fill(0.55);
  const traitSums = new Float64Array(traitCount);
  const traitActiveCounts = new Uint32Array(traitCount);

  const activeIndexes = activeTraitIndexes
    ? Array.from(activeTraitIndexes)
    : Array.from({ length: traitCount }, (_, index) => index);

  // Warm up JIT so results are less noisy.
  for (let i = 0; i < 20; i += 1) {
    traitSums.fill(0);
    traitActiveCounts.fill(0);
    accumulateTraitAggregates(
      cells,
      traitComputes,
      traitThresholds,
      traitSums,
      traitActiveCounts,
      activeIndexes,
    );
  }

  const start = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    traitSums.fill(0);
    traitActiveCounts.fill(0);
    accumulateTraitAggregates(
      cells,
      traitComputes,
      traitThresholds,
      traitSums,
      traitActiveCounts,
      activeIndexes,
    );
  }

  const duration = performance.now() - start;
  const avg = duration / iterations;

  return {
    duration,
    average: avg,
    iterations,
    populationSize,
    traitCount,
  };
}

function formatResult(result) {
  return (
    `population=${result.populationSize}, traits=${result.traitCount}, iterations=${result.iterations}\n` +
    `  total=${result.duration.toFixed(2)}ms, avg=${result.average.toFixed(3)}ms`
  );
}

function main() {
  const baseline = runBenchmark();
  const focused = runBenchmark({
    traitCount: 32,
    activeTraitIndexes: Uint16Array.from([0, 3, 7, 11, 15, 23, 31]),
  });

  console.log("Trait aggregation benchmark:\n" + formatResult(baseline));
  console.log("\nSparse trait selection benchmark:\n" + formatResult(focused));
}

main();
