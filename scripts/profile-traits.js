import Stats from "../src/stats.js";

function createMockCell(index) {
  const base = index % 5;

  return {
    dna: {
      reproductionProb: () => 0.3 + ((base * 0.1) % 0.5),
      fightCost: () => 0.2 + (index % 3) * 0.05,
      combatPower: () => 1 + (index % 4) * 0.1,
    },
    interactionGenes: {
      cooperate: (index % 3) / 2,
      fight: ((index + 1) % 3) / 2,
      avoid: ((index + 2) % 3) / 2,
    },
    age: index % 200,
    energy: 50 + (index % 50),
  };
}

function buildPopulation(size) {
  const population = new Array(size);

  for (let i = 0; i < size; i++) {
    population[i] = { cell: createMockCell(i) };
  }

  return population;
}

function runTrial(size, iterations = 5) {
  const population = buildPopulation(size);
  const snapshot = {
    population: population.length,
    entries: [],
    populationCells: population,
    totalEnergy: population.length * 75,
    totalAge: population.length * 40,
  };

  // Warm up once to avoid one-time initialization noise.
  const warmupStats = new Stats();

  warmupStats.updateFromSnapshot(snapshot);

  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    const stats = new Stats();

    stats.births = 2;
    stats.deaths = 1;
    stats.updateFromSnapshot(snapshot);
  }

  const end = performance.now();

  return (end - start) / iterations;
}

const sizes = [100, 1000, 5000, 10000];

for (const size of sizes) {
  const avgMs = runTrial(size, 10);

  console.log(`${size} cells -> ${avgMs.toFixed(3)} ms/update`);
}
