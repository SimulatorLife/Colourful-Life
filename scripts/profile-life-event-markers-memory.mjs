import { drawLifeEventMarkers } from "../src/ui/overlays.js";
import { clamp, clamp01 } from "../src/utils/math.js";

const LIFE_EVENT_MARKER_MAX_COUNT = 24;
const LIFE_EVENT_MARKER_FADE_TICKS = 36;
const LIFE_EVENT_MARKER_MIN_ALPHA = 0.18;
const LIFE_EVENT_MARKER_MAX_ALPHA = 0.92;
const LIFE_EVENT_MARKER_DEFAULT_COLORS = {
  birth: "#7bed9f",
  death: "#ff6b6b",
};

function createContextStub() {
  let lineWidth = 1;
  let globalAlpha = 1;

  return {
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    stroke() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    set lineWidth(value) {
      lineWidth = value;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineJoin(_) {},
    set lineCap(_) {},
    set strokeStyle(_) {},
    set fillStyle(_) {},
    set globalAlpha(value) {
      globalAlpha = value;
    },
    get globalAlpha() {
      return globalAlpha;
    },
  };
}

function computeLifeEventAlpha(
  ageTicks,
  { maxAge = LIFE_EVENT_MARKER_FADE_TICKS } = {},
) {
  if (!(maxAge > 0)) return LIFE_EVENT_MARKER_MAX_ALPHA;
  if (!Number.isFinite(ageTicks) || ageTicks <= 0) {
    return LIFE_EVENT_MARKER_MAX_ALPHA;
  }
  if (ageTicks >= maxAge) {
    return LIFE_EVENT_MARKER_MIN_ALPHA;
  }

  const normalized = clamp01(ageTicks / maxAge);
  const span = LIFE_EVENT_MARKER_MAX_ALPHA - LIFE_EVENT_MARKER_MIN_ALPHA;

  return LIFE_EVENT_MARKER_MIN_ALPHA + span * (1 - normalized * normalized);
}

function resolveLifeEventLimit(limit) {
  if (limit == null) {
    return LIFE_EVENT_MARKER_MAX_COUNT;
  }

  if (typeof limit === "string") {
    const trimmed = limit.trim();

    if (trimmed.length === 0) {
      return LIFE_EVENT_MARKER_MAX_COUNT;
    }

    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed)) {
      return LIFE_EVENT_MARKER_MAX_COUNT;
    }

    const floored = Math.floor(parsed);

    return floored <= 0 ? 0 : floored;
  }

  const numeric = Number(limit);

  if (!Number.isFinite(numeric)) {
    return LIFE_EVENT_MARKER_MAX_COUNT;
  }

  const floored = Math.floor(numeric);

  return floored <= 0 ? 0 : floored;
}

function resolveLifeEventColor(event, overrides = {}) {
  const overrideForType = overrides[event?.type];
  const fallbackOverride = overrides.default ?? overrides.fallback ?? overrides.other;

  const color = [
    event?.highlight?.color,
    event?.color,
    typeof overrideForType === "string" ? overrideForType : null,
    typeof fallbackOverride === "string" ? fallbackOverride : null,
    LIFE_EVENT_MARKER_DEFAULT_COLORS[event?.type],
    LIFE_EVENT_MARKER_DEFAULT_COLORS.birth,
  ].find((candidate) => typeof candidate === "string" && candidate.length > 0);

  return color ?? LIFE_EVENT_MARKER_DEFAULT_COLORS.birth;
}

function createLifeEventMarkerDescriptorLegacy(
  event,
  { currentTick, fadeWindow, colorOverrides },
) {
  if (!event) return null;

  const row = Number(event.row);
  const col = Number(event.col);

  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return null;
  }

  const tick = Number(event.tick);
  let alpha = LIFE_EVENT_MARKER_MAX_ALPHA;

  if (currentTick != null && Number.isFinite(tick)) {
    const age = currentTick - tick;

    if (age < 0 || age > fadeWindow) {
      return null;
    }

    alpha = clamp(computeLifeEventAlpha(age, { maxAge: fadeWindow }), 0, 1);
  }

  const color = resolveLifeEventColor(event, colorOverrides);
  const type =
    event.type === "death" ? "death" : event.type === "birth" ? "birth" : "other";

  return { row, col, color, alpha, type };
}

