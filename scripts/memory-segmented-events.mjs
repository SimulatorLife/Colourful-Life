import GridManager from "../src/grid/gridManager.js";
import { defaultEventContext } from "../src/events/eventContext.js";

const rows = Number.parseInt(process.argv[2] ?? "40", 10);
const cols = Number.parseInt(process.argv[3] ?? "40", 10);
const iterations = Number.parseInt(process.argv[4] ?? "2000", 10);
const eventCount = Number.parseInt(process.argv[5] ?? "48", 10);

function createEvent(index) {
  const span = Math.max(4, Math.floor(Math.min(rows, cols) / 2));
  const x = (index * 7) % Math.max(1, cols - span);
  const y = (index * 11) % Math.max(1, rows - span);

  return {
    eventType: index % 2 === 0 ? "flood" : "heatwave",
    strength: 0.75 + (index % 3) * 0.05,
    affectedArea: { x, y, width: span, height: span },
  };
}

function buildEvents(count) {
  const events = [];

  for (let i = 0; i < count; i += 1) {
    events.push(createEvent(i));
  }

  return events;
}

function ensureGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function measure() {
  const grid = new GridManager(rows, cols, {
    eventManager: { activeEvents: [] },
    eventContext: defaultEventContext,
    stats: null,
  });

  const events = buildEvents(eventCount);
  const densityGrid = Array.from({ length: rows }, () => new Float32Array(cols));

  ensureGc();
  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i += 1) {
    grid.regenerateEnergyGrid(
      events,
      1,
      GridManager.energyRegenRate,
      GridManager.energyDiffusionRate,
      densityGrid,
      1,
    );
  }

  ensureGc();
  const after = process.memoryUsage().heapUsed;

  return {
    before,
    after,
    delta: after - before,
  };
}

const { before, after, delta } = measure();

const format = (bytes) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      iterations,
      events: eventCount,
      heapBefore: format(before),
      heapAfter: format(after),
      heapDelta: format(delta),
    },
    null,
    2,
  ),
);
