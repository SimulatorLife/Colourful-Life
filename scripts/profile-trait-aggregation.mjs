import { performance } from "node:perf_hooks";

const [{ accumulateTraitAggregates }, { createRNG }] = await Promise.all([
  import("../src/stats/traitAggregation.js"),
  import("../src/utils/math.js"),
]);

const rng = createRNG(1337);
const random = () => rng();

const TRAIT_COUNT = 32;
const POOL_SIZE = 2500;
const ACTIVE_INDEX_FRACTION = 0.6;
const WARMUP = 50;
const ITERATIONS = 300;

const pool = Array.from({ length: POOL_SIZE }, (_, i) => ({
  cell: {
    id: i,
    energy: random() * 100,
    age: Math.trunc(random() * 500),
    offspring: Math.trunc(random() * 10),
    fightsWon: Math.trunc(random() * 6),
    genomeDiversity: random(),
    brainComplexity: random(),
  },
}));

const traitComputes = Array.from({ length: TRAIT_COUNT }, (_, index) => {
  switch (index % 4) {
    case 0:
      return (cell) => cell.energy;
    case 1:
      return (cell) => cell.age;
    case 2:
      return (cell) => cell.offspring + cell.fightsWon;
    default:
      return (cell) =>
        cell.genomeDiversity * 0.5 + cell.brainComplexity * 0.5 + index * 0.01;
  }
});

const traitThresholds = Float64Array.from({ length: TRAIT_COUNT }, (_, i) =>
  i % 3 === 0 ? 40 : i % 3 === 1 ? 200 : 3,
);

const sums = new Float64Array(TRAIT_COUNT);
const activeCounts = new Uint32Array(TRAIT_COUNT);

const activeTraitIndexes = Int16Array.from(
  { length: Math.trunc(TRAIT_COUNT * ACTIVE_INDEX_FRACTION) },
  (_, i) => (i % 5 === 0 ? -1 : i),
);

function runIteration() {
  sums.fill(0);
  activeCounts.fill(0);

  return accumulateTraitAggregates(
    pool,
    traitComputes,
    traitThresholds,
    sums,
    activeCounts,
    activeTraitIndexes,
  );
}

for (let i = 0; i < WARMUP; i += 1) {
  runIteration();
}

const start = performance.now();
let totalPopulation = 0;

for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
  totalPopulation += runIteration();
}
const duration = performance.now() - start;

console.log(
  JSON.stringify(
    {
      iterations: ITERATIONS,
      poolSize: POOL_SIZE,
      traitCount: TRAIT_COUNT,
      activeIndexes: activeTraitIndexes.length,
      totalPopulation,
      durationMs: Number(duration.toFixed(3)),
      avgPerIteration: Number((duration / ITERATIONS).toFixed(3)),
    },
    null,
    2,
  ),
);
