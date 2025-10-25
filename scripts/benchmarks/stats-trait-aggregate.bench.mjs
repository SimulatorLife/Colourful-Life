import { performance } from "node:perf_hooks";
import Stats from "../../src/stats.js";
import { clamp01 } from "../../src/utils.js";

const TRAIT_COUNT = 4;
const POPULATION = 6000;
const ITERATIONS = 120;

const stats = new Stats();
const traitDefinitions = stats.traitDefinitions;
const computes = traitDefinitions.map(({ compute }) => compute);
const thresholds = Float64Array.from(
  traitDefinitions,
  ({ threshold }) => threshold ?? 0.5,
);

const hasOwn = Object.prototype.hasOwnProperty;

const createCell = (seed) => {
  const random = Math.sin(seed) * 10000;
  const normalized = random - Math.floor(random);

  return {
    sight: 1 + ((seed * 17) % 5),
    interactionGenes: {
      cooperate: clamp01((normalized + 0.1 * (seed % 3)) % 1),
      fight: clamp01((normalized + 0.2 * ((seed >> 1) % 5)) % 1),
      avoid: clamp01((normalized + 0.3 * ((seed >> 2) % 7)) % 1),
    },
    dna: {
      reproductionProb() {
        return clamp01((normalized + seed * 0.0003) % 1);
      },
    },
  };
};

const createPool = (population) => {
  const pool = new Array(population);

  for (let i = 0; i < population; i += 1) {
    pool[i] = { cell: createCell(i + 1) };
  }

  return pool;
};

const pool = createPool(POPULATION);

const legacySums = new Float64Array(TRAIT_COUNT);
const legacyCounts = new Float64Array(TRAIT_COUNT);
const optimizedSums = new Float64Array(TRAIT_COUNT);
const optimizedCounts = new Float64Array(TRAIT_COUNT);

const resolveTraitValue = (compute, cell) => {
  const rawValue = typeof compute === "function" ? compute(cell) : 0;

  return Number.isFinite(rawValue) ? clamp01(rawValue) : 0;
};

function legacyAggregate(poolEntries) {
  legacySums.fill(0);
  legacyCounts.fill(0);

  let population = 0;

  for (const source of poolEntries) {
    const cell =
      source && typeof source === "object" && hasOwn.call(source, "cell")
        ? source.cell
        : source;

    if (!cell || typeof cell !== "object") continue;

    population += 1;

    computes.forEach((compute, index) => {
      const threshold = thresholds[index];
      const value = resolveTraitValue(compute, cell);

      legacySums[index] += value;

      if (value >= threshold) {
        legacyCounts[index] += 1;
      }
    });
  }

  return population;
}

function optimizedAggregate(poolEntries) {
  optimizedSums.fill(0);
  optimizedCounts.fill(0);

  if (poolEntries.length === 0) {
    return 0;
  }

  const computeCount = computes.length;
  const poolLength = poolEntries.length;

  let population = 0;

  for (let i = 0; i < poolLength; i += 1) {
    const source = poolEntries[i];
    const cell =
      source && typeof source === "object" && hasOwn.call(source, "cell")
        ? source.cell
        : source;

    if (!cell || typeof cell !== "object") {
      continue;
    }

    population += 1;

    for (let traitIndex = 0; traitIndex < computeCount; traitIndex += 1) {
      const compute = computes[traitIndex];
      const threshold = thresholds[traitIndex];
      const value = compute(cell) || 0;

      optimizedSums[traitIndex] += value;
      optimizedCounts[traitIndex] += value >= threshold ? 1 : 0;
    }
  }

  return population;
}

function measure(label, fn) {
  const start = performance.now();

  for (let i = 0; i < ITERATIONS; i += 1) {
    fn(pool);
  }

  const duration = performance.now() - start;

  return { label, duration };
}

measure("legacy warmup", legacyAggregate);
measure("optimized warmup", optimizedAggregate);

const legacyResult = measure("legacy", legacyAggregate);
const optimizedResult = measure("optimized", optimizedAggregate);

const improvement = legacyResult.duration / optimizedResult.duration;

console.table([
  { label: legacyResult.label, durationMs: legacyResult.duration.toFixed(2) },
  { label: optimizedResult.label, durationMs: optimizedResult.duration.toFixed(2) },
  { label: "speedup", durationMs: improvement.toFixed(2) },
]);
