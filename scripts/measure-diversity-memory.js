import Stats from "../src/stats.js";
import DNA from "../src/genome.js";

const POPULATION_SIZE = 600;
const ITERATIONS = 4000;

function createPopulation(size) {
  const population = new Array(size);

  for (let i = 0; i < size; i += 1) {
    population[i] = { dna: DNA.random() };
  }

  return population;
}

function measure(stats, sources, iterations) {
  if (typeof global.gc === "function") {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;
  let peak = before;

  for (let i = 0; i < iterations; i += 1) {
    stats.estimateDiversity(sources, 200);

    if (i % 10 === 0) {
      const used = process.memoryUsage().heapUsed;

      if (used > peak) {
        peak = used;
      }
    }
  }

  if (typeof global.gc === "function") {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return {
    peakDeltaBytes: peak - before,
    retainedBytes: after - before,
  };
}

const stats = new Stats();
const population = createPopulation(POPULATION_SIZE);

// Warm up caches before measuring.
measure(stats, population, ITERATIONS);
const { peakDeltaBytes, retainedBytes } = measure(stats, population, ITERATIONS);

const summary = {
  populationSize: POPULATION_SIZE,
  iterations: ITERATIONS,
  peakDeltaBytes,
  peakDeltaKilobytes: Math.round((peakDeltaBytes / 1024) * 100) / 100,
  retainedBytes,
  retainedKilobytes: Math.round((retainedBytes / 1024) * 100) / 100,
};

console.log(JSON.stringify(summary));
