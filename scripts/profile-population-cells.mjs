import Stats from "../src/stats.js";

const ITERATIONS = Number.parseInt(process.env.ITERATIONS ?? "20", 10);
const POPULATION = Number.parseInt(process.env.POPULATION ?? "4000", 10);

const stats = new Stats(0, {
  traitDefinitions: [
    { key: "cooperation", compute: () => 0.5, threshold: 0.25 },
    { key: "fighting", compute: () => 0.1, threshold: 0.25 },
    { key: "breeding", compute: () => 0.3, threshold: 0.25 },
    { key: "sight", compute: () => 0.4, threshold: 0.25 },
  ],
  diversitySampleInterval: 1000,
  traitResampleInterval: 1000,
});

stats.estimateDiversity = () => 0.3;

const retained = [];

const formatMB = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

const measure = (label) => {
  if (typeof global.gc === "function") {
    global.gc();
  }

  const usage = process.memoryUsage();
  const heapMB = formatMB(usage.heapUsed);

  console.log(`${label}: heapUsed=${heapMB}MB`);
};

measure("baseline");

for (let i = 0; i < ITERATIONS; i += 1) {
  const populationCells = Array.from({ length: POPULATION }, (_, index) => ({
    id: index,
    interactionGenes: Object.freeze({ cooperate: 0.5, fight: 0.2, avoid: 0.3 }),
    dna: Object.freeze({
      reproductionProb: () => 0.3,
    }),
    sight: 3,
  }));

  const snapshot = {
    population: POPULATION,
    entries: [],
    totalEnergy: POPULATION * 12,
    totalAge: POPULATION * 24,
    populationCells,
  };

  stats.updateFromSnapshot(snapshot);
  retained.push(snapshot);

  if ((i + 1) % 5 === 0) {
    measure(`after ${i + 1} ticks`);
  }
}

measure("final");

if (typeof global.gc !== "function") {
  console.warn("Run with `node --expose-gc` for accurate measurements.");
}
