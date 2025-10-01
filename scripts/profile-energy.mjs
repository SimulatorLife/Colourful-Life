import { performance } from "node:perf_hooks";

const startGlobal = performance.now();
// Delay dynamic imports until after headless globals configured

// minimal canvas context stub
const ctxStub = {
  clearRect() {},
  fillRect() {},
  strokeRect() {},
};

const statsStub = {
  onBirth() {},
  onDeath() {},
};

globalThis.window = {
  eventManager: null,
  ctx: ctxStub,
  cellSize: 5,
  stats: statsStub,
};

globalThis.document = {};

globalThis.performance = globalThis.performance ?? {
  now: () => Date.now(),
};

const [{ default: GridManager }, { default: EventManager }] = await Promise.all([
  import("../src/grid/gridManager.js"),
  import("../src/events/eventManager.js"),
]);

const rows = 60;
const cols = 60;
const eventManager = new EventManager(rows, cols, Math.random, {
  startWithEvent: true,
});

const grid = new GridManager(rows, cols, {
  eventManager,
  ctx: ctxStub,
  stats: statsStub,
  rng: Math.random,
});

const warmup = 20;
const iterations = 200;

for (let i = 0; i < warmup; i++) {
  grid.prepareTick({
    eventManager,
    eventStrengthMultiplier: 1,
    energyRegenRate: grid.constructor.energyRegenRate,
    energyDiffusionRate: grid.constructor.energyDiffusionRate,
    densityEffectMultiplier: 1,
  });
}

const start = performance.now();

for (let i = 0; i < iterations; i++) {
  grid.prepareTick({
    eventManager,
    eventStrengthMultiplier: 1,
    energyRegenRate: grid.constructor.energyRegenRate,
    energyDiffusionRate: grid.constructor.energyDiffusionRate,
    densityEffectMultiplier: 1,
  });
}
const end = performance.now();

const durationMs = end - start;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      iterations,
      durationMs,
      msPerTick: durationMs / iterations,
      totalRuntimeMs: end - startGlobal,
    },
    null,
    2,
  ),
);
