import { performance } from "node:perf_hooks";
import { selectTopFitnessEntries } from "../src/ui/overlays.js";

const SAMPLE_SIZE = Number.parseInt(process.env.SAMPLE_SIZE ?? "12000", 10) || 12000;
const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? "200", 10) || 200;
const TOP_PERCENT = Number.isFinite(Number(process.env.TOP_PERCENT))
  ? Number(process.env.TOP_PERCENT)
  : 0.1;

function createEntries(count) {
  const entries = new Array(Math.max(0, count));

  for (let index = 0; index < entries.length; index += 1) {
    entries[index] = {
      row: index % 200,
      col: Math.floor(index / 200),
      fitness: Math.random() * 250,
    };
  }

  return entries;
}

function baselineSelection(entries, keepCount) {
  const sortedEntries = [...entries].sort((a, b) => {
    const fitnessA = Number.isFinite(a?.fitness) ? a.fitness : -Infinity;
    const fitnessB = Number.isFinite(b?.fitness) ? b.fitness : -Infinity;

    if (fitnessA === fitnessB) return 0;

    return fitnessA > fitnessB ? -1 : 1;
  });

  return sortedEntries.slice(0, keepCount);
}

function measure(name, fn, entries, keepCount, iterations) {
  global.gc?.();

  const startHeap = process.memoryUsage().heapUsed;
  let peakHeap = startHeap;
  const start = performance.now();
  let lastResult = null;

  for (let index = 0; index < iterations; index += 1) {
    lastResult = fn(entries, keepCount);

    const currentHeap = process.memoryUsage().heapUsed;

    if (currentHeap > peakHeap) {
      peakHeap = currentHeap;
    }
  }

  global.gc?.();

  const endHeap = process.memoryUsage().heapUsed;
  const elapsed = performance.now() - start;

  return {
    name,
    peakIncreaseMiB: ((peakHeap - startHeap) / (1024 * 1024)).toFixed(2),
    retainedMiB: ((endHeap - startHeap) / (1024 * 1024)).toFixed(2),
    elapsedMs: elapsed.toFixed(2),
    sampleSize: lastResult?.length ?? 0,
  };
}

function main() {
  const entries = createEntries(SAMPLE_SIZE);
  const keepCount = Math.max(1, Math.floor(entries.length * TOP_PERCENT));

  const baseline = measure(
    "baseline-sort",
    (list, limit) => baselineSelection(list, limit),
    entries,
    keepCount,
    ITERATIONS,
  );
  const optimized = measure(
    "buffer-selection",
    (list, limit) => selectTopFitnessEntries(list, limit),
    entries,
    keepCount,
    ITERATIONS,
  );

  const results = {
    baseline,
    optimized,
    config: { SAMPLE_SIZE, ITERATIONS, TOP_PERCENT },
  };

  console.log(JSON.stringify(results, null, 2));
}

main();
