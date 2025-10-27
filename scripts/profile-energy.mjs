import { performance as nodePerformance } from "node:perf_hooks";

const [{ createRNG }, { default: DNA }, { default: SimulationEngine }] =
  await Promise.all([
    import("../src/utils/math.js"),
    import("../src/genome.js"),
    import("../src/simulationEngine.js"),
  ]);

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

const envFloat = (
  key,
  fallback,
  { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {},
) => {
  const value = RUNTIME_ENV?.[key];

  if (value == null) return fallback;

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min || parsed > max) return fallback;

  return parsed;
};

const configuration = {
  rows: envNumber("PERF_ROWS", 60),
  cols: envNumber("PERF_COLS", 60),
  warmup: envNumber("PERF_WARMUP", 20, { min: 0 }),
  iterations: envNumber("PERF_ITERATIONS", 200),
  cellSize: envNumber("PERF_CELL_SIZE", 5),
  seed: envNumber("PERF_SEED", 1337, { min: 0 }),
  includeSimulation: envNumber("PERF_INCLUDE_SIM", 0, { min: 0 }) > 0,
  simulation: {
    rows: envNumber("PERF_SIM_ROWS", envNumber("PERF_ROWS", 60)),
    cols: envNumber("PERF_SIM_COLS", envNumber("PERF_COLS", 60)),
    warmup: envNumber("PERF_SIM_WARMUP", 15, { min: 0 }),
    iterations: envNumber("PERF_SIM_ITERATIONS", 60, { min: 1 }),
    updatesPerSecond: envNumber("PERF_SIM_UPS", 60, { min: 1 }),
    cellSize: envNumber("PERF_SIM_CELL_SIZE", envNumber("PERF_CELL_SIZE", 5), {
      min: 1,
    }),
    seedDensity: envFloat("PERF_SIM_DENSITY", 0.65, { min: 0.05, max: 0.98 }),
    seed: envNumber("PERF_SIM_SEED", 424242, { min: 0 }),
  },
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

const createCanvasStub = (width, height) => {
  const state = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
  };

  const context = {
    canvas: { width, height },
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(value) {
      state.fillStyle = value;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(value) {
      state.strokeStyle = value;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(value) {
      state.lineWidth = Number.isFinite(value) ? value : state.lineWidth;
    },
  };

  return {
    width,
    height,
    getContext(type) {
      if (type !== "2d") return null;

      return context;
    },
  };
};

const deriveSeed = (seed, offset) => ((seed >>> 0) + (offset >>> 0)) >>> 0;

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

const originalConsoleWarn =
  typeof console?.warn === "function" ? console.warn.bind(console) : null;
const suppressedWarnings = new Set([
  "GridManager detected inconsistent cell coordinates; resynchronizing tracked positions.",
]);

if (originalConsoleWarn) {
  console.warn = (...args) => {
    if (args.length > 0 && suppressedWarnings.has(String(args[0]))) {
      return;
    }

    originalConsoleWarn(...args);
  };
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

const energyEventRng = createRNG(configuration.seed);
const energyGridRng = createRNG(deriveSeed(configuration.seed, 1));

const populateHighDensityGrid = (engine, { density, rng }) => {
  const grid = engine.grid;
  const rows = grid.rows;
  const cols = grid.cols;
  const targetPopulation = Math.min(
    rows * cols,
    Math.max(1, Math.round(rows * cols * density)),
  );

  const coordinates = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid.isObstacle?.(row, col)) continue;

      coordinates.push([row, col]);
    }
  }

  for (let i = coordinates.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(rng() * (i + 1));
    const temp = coordinates[i];

    coordinates[i] = coordinates[swapIndex];
    coordinates[swapIndex] = temp;
  }

  let seeded = 0;
  const maxEnergy = Number.isFinite(grid.maxTileEnergy)
    ? grid.maxTileEnergy
    : GridManager.maxTileEnergy;
  const spawnEnergy = maxEnergy * 0.6;

  for (let i = 0; i < coordinates.length && seeded < targetPopulation; i++) {
    const [row, col] = coordinates[i];

    if (!grid.energyGrid?.[row]) continue;

    grid.energyGrid[row][col] = maxEnergy;

    const dna = DNA.random(rng);
    const spawned = grid.spawnCell(row, col, {
      dna,
      spawnEnergy,
      recordBirth: true,
    });

    if (spawned) seeded += 1;
  }

  grid.rebuildActiveCells?.();

  return { targetPopulation, seededPopulation: seeded };
};

