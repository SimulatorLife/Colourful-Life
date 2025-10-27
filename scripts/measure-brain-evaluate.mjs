#!/usr/bin/env node
import Brain from "../src/brain.js";

const ITERATIONS = Number.parseInt(process.argv[2] ?? "200000", 10);
const SAMPLE_INTERVAL = Number.parseInt(process.argv[3] ?? "1000", 10);

function run(iterations, sampleInterval) {
  const brain = new Brain({ genes: [] });
  const stats = {
    before: 0,
    after: 0,
    peak: 0,
  };

  if (typeof global.gc === "function") {
    global.gc();
  }

  const start = process.memoryUsage().heapUsed;

  stats.before = start;
  let peak = start;

  for (let i = 0; i < iterations; i += 1) {
    brain.evaluateGroup("movement", {
      energy: (i % 100) / 100,
      ageFraction: (i % 60) / 60,
      opportunitySignal: ((i * 7) % 100) / 100,
    });

    if (sampleInterval > 0 && i % sampleInterval === 0) {
      const current = process.memoryUsage().heapUsed;

      if (current > peak) {
        peak = current;
      }
    }
  }

  const end = process.memoryUsage().heapUsed;

  stats.after = end;
  stats.peak = peak;

  return stats;
}

const { before, after, peak } = run(ITERATIONS, SAMPLE_INTERVAL);

const formatBytes = (value) => `${Math.round((value / 1024 / 1024) * 100) / 100} MiB`;

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      sampleInterval: SAMPLE_INTERVAL,
      heapBefore: formatBytes(before),
      heapAfter: formatBytes(after),
      peakDelta: formatBytes(peak - before),
    },
    null,
    2,
  ),
);
