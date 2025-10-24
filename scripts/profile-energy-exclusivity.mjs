import { performance as nodePerformance } from "node:perf_hooks";

const [{ default: GridManager }, { default: EventManager }, { default: DNA }] =
  await Promise.all([
    import("../src/grid/gridManager.js"),
    import("../src/events/eventManager.js"),
    import("../src/genome.js"),
  ]);

const performanceApi =
  typeof globalThis.performance === "object" &&
  typeof globalThis.performance?.now === "function"
    ? globalThis.performance
    : nodePerformance;

if (!globalThis.performance || typeof globalThis.performance.now !== "function") {
  globalThis.performance = performanceApi;
}

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const configuration = {
  rows: toInt(process.env.PERF_ROWS, 200) || 200,
  cols: toInt(process.env.PERF_COLS, 200) || 200,
  warmup: Math.max(0, toInt(process.env.PERF_WARMUP, 10) || 0),
  iterations: Math.max(1, toInt(process.env.PERF_ITERATIONS, 60) || 1),
  population: Math.max(0, toInt(process.env.PERF_POPULATION, 0) || 0),
  disableRegen: toInt(process.env.PERF_DISABLE_REGEN, 0) > 0,
};

const ctxStub = null;
const statsStub = { onBirth() {}, onDeath() {} };
const rng = () => Math.random();

const eventManager = new EventManager(configuration.rows, configuration.cols, rng, {
  startWithEvent: false,
});

const grid = new GridManager(configuration.rows, configuration.cols, {
  eventManager,
  ctx: ctxStub,
  stats: statsStub,
  rng,
});

if (configuration.disableRegen) {
  grid.regenerateEnergyGrid = () => {};
}

if (configuration.population > 0) {
  let seeded = 0;
  const maxEnergy = Number.isFinite(grid.maxTileEnergy)
    ? grid.maxTileEnergy
    : GridManager.maxTileEnergy;

  for (
    let row = 0;
    row < configuration.rows && seeded < configuration.population;
    row++
  ) {
    for (
      let col = 0;
      col < configuration.cols && seeded < configuration.population;
      col++
    ) {
      if (grid.isObstacle?.(row, col)) continue;

      const dna = DNA.random(rng);
      const cell = grid.spawnCell(row, col, {
        dna,
        spawnEnergy: maxEnergy * 0.5,
      });

      if (cell) {
        seeded += 1;
      }
    }
  }
}

for (let i = 0; i < configuration.warmup; i++) {
  grid.update({
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    eventStrengthMultiplier: 0,
    densityEffectMultiplier: 0,
    mutationMultiplier: 0,
  });
}

const start = performanceApi.now();

for (let i = 0; i < configuration.iterations; i++) {
  grid.update({
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    eventStrengthMultiplier: 0,
    densityEffectMultiplier: 0,
    mutationMultiplier: 0,
  });
}

const end = performanceApi.now();
const durationMs = end - start;
const msPerUpdate = durationMs / Math.max(1, configuration.iterations);

const result = {
  scenario: "empty-grid-energy-exclusivity",
  ...configuration,
  durationMs,
  msPerUpdate,
};

console.log(JSON.stringify(result, null, 2));
