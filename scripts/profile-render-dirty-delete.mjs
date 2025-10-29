import { performance as nodePerformance } from "node:perf_hooks";

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

const [{ default: GridManager }, { createRNG }] = await Promise.all([
  import("../src/grid/gridManager.js"),
  import("../src/utils/math.js"),
]);

const rows = 64;
const cols = 64;
const totalTiles = rows * cols;
const rng = createRNG(1337);
const grid = new GridManager(rows, cols, {
  rng,
  stats: { onBirth() {}, onDeath() {} },
  ctx: { clearRect() {}, fillRect() {}, strokeRect() {} },
});
const view = grid.renderDirtyTiles;
const indices = Array.from({ length: totalTiles }, (_, index) => index);

function refill() {
  view.clear();

  for (let i = 0; i < indices.length; i++) {
    view.add(indices[i]);
  }
}

refill();

const iterations = 200_000;
let checksum = 0;

// Warm up path to ensure caches and JITs settle.
for (let i = 0; i < iterations; i++) {
  const index = indices[i % indices.length];

  view.delete(index);
  view.add(index);
}

refill();

const start = performanceApi.now();

for (let i = 0; i < iterations; i++) {
  const index = indices[i % indices.length];

  if (view.delete(index)) {
    checksum ^= index;
  }

  view.add(index);
}

const durationMs = performanceApi.now() - start;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      iterations,
      durationMs,
      nsPerDelete: (durationMs * 1e6) / iterations,
      checksum,
    },
    null,
    2,
  ),
);
