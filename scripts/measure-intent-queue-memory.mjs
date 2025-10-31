const ITERATIONS = Number.parseInt(process.env.MEASURE_ITERATIONS ?? "200", 10);
const QUEUE_SIZE = Number.parseInt(process.env.MEASURE_QUEUE_SIZE ?? "5000", 10);

function bytesToMiB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function runLegacySimulation(iterations, queueSize) {
  const pending = [];
  let peak = 0;
  let cumulativeIncrease = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (typeof global.gc === "function") {
      global.gc();
    }

    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < queueSize; i += 1) {
      pending.push({ type: "noop", id: iteration * queueSize + i });
    }

    const intents = pending.splice(0);

    for (let i = 0; i < intents.length; i += 1) {
      const intent = intents[i];

      if (intent && intent.type === "noop") {
        // no-op; mirrors InteractionSystem resolving an unknown intent
      }
    }

    const usage = process.memoryUsage().heapUsed;

    if (usage > peak) {
      peak = usage;
    }

    if (usage > before) {
      cumulativeIncrease += usage - before;
    }
  }

  return { peak, cumulativeIncrease };
}

function runPooledSimulation(iterations, queueSize) {
  const pending = [];
  let peak = 0;
  let cumulativeIncrease = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (typeof global.gc === "function") {
      global.gc();
    }

    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < queueSize; i += 1) {
      pending.push({ type: "noop", id: iteration * queueSize + i });
    }

    const originalLength = pending.length;

    if (originalLength === 0) {
      continue;
    }

    for (let i = 0; i < originalLength; i += 1) {
      const intent = pending[i];

      if (intent && intent.type === "noop") {
        // no-op; mirrors InteractionSystem resolving an unknown intent
      }

      pending[i] = null;
    }

    if (pending.length > originalLength) {
      pending.copyWithin(0, originalLength);
      pending.length -= originalLength;
    } else {
      pending.length = 0;
    }

    const usage = process.memoryUsage().heapUsed;

    if (usage > peak) {
      peak = usage;
    }

    if (usage > before) {
      cumulativeIncrease += usage - before;
    }
  }

  return { peak, cumulativeIncrease };
}

if (typeof global.gc === "function") {
  global.gc();
}

const legacyStats = runLegacySimulation(ITERATIONS, QUEUE_SIZE);

if (typeof global.gc === "function") {
  global.gc();
}

const pooledStats = runPooledSimulation(ITERATIONS, QUEUE_SIZE);

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      queueSize: QUEUE_SIZE,
      legacyPeakBytes: legacyStats.peak,
      legacyPeakMiB: bytesToMiB(legacyStats.peak),
      legacyCumulativeIncreaseBytes: legacyStats.cumulativeIncrease,
      legacyCumulativeIncreaseMiB: bytesToMiB(legacyStats.cumulativeIncrease),
      pooledPeakBytes: pooledStats.peak,
      pooledPeakMiB: bytesToMiB(pooledStats.peak),
      pooledCumulativeIncreaseBytes: pooledStats.cumulativeIncrease,
      pooledCumulativeIncreaseMiB: bytesToMiB(pooledStats.cumulativeIncrease),
      peakReductionBytes: legacyStats.peak - pooledStats.peak,
      peakReductionMiB: bytesToMiB(legacyStats.peak - pooledStats.peak),
      allocationReductionBytes:
        legacyStats.cumulativeIncrease - pooledStats.cumulativeIncrease,
      allocationReductionMiB: bytesToMiB(
        legacyStats.cumulativeIncrease - pooledStats.cumulativeIncrease,
      ),
    },
    null,
    2,
  ),
);
