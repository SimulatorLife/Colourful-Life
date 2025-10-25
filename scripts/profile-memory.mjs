import { createSimulation } from "../src/main.js";

function mulberry32(seed) {
  let a = seed >>> 0;

  return () => {
    a += 0x6d2b79f5;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rows = Number.parseInt(process.env.MEM_ROWS ?? "64", 10);
const cols = Number.parseInt(process.env.MEM_COLS ?? `${rows}`, 10);
const ticks = Number.parseInt(process.env.MEM_TICKS ?? "180", 10);
const warmup = Number.parseInt(process.env.MEM_WARMUP ?? "30", 10);
const sampleEvery = Math.max(
  1,
  Number.parseInt(process.env.MEM_SAMPLE_EVERY ?? "10", 10),
);
const seed = Number.parseInt(process.env.MEM_SEED ?? "1337", 10) >>> 0;

const rng = mulberry32(seed);
const nowProvider = (() => {
  let value = 0;

  return () => {
    value += 16;

    return value;
  };
})();

const simulation = createSimulation({
  headless: true,
  autoStart: false,
  rng,
  performanceNow: nowProvider,
  config: {
    rows,
    cols,
    paused: false,
  },
});

simulation.engine.resetWorld({ reseed: true });
simulation.engine.setPaused(false);

for (let i = 0; i < warmup; i += 1) {
  simulation.engine.tick();
}

let peak = 0;
const samples = [];

for (let i = 0; i < ticks; i += 1) {
  simulation.engine.tick();
  const usage = process.memoryUsage();
  const heapUsed = usage.heapUsed;

  if (heapUsed > peak) {
    peak = heapUsed;
  }

  if ((i + 1) % sampleEvery === 0 || i === ticks - 1) {
    samples.push({
      tick: i + 1,
      heapUsedBytes: heapUsed,
      heapUsedMB: Number((heapUsed / 1024 / 1024).toFixed(3)),
    });
  }
}

const finalUsage = process.memoryUsage();

simulation.destroy();

const summary = {
  rows,
  cols,
  ticks,
  warmup,
  seed,
  peakHeapUsedBytes: peak,
  peakHeapUsedMB: Number((peak / 1024 / 1024).toFixed(3)),
  finalHeapUsedBytes: finalUsage.heapUsed,
  finalHeapUsedMB: Number((finalUsage.heapUsed / 1024 / 1024).toFixed(3)),
  samples,
};

console.log(JSON.stringify(summary, null, 2));
