import { performance as nodePerformance } from "node:perf_hooks";

const [{ createRNG }, { default: Brain }] = await Promise.all([
  import("../src/utils/math.js"),
  import("../src/brain.js"),
]);

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

const SENSOR_FEEDBACK_ENV =
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

const toNumberInRange = (value, fallback, { min = -Infinity, max = Infinity } = {}) => {
  if (value == null) return fallback;

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed < min || parsed > max) {
    return fallback;
  }

  return parsed;
};

const configuration = {
  warmup: toPositiveInteger(SENSOR_FEEDBACK_ENV?.SENSOR_FEEDBACK_WARMUP, 5000, {
    min: 0,
  }),
  iterations: toPositiveInteger(
    SENSOR_FEEDBACK_ENV?.SENSOR_FEEDBACK_ITERATIONS,
    60000,
    { min: 1 },
  ),
  pool: toPositiveInteger(SENSOR_FEEDBACK_ENV?.SENSOR_FEEDBACK_POOL, 24, {
    min: 1,
  }),
  rewardSignal: toNumberInRange(SENSOR_FEEDBACK_ENV?.SENSOR_FEEDBACK_REWARD, 0.35, {
    min: -2,
    max: 2,
  }),
  penaltySignal: toNumberInRange(SENSOR_FEEDBACK_ENV?.SENSOR_FEEDBACK_PENALTY, -0.28, {
    min: -2,
    max: 2,
  }),
};

const rng = createRNG(0xfeedf00d);
const fatigueIndex = Brain.sensorIndex("neuralFatigue") ?? 0;
const energyIndex = Brain.sensorIndex("energy") ?? 1;
const biasIndex = 0;

const baseProfile = {
  learningRate: 0.24,
  rewardSensitivity: 1.1,
  punishmentSensitivity: 0.9,
  retention: 0.62,
  volatility: 0.48,
  fatigueWeight: 0.35,
  costWeight: 0.28,
};

const createSensorVectorPool = (count) => {
  const vectors = new Array(count);

  for (let i = 0; i < count; i++) {
    const vector = new Array(Brain.SENSOR_COUNT);

    for (let j = 0; j < Brain.SENSOR_COUNT; j++) {
      if (j === biasIndex) {
        vector[j] = 1;
      } else {
        const raw = rng() * 2 - 1;

        vector[j] = Math.max(-1, Math.min(1, raw));
      }
    }

    vectors[i] = vector;
  }

  return vectors;
};

const applyFeedbackIterations = (brain, vectors, iterations) => {
  const poolSize = vectors.length;

  for (let i = 0; i < iterations; i++) {
    const vector = vectors[i % poolSize];
    const fatigue = vector[fatigueIndex] ?? 0;
    const energy = vector[energyIndex] ?? 0;
    const rewardSignal =
      i & 1 ? configuration.penaltySignal : configuration.rewardSignal;

    brain.applySensorFeedback({
      sensorVector: vector,
      activationCount: 6,
      energyCost: 0.12 + energy * 0.05,
      fatigueDelta: fatigue * 0.4,
      rewardSignal,
      maxTileEnergy: 8,
    });
  }
};

const measure = () => {
  const vectors = createSensorVectorPool(configuration.pool);
  const brain = new Brain({ plasticityProfile: baseProfile });

  applyFeedbackIterations(brain, vectors, configuration.warmup);

  const start = performanceApi.now();

  applyFeedbackIterations(brain, vectors, configuration.iterations);
  const duration = performanceApi.now() - start;

  return { duration, iterations: configuration.iterations };
};

const { duration, iterations } = measure();

const avg = duration / iterations;

console.log(
  JSON.stringify(
    {
      iterations,
      durationMs: Number(duration.toFixed(3)),
      averageNsPerIteration: Number((avg * 1e6).toFixed(2)),
    },
    null,
    2,
  ),
);