const eventManager = new EventManager(
  configuration.rows,
  configuration.cols,
  energyEventRng,
  {
    startWithEvent: true,
  },
);

const grid = new GridManager(configuration.rows, configuration.cols, {
  eventManager,
  ctx: ctxStub,
  stats: statsStub,
  rng: energyGridRng,
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

const energyBenchmarkEnd = performanceApi.now();
const energyDurationMs = energyBenchmarkEnd - start;

let simulationSummary = null;

if (configuration.includeSimulation) {
  const simulationConfig = configuration.simulation;
  const simulationCanvas = createCanvasStub(
    simulationConfig.cols * simulationConfig.cellSize,
    simulationConfig.rows * simulationConfig.cellSize,
  );
  const simulationRng = createRNG(simulationConfig.seed);
  const simulationEngine = new SimulationEngine({
    canvas: simulationCanvas,
    autoStart: false,
    config: {
      rows: simulationConfig.rows,
      cols: simulationConfig.cols,
      cellSize: simulationConfig.cellSize,
      updatesPerSecond: simulationConfig.updatesPerSecond,
      initialObstaclePreset: "none",
      randomizeInitialObstacles: false,
      showObstacles: false,
      showDensity: false,
      showEnergy: false,
      showFitness: false,
    },
    rng: simulationRng,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performanceNow: () => performanceApi.now(),
  });

  const seedingRng = createRNG(deriveSeed(simulationConfig.seed, 1));
  const seedingSummary = populateHighDensityGrid(simulationEngine, {
    density: simulationConfig.seedDensity,
    rng: seedingRng,
  });

  const updatesPerSecond = Math.max(1, simulationEngine.state?.updatesPerSecond ?? 60);
  const intervalMs = 1000 / updatesPerSecond;
  const tickStep = intervalMs + 0.01;
  let tickTimestamp = 0;

  const tickDurations = [];

  const stepEngine = (count, tracker, collectDurations = false) => {
    for (let i = 0; i < count; i++) {
      tickTimestamp += tickStep;
      const tickStart = collectDurations ? performanceApi.now() : 0;
      const advanced = simulationEngine.tick(tickTimestamp);

      if (tracker && advanced) {
        tracker.executed += 1;
      }

      if (collectDurations && advanced) {
        tickDurations.push(performanceApi.now() - tickStart);
      }
    }
  };

  if (simulationConfig.warmup > 0) {
    stepEngine(simulationConfig.warmup);
  }

  const executionTracker = { executed: 0 };
  const simulationBenchmarkStart = performanceApi.now();

  stepEngine(simulationConfig.iterations, executionTracker, true);
  const simulationBenchmarkEnd = performanceApi.now();

  const executedTicks = executionTracker.executed;
  const simulationDurationMs = simulationBenchmarkEnd - simulationBenchmarkStart;
  const finalPopulation = simulationEngine.grid?.activeCells?.size ?? 0;

  let rawMsPerTick = simulationDurationMs / Math.max(1, executedTicks);
  let msPerTick = rawMsPerTick;

  if (tickDurations.length > 0) {
    let totalDuration = 0;

    for (let i = 0; i < tickDurations.length; i++) {
      totalDuration += tickDurations[i];
    }

    rawMsPerTick = totalDuration / tickDurations.length;

    const sortedDurations = tickDurations.slice().sort((a, b) => a - b);
    const trimCount = Math.min(
      Math.ceil(sortedDurations.length * 0.1),
      sortedDurations.length > 1 ? sortedDurations.length - 1 : 0,
    );
    const usableCount = sortedDurations.length - trimCount;

    if (usableCount > 0) {
      let trimmedTotal = 0;

      for (let i = 0; i < usableCount; i++) {
        trimmedTotal += sortedDurations[i];
      }

      msPerTick = trimmedTotal / usableCount;
    }
  }

  simulationSummary = {
    ...simulationConfig,
    durationMs: simulationDurationMs,
    executedTicks,
    msPerTick,
    rawMsPerTick,
    finalPopulation,
    seedingSummary,
  };
}

const scriptEnd = performanceApi.now();

const output = {
  ...configuration,
  durationMs: energyDurationMs,
  msPerTick: energyDurationMs / Math.max(1, configuration.iterations),
  totalRuntimeMs: scriptEnd - startGlobal,
};

if (simulationSummary) {
  output.simulationBenchmark = simulationSummary;
}

console.log(JSON.stringify(output, null, 2));