function drawLifeEventMarkersLegacy(ctx, cellSize, events, options = {}) {
  if (!ctx || !(cellSize > 0)) return;
  if (!Array.isArray(events) || events.length === 0) return;

  const maxCount = resolveLifeEventLimit(options.limit);

  if (maxCount === 0) return;

  const currentTick = Number.isFinite(options.currentTick) ? options.currentTick : null;
  const fadeWindow = Number.isFinite(options.fadeTicks)
    ? Math.max(1, options.fadeTicks)
    : LIFE_EVENT_MARKER_FADE_TICKS;
  const markerRadius = Math.max(cellSize * 0.42, cellSize * 0.24);
  const strokeWidth = Math.max(cellSize * 0.18, 1.25);
  const colorOverrides = options.colors;

  const prepared = events.reduce((list, event) => {
    const descriptor = createLifeEventMarkerDescriptorLegacy(event, {
      currentTick,
      fadeWindow,
      colorOverrides,
    });

    if (descriptor) {
      list.push(descriptor);
    }

    return list;
  }, []);

  if (prepared.length === 0) {
    return;
  }

  const toRender = prepared.slice(0, maxCount);

  toRender.reverse();

  if (typeof ctx.save === "function") ctx.save();

  if (ctx.lineJoin !== undefined) ctx.lineJoin = "round";
  if (ctx.lineCap !== undefined) ctx.lineCap = "round";

  const previousLineWidth = ctx.lineWidth;

  if (ctx.lineWidth !== undefined) ctx.lineWidth = strokeWidth;

  for (const entry of toRender) {
    const { row, col, color, alpha, type } = entry;

    if (ctx.globalAlpha !== undefined) {
      ctx.globalAlpha = Number.isFinite(alpha) ? alpha : LIFE_EVENT_MARKER_MAX_ALPHA;
    }

    const centerX = (col + 0.5) * cellSize;
    const centerY = (row + 0.5) * cellSize;

    void centerX;
    void centerY;
    void color;
    void type;
    void markerRadius;
  }

  if (ctx.globalAlpha !== undefined) {
    ctx.globalAlpha = 1;
  }
  if (ctx.lineWidth !== undefined && Number.isFinite(previousLineWidth)) {
    ctx.lineWidth = previousLineWidth;
  }
  if (typeof ctx.restore === "function") ctx.restore();
}

function buildLifeEvents(count) {
  const events = [];

  for (let i = 0; i < count; i += 1) {
    events.push({
      type: i % 2 === 0 ? "birth" : "death",
      row: i % 16,
      col: (i * 3) % 16,
      tick: 1000 - i,
      color: i % 2 === 0 ? "#7bed9f" : "#ff6b6b",
    });
  }

  return events;
}

function measure(label, fn, iterations, ctxFactory, events, options) {
  if (typeof global.gc !== "function") {
    throw new Error("Run with node --expose-gc to enable forced garbage collection.");
  }

  const ctx = ctxFactory();
  const WARMUP = 200;

  for (let i = 0; i < WARMUP; i += 1) {
    fn(ctx, 8, events, options);
  }

  global.gc();
  const start = process.memoryUsage().heapUsed;
  let peak = start;

  for (let i = 0; i < iterations; i += 1) {
    fn(ctx, 8, events, options);
    const current = process.memoryUsage().heapUsed;

    if (current > peak) {
      peak = current;
    }
  }

  global.gc();
  const end = process.memoryUsage().heapUsed;

  return { label, start, end, delta: end - start, peak };
}

const ITERATIONS = 2000;
const events = buildLifeEvents(240);
const options = {
  currentTick: 2000,
  fadeTicks: 48,
  limit: LIFE_EVENT_MARKER_MAX_COUNT,
};

const results = [
  measure(
    "legacy",
    drawLifeEventMarkersLegacy,
    ITERATIONS,
    createContextStub,
    events,
    options,
  ),
  measure(
    "modern",
    drawLifeEventMarkers,
    ITERATIONS,
    createContextStub,
    events,
    options,
  ),
];

for (const result of results) {
  const { label, start, end, delta, peak } = result;
  const formatted = {
    label,
    startKB: Math.round((start / 1024) * 100) / 100,
    endKB: Math.round((end / 1024) * 100) / 100,
    deltaKB: Math.round((delta / 1024) * 100) / 100,
    peakKB: Math.round((peak / 1024) * 100) / 100,
    peakDeltaKB: Math.round(((peak - start) / 1024) * 100) / 100,
  };

  console.log(JSON.stringify(formatted));
}
