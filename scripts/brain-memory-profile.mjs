import Brain, { OUTPUT_GROUPS, SENSOR_KEYS } from "../src/brain.js";

const ITERATIONS = 20000;
const HIDDEN_COUNT = 48;
const CONNECTIONS_PER_HIDDEN = 6;

function assertGc() {
  if (typeof global.gc !== "function") {
    throw new Error("Run with --expose-gc to enable garbage collection control.");
  }
}

function randomWeight(seed) {
  const x = Math.sin(seed) * 10000;

  return x - Math.floor(x);
}

function buildBrain() {
  const genes = [];
  const sensorCount = SENSOR_KEYS.length;
  const outputs = OUTPUT_GROUPS.movement;
  const hiddenOffset = 400;
  let seed = 1;

  for (let i = 0; i < HIDDEN_COUNT; i += 1) {
    const hiddenId = hiddenOffset + i;

    for (let c = 0; c < CONNECTIONS_PER_HIDDEN; c += 1) {
      const sourceIndex = (seed + c + i * 3) % sensorCount;
      const weight = randomWeight(seed + i * 17 + c * 29) * 2 - 1;

      genes.push({
        sourceId: sourceIndex,
        targetId: hiddenId,
        weight,
        activationType: 2,
        enabled: true,
      });
    }

    const targetOutput = outputs[i % outputs.length];
    const weight = randomWeight(seed + i * 13.37) * 2 - 1;

    genes.push({
      sourceId: hiddenId,
      targetId: targetOutput.id,
      weight,
      activationType: targetOutput.activationType ?? 2,
      enabled: true,
    });

    seed += 1;
  }

  return new Brain({ genes });
}

function buildSensorPayload() {
  const payload = {};

  for (let i = 0; i < SENSOR_KEYS.length; i += 1) {
    const key = SENSOR_KEYS[i];

    payload[key] = (Math.sin(i * 0.37) * 0.5 + 0.5) * (i % 2 === 0 ? 1 : -1);
  }

  return payload;
}

function sampleMemory() {
  return process.memoryUsage().heapUsed;
}

async function main() {
  assertGc();

  const brain = buildBrain();
  const sensors = buildSensorPayload();

  global.gc();
  const before = sampleMemory();

  for (let i = 0; i < ITERATIONS; i += 1) {
    sensors.energy = Math.sin(i * 0.01);
    sensors.allySimilarity = Math.cos(i * 0.005);
    sensors.enemySimilarity = Math.cos(i * 0.0075);

    brain.evaluateGroup("movement", sensors);
  }

  global.gc();
  const after = sampleMemory();

  const delta = after - before;

  console.log(
    JSON.stringify(
      {
        iterations: ITERATIONS,
        before,
        after,
        delta,
        perIterationBytes: delta / ITERATIONS,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
