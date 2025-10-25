import EventManager from "../src/events/eventManager.js";

function runBenchmark({
  iterations = 20000,
  frequencyMultiplier = 1.5,
  maxConcurrent = 3,
} = {}) {
  const rng = (() => {
    let seed = 42;

    return () => {
      // Linear congruential generator for deterministic output
      seed = (seed * 1664525 + 1013904223) % 4294967296;

      return seed / 4294967296;
    };
  })();

  const manager = new EventManager(64, 64, rng, { startWithEvent: true });

  if (typeof global.gc === "function") {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;
  let peak = before;

  for (let i = 0; i < iterations; i += 1) {
    manager.updateEvent(frequencyMultiplier, maxConcurrent);

    if (i % 500 === 0) {
      const heap = process.memoryUsage().heapUsed;

      if (heap > peak) {
        peak = heap;
      }
    }
  }

  if (typeof global.gc === "function") {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return {
    iterations,
    frequencyMultiplier,
    maxConcurrent,
    before,
    after,
    peak,
    peakDelta: peak - before,
    retainedDelta: after - before,
  };
}

const result = runBenchmark({
  iterations: Number.parseInt(process.env.EVENT_BENCH_ITERATIONS ?? "20000", 10),
  frequencyMultiplier: Number.parseFloat(process.env.EVENT_BENCH_FREQ ?? "1.5"),
  maxConcurrent: Number.parseInt(process.env.EVENT_BENCH_MAX ?? "3", 10),
});

console.log(JSON.stringify(result, null, 2));
