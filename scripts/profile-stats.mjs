import { performance } from "node:perf_hooks";
import Stats from "../src/stats.js";

const POPULATION = Number(process.env.POPULATION ?? 4000);
const ITERATIONS = Number(process.env.ITERATIONS ?? 80);
const WARMUP = Number(process.env.WARMUP ?? 10);

const createCell = (index) => ({
  id: index,
  interactionGenes: {
    cooperate: Math.sin(index * 0.17) * 0.5 + 0.5,
    fight: Math.cos(index * 0.11) * 0.5 + 0.5,
  },
  dna: {
    reproductionProb: () => 0.2 + (index % 5) * 0.05,
    similarity(other) {
      const delta = Math.abs((other?.id ?? 0) - index);

      return Math.max(0, Math.min(1, 1 - delta / POPULATION));
    },
  },
  sight: ((index * 3) % 5) + 1,
});

const buildCells = () =>
  Array.from({ length: POPULATION }, (_, index) => createCell(index));

const benchmark = (stats, snapshot, iterations) => {
  const start = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    stats.resetTick();
    stats.births = (i % 7) + 3;
    stats.deaths = (i % 5) + 2;
    stats.updateFromSnapshot(snapshot);
  }

  return performance.now() - start;
};

const main = () => {
  const stats = new Stats(128);
  const cells = buildCells();
  const snapshot = {
    population: cells.length,
    totalEnergy: cells.length * 8,
    totalAge: cells.length * 5,
    cells,
  };

  if (WARMUP > 0) {
    benchmark(stats, snapshot, WARMUP);
  }

  const durationMs = benchmark(stats, snapshot, ITERATIONS);
  const averagePerUpdate = durationMs / ITERATIONS;

  console.log(
    JSON.stringify(
      {
        population: POPULATION,
        iterations: ITERATIONS,
        durationMs: Number(durationMs.toFixed(3)),
        averageUpdateMs: Number(averagePerUpdate.toFixed(3)),
      },
      null,
      2,
    ),
  );
};

main();
