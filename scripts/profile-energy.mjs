import { performance as nodePerformance } from "node:perf_hooks";

const RUNTIME_ENV =
  typeof process !== "undefined" && typeof process.env === "object"
    ? process.env
    : undefined;

const toPositiveInteger = (value, fallback, { min = 1 } = {}) => {
  if (value == null) return fallback;

  const parsed =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.trunc(parsed);

  if (normalized < min) {
    return fallback;
  }

  return normalized;
};

const envNumber = (key, fallback, options) =>
  toPositiveInteger(RUNTIME_ENV?.[key], fallback, options);

const configuration = {
  rows: envNumber("PERF_ROWS", 60),
  cols: envNumber("PERF_COLS", 60),
  warmup: envNumber("PERF_WARMUP", 20, { min: 0 }),
  iterations: envNumber("PERF_ITERATIONS", 200),
  cellSize: envNumber("PERF_CELL_SIZE", 5),
};

const ctxStub = {
  clearRect() {},
  fillRect() {},
  strokeRect() {},
};

const statsStub = {
  onBirth() {},
  onDeath() {},
};

const performanceApi =
  typeof globalThis.performance === "object" &&
  typeof globalThis.performance?.now === "function"
    ? globalThis.performance
    : (nodePerformance ?? { now: () => Date.now() });

if (
  typeof globalThis.performance !== "object" ||
  typeof globalThis.performance.now !== "function"
) {
  globalThis.performance = performanceApi;
}

const startGlobal = performanceApi.now();

const windowTarget = globalThis.window ?? (globalThis.window = {});

windowTarget.eventManager = windowTarget.eventManager ?? null;
windowTarget.ctx = ctxStub;
windowTarget.cellSize = configuration.cellSize;
windowTarget.stats = statsStub;

globalThis.document = globalThis.document ?? {};

const [{ default: GridManager }, { default: EventManager }] = await Promise.all([
  import("../src/grid/gridManager.js"),
  import("../src/events/eventManager.js"),
]);

const eventManager = new EventManager(
  configuration.rows,
  configuration.cols,
  Math.random,
  {
    startWithEvent: true,
  },
);

const grid = new GridManager(configuration.rows, configuration.cols, {
  eventManager,
  ctx: ctxStub,
  stats: statsStub,
  rng: Math.random,
});

for (let i = 0; i < configuration.warmup; i++) {
  grid.prepareTick({
    eventManager,
    eventStrengthMultiplier: 1,
    energyRegenRate: grid.constructor.energyRegenRate,
    energyDiffusionRate: grid.constructor.energyDiffusionRate,
    densityEffectMultiplier: 1,
  });
}

const start = performanceApi.now();

for (let i = 0; i < configuration.iterations; i++) {
  grid.prepareTick({
    eventManager,
    eventStrengthMultiplier: 1,
    energyRegenRate: grid.constructor.energyRegenRate,
    energyDiffusionRate: grid.constructor.energyDiffusionRate,
    densityEffectMultiplier: 1,
  });
}
const end = performanceApi.now();

const durationMs = end - start;

console.log(
  JSON.stringify(
    {
      ...configuration,
      durationMs,
      msPerTick: durationMs / configuration.iterations,
      totalRuntimeMs: end - startGlobal,
    },
    null,
    2,
  ),
);
