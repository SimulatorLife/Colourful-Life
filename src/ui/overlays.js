import { MAX_TILE_ENERGY } from "../config.js";
import { clamp, clamp01, clampFinite } from "../utils/math.js";
import { createRankedBuffer } from "../utils/collections.js";
import { toPlainObject } from "../utils/object.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";
import { resolveNonEmptyString } from "../utils/primitives.js";
import { getDensityAt } from "../grid/densityUtils.js";

const DEFAULT_FITNESS_TOP_PERCENT = 0.1;
const FITNESS_GRADIENT_STEPS = 5;
const FITNESS_BASE_HUE = 52;
const LIFE_EVENT_MARKER_MAX_COUNT = 24;
const LIFE_EVENT_MARKER_FADE_TICKS = 36;
const LIFE_EVENT_MARKER_MIN_ALPHA = 0.18;
const LIFE_EVENT_MARKER_MAX_ALPHA = 0.92;
const LIFE_EVENT_MARKER_DEFAULT_COLORS = Object.freeze({
  birth: "#7bed9f",
  death: "#ff6b6b",
});
const LIFE_EVENT_LEGEND_MIN_WIDTH = 150;
const AGE_HEATMAP_COLOR = "255, 138, 0";
const AGE_HEATMAP_BASE_ALPHA = 0.18;
const DEFAULT_OBSTACLE_MASK_FILL = "rgba(40, 40, 55, 0.35)";
const DEFAULT_OBSTACLE_MASK_OUTLINE = "rgba(200, 200, 255, 0.35)";
const OBSTACLE_MASK_LINE_WIDTH_SCALE = 0.12;
const OBSTACLE_MASK_ALPHA = 0.35;
const GRID_LINE_COLOR = "rgba(255, 255, 255, 0.1)";
const GRID_LINE_EMPHASIS_COLOR = "rgba(255, 255, 255, 0.2)";
const GRID_LINE_EMPHASIS_STEP = 5;
const GRID_LINE_CACHE_LIMIT = 6;

const gridLineCache = new Map();
const gridLineCacheOrder = [];

const DENSITY_GRADIENT_STOPS = Object.freeze([
  Object.freeze({ t: 0, color: Object.freeze([59, 76, 192]) }),
  Object.freeze({ t: 0.5, color: Object.freeze([221, 244, 255]) }),
  Object.freeze({ t: 1, color: Object.freeze([220, 36, 31]) }),
]);

const DENSITY_GRADIENT_SEGMENTS = Object.freeze(
  DENSITY_GRADIENT_STOPS.slice(1).map((end, index) => {
    const start = DENSITY_GRADIENT_STOPS[index];
    const span = end.t - start.t || 1;

    return Object.freeze({
      startT: start.t,
      endT: end.t,
      span,
      startColor: start.color,
      deltaR: end.color[0] - start.color[0],
      deltaG: end.color[1] - start.color[1],
      deltaB: end.color[2] - start.color[2],
    });
  }),
);

const DENSITY_GRADIENT_FALLBACK_SEGMENT =
  DENSITY_GRADIENT_SEGMENTS.length > 0
    ? DENSITY_GRADIENT_SEGMENTS[DENSITY_GRADIENT_SEGMENTS.length - 1]
    : Object.freeze({
        startT: 0,
        endT: 1,
        span: 1,
        startColor: Object.freeze([59, 76, 192]),
        deltaR: 161,
        deltaG: 168,
        deltaB: -161,
      });

const DENSITY_COLOR_CACHE_SIZE = 512;
const densityColorCache = new Array(DENSITY_COLOR_CACHE_SIZE);
const densityColorCacheOpaque = new Array(DENSITY_COLOR_CACHE_SIZE);

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

function resolveLifeEventColor(event, overridesInput) {
  const overrides = toPlainObject(overridesInput);

  const typeOverride = overrides[event?.type];
  const fallbackOverride = overrides.default ?? overrides.fallback ?? overrides.other;
  const isColor = (candidate) => typeof candidate === "string" && candidate.length > 0;
  const typeColor = isColor(typeOverride) ? typeOverride : null;
  const fallbackColor =
    isColor(fallbackOverride) && fallbackOverride !== typeColor
      ? fallbackOverride
      : null;

  return (
    [
      event?.highlight?.color,
      event?.color,
      typeColor,
      fallbackColor,
      LIFE_EVENT_MARKER_DEFAULT_COLORS[event?.type],
      LIFE_EVENT_MARKER_DEFAULT_COLORS.birth,
    ].find(isColor) ?? LIFE_EVENT_MARKER_DEFAULT_COLORS.birth
  );
}

function createLifeEventMarkerDescriptor(
  event,
  { currentTick, fadeWindow, colorOverrides },
  target = null,
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

  const descriptor = target ?? {
    row,
    col,
    color,
    alpha,
    type,
  };

  descriptor.row = row;
  descriptor.col = col;
  descriptor.color = color;
  descriptor.alpha = alpha;
  descriptor.type = type;

  return descriptor;
}

function drawDeathMarker(ctx, centerX, centerY, radius, color) {
  if (!ctx) return;

  const half = radius * Math.SQRT1_2;

  if (typeof ctx.beginPath === "function") {
    ctx.beginPath();
    if (typeof ctx.moveTo === "function" && typeof ctx.lineTo === "function") {
      ctx.moveTo(centerX - half, centerY - half);
      ctx.lineTo(centerX + half, centerY + half);
      ctx.moveTo(centerX - half, centerY + half);
      ctx.lineTo(centerX + half, centerY - half);
    }
    if (typeof ctx.stroke === "function") {
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function") {
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(radius * 0.35, 0.75), 0, Math.PI * 2);
    if (typeof ctx.fill === "function") {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }
}

function drawBirthMarker(ctx, centerX, centerY, radius, color) {
  if (!ctx) return;

  if (typeof ctx.beginPath === "function" && typeof ctx.arc === "function") {
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    if (typeof ctx.stroke === "function") {
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    const innerRadiusCandidate = Math.max(radius * 0.45, 1);
    const innerRadiusLimit = Math.max(
      radius - Math.max(radius * 0.15, 0.2),
      radius * 0.6,
      0,
    );
    const innerRadius = Math.max(0, Math.min(innerRadiusCandidate, innerRadiusLimit));

    if (innerRadius > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
      if (typeof ctx.fill === "function") {
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
  }
}

/**
 * Renders transient birth/death markers on top of the canvas so recent life
 * events are easy to spot without overwhelming other overlays.
 *
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 * @param {Array} events - Queue of recent events produced by
 *   {@link GridManager}.
 * @param {{
 *   limit?: number,
 *   fadeTicks?: number,
 *   currentTick?: number,
 *   colors?: Record<string, string>,
 * }} [options] - Rendering customisations.
 */
const LIFE_EVENT_MARKER_POOL_LIMIT = 256;
let lifeEventMarkerScratch = [];
let lifeEventMarkerPool = [];

function acquireLifeEventMarker() {
  return (
    lifeEventMarkerPool.pop() ?? { row: 0, col: 0, color: "", alpha: 0, type: "other" }
  );
}

function releaseLifeEventMarker(descriptor) {
  if (!descriptor) return;

  descriptor.row = 0;
  descriptor.col = 0;
  descriptor.color = "";
  descriptor.alpha = 0;
  descriptor.type = "other";

  if (lifeEventMarkerPool.length < LIFE_EVENT_MARKER_POOL_LIMIT) {
    lifeEventMarkerPool.push(descriptor);
  }
}

export function drawLifeEventMarkers(ctx, cellSize, events, options = {}) {
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

  const prepared = lifeEventMarkerScratch;

  prepared.length = 0;

  for (const event of events) {
    if (!event) continue;

    const reusable = acquireLifeEventMarker();
    const descriptor = createLifeEventMarkerDescriptor(
      event,
      { currentTick, fadeWindow, colorOverrides },
      reusable,
    );

    if (descriptor) {
      prepared.push(descriptor);
    } else {
      // Reclaim the unused descriptor when validation rejects the event.
      releaseLifeEventMarker(reusable);
    }
  }

  const availableMarkers = prepared.length;

  if (availableMarkers === 0) {
    return;
  }

  const toRender = Math.min(maxCount, availableMarkers);
  const renderedCounts = { birth: 0, death: 0, other: 0 };
  const canSave = typeof ctx.save === "function";

  if (canSave) ctx.save();

  if (ctx.lineJoin !== undefined) ctx.lineJoin = "round";
  if (ctx.lineCap !== undefined) ctx.lineCap = "round";

  const previousLineWidth = ctx.lineWidth;

  if (ctx.lineWidth !== undefined) ctx.lineWidth = strokeWidth;

  let drawn = 0;

  for (let index = availableMarkers - 1; index >= 0 && drawn < toRender; index -= 1) {
    const entry = prepared[index];
    const { row, col, color: rawColor, alpha, type } = entry;

    if (ctx.globalAlpha !== undefined) {
      ctx.globalAlpha = Number.isFinite(alpha) ? alpha : LIFE_EVENT_MARKER_MAX_ALPHA;
    }

    const fallbackColor =
      type === "death"
        ? LIFE_EVENT_MARKER_DEFAULT_COLORS.death
        : LIFE_EVENT_MARKER_DEFAULT_COLORS.birth;
    const color = resolveNonEmptyString(rawColor, fallbackColor);
    const centerX = (col + 0.5) * cellSize;
    const centerY = (row + 0.5) * cellSize;

    if (type === "death") {
      drawDeathMarker(ctx, centerX, centerY, markerRadius, color);
      renderedCounts.death++;
    } else if (type === "birth") {
      drawBirthMarker(ctx, centerX, centerY, markerRadius, color);
      renderedCounts.birth++;
    } else {
      drawBirthMarker(ctx, centerX, centerY, markerRadius, color);
      renderedCounts.other++;
    }

    drawn += 1;
  }

  if (ctx.globalAlpha !== undefined) {
    ctx.globalAlpha = 1;
  }
  if (ctx.lineWidth !== undefined && Number.isFinite(previousLineWidth)) {
    ctx.lineWidth = previousLineWidth;
  }
  if (canSave && typeof ctx.restore === "function") ctx.restore();

  for (const descriptor of prepared) {
    releaseLifeEventMarker(descriptor);
  }

  prepared.length = 0;

  const legendColors = {
    birth: resolveLifeEventColor({ type: "birth" }, colorOverrides),
    death: resolveLifeEventColor({ type: "death" }, colorOverrides),
  };

  drawLifeEventLegend(ctx, cellSize, renderedCounts, {
    colors: legendColors,
    fadeWindow,
    drawnCount: drawn,
    visibleCount: availableMarkers,
  });
}

function normalizeLegendColor(candidate, fallback) {
  return resolveNonEmptyString(candidate, fallback);
}

function drawLegendBirthBadge(ctx, centerX, centerY, radius, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, radius * 0.7);
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.max(radius * 0.45, 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLegendDeathBadge(ctx, centerX, centerY, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.75);
  const half = size / 2;

  ctx.beginPath();
  ctx.moveTo(centerX - half, centerY - half);
  ctx.lineTo(centerX + half, centerY + half);
  ctx.moveTo(centerX - half, centerY + half);
  ctx.lineTo(centerX + half, centerY - half);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(centerX, centerY, Math.max(size * 0.35, 1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawLifeEventLegend(ctx, cellSize, counts = {}, metadata = {}) {
  if (!ctx) return;

  if (typeof ctx.fillRect !== "function" || typeof ctx.fillText !== "function") {
    return;
  }

  const drawnCount = Number.isFinite(metadata.drawnCount) ? metadata.drawnCount : 0;

  if (drawnCount <= 0) {
    return;
  }

  const fadeWindow = Number.isFinite(metadata.fadeWindow) ? metadata.fadeWindow : null;
  const visibleCount = Number.isFinite(metadata.visibleCount)
    ? metadata.visibleCount
    : drawnCount;
  const birthCount = Number.isFinite(counts.birth) ? counts.birth : 0;
  const deathCount = Number.isFinite(counts.death) ? counts.death : 0;
  const net = birthCount - deathCount;
  const birthColor = normalizeLegendColor(
    metadata.colors?.birth,
    LIFE_EVENT_MARKER_DEFAULT_COLORS.birth,
  );
  const deathColor = normalizeLegendColor(
    metadata.colors?.death,
    LIFE_EVENT_MARKER_DEFAULT_COLORS.death,
  );
  const netColor =
    net > 0 ? birthColor : net < 0 ? deathColor : "rgba(255, 255, 255, 0.85)";
  const padding = 10;
  const lineHeight = 16;
  const bulletRadius = clamp(cellSize * 0.32, 3.5, 7);
  const bulletColumnWidth = bulletRadius * 2 + 6;
  const titleFont = "bold 12px sans-serif";
  const bodyFont = "12px sans-serif";
  const title = "Life events";
  const fadeLine =
    fadeWindow && fadeWindow > 0
      ? `Fade window ≤ ${fadeWindow} tick${fadeWindow === 1 ? "" : "s"}`
      : null;
  const coverageLine =
    visibleCount > 0
      ? visibleCount > drawnCount
        ? `Markers: ${drawnCount} of ${visibleCount}`
        : `Markers: ${drawnCount}`
      : null;
  const lines = [
    fadeLine ? { text: fadeLine, type: "meta" } : null,
    coverageLine ? { text: coverageLine, type: "meta" } : null,
    { text: `Births: ${birthCount}`, type: "birth" },
    { text: `Deaths: ${deathCount}`, type: "death" },
    { text: `Net: ${net > 0 ? "+" : ""}${net}`, type: "net" },
  ].filter(Boolean);

  const canSave = typeof ctx.save === "function";

  if (canSave) ctx.save();
  ctx.textBaseline = "top";
  ctx.font = titleFont;
  const titleWidth =
    typeof ctx.measureText === "function" ? ctx.measureText(title).width : 0;

  ctx.font = bodyFont;
  const bodyWidths = lines.map((line) =>
    typeof ctx.measureText === "function" ? ctx.measureText(line.text).width : 0,
  );
  const maxBodyWidth = bodyWidths.length > 0 ? Math.max(...bodyWidths) : 0;
  const contentWidth = Math.max(titleWidth, maxBodyWidth);
  const blockWidth = Math.max(
    LIFE_EVENT_LEGEND_MIN_WIDTH,
    padding * 2 + bulletColumnWidth + contentWidth,
  );
  const blockHeight = padding * 2 + lineHeight * (1 + lines.length);
  const originX = padding;
  const originY = padding;

  ctx.fillStyle = "rgba(10, 14, 22, 0.78)";
  ctx.fillRect(originX, originY, blockWidth, blockHeight);

  const textX = originX + padding + bulletColumnWidth;
  let cursorY = originY + padding;

  ctx.font = titleFont;
  ctx.fillStyle = "#fff";
  ctx.fillText(title, textX, cursorY);
  cursorY += lineHeight;

  ctx.font = bodyFont;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const lineY = cursorY;
    const bulletCenterX = originX + padding + bulletRadius;
    const bulletCenterY = lineY + lineHeight / 2;

    if (line.type === "birth") {
      drawLegendBirthBadge(ctx, bulletCenterX, bulletCenterY, bulletRadius, birthColor);
      ctx.fillStyle = "#fff";
    } else if (line.type === "death") {
      drawLegendDeathBadge(
        ctx,
        bulletCenterX,
        bulletCenterY,
        bulletRadius * 1.15,
        deathColor,
      );
      ctx.fillStyle = "#fff";
    } else if (line.type === "net") {
      ctx.fillStyle = netColor;
    } else {
      ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    }

    ctx.fillText(line.text, textX, lineY);
    cursorY += lineHeight;
  }

  if (canSave && typeof ctx.restore === "function") {
    ctx.restore();
  }
}

function createFitnessPalette(steps, hue) {
  const minLightness = 32;
  const maxLightness = 82;
  const saturation = 88;
  const numericSteps = Number(steps);

  if (!Number.isFinite(numericSteps)) {
    return [];
  }

  const stepCount = Math.max(0, Math.ceil(numericSteps));

  if (stepCount <= 1) {
    const midLightness = (minLightness + maxLightness) / 2;

    return [`hsl(${hue}, ${saturation}%, ${midLightness.toFixed(1)}%)`];
  }

  const denominator = numericSteps - 1;
  const span = maxLightness - minLightness;

  return Array.from({ length: stepCount }, (_, index) => {
    const t = denominator !== 0 ? index / denominator : 0;
    const lightness = maxLightness - span * t;

    return `hsl(${hue}, ${saturation}%, ${lightness.toFixed(1)}%)`;
  });
}

/**
 * Shades active environmental event rectangles on the canvas.
 *
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 * @param {Array} activeEvents - Current events supplied by
 *   {@link EventManager}.
 * @param {(event: Object) => string} getColor - Resolver that maps events to
 *   fill colours.
 */
const WARNINGS = Object.freeze({
  eventColor: "Failed to resolve event overlay color; using fallback.",
});

export function drawEventOverlays(ctx, cellSize, activeEvents, getColor) {
  if (!ctx || !Array.isArray(activeEvents) || activeEvents.length === 0) return;

  ctx.save();
  for (const event of activeEvents) {
    if (!event || !event.affectedArea) continue;

    const { affectedArea } = event;
    let color = event.color || "rgba(255, 255, 255, 0.15)";

    if (typeof getColor === "function") {
      const resolved = invokeWithErrorBoundary(getColor, [event], {
        message: WARNINGS.eventColor,
        reporter: warnOnce,
        once: true,
      });

      if (typeof resolved === "string" && resolved.length > 0) {
        color = resolved;
      }
    }

    if (!color) continue;

    ctx.fillStyle = color;
    ctx.fillRect(
      affectedArea.x * cellSize,
      affectedArea.y * cellSize,
      affectedArea.width * cellSize,
      affectedArea.height * cellSize,
    );
  }
  ctx.restore();
}

function drawObstacleMask(
  grid,
  ctx,
  cellSize,
  { fill = DEFAULT_OBSTACLE_MASK_FILL, outline = DEFAULT_OBSTACLE_MASK_OUTLINE } = {},
) {
  const mask = grid?.obstacles;

  if (!ctx || !Array.isArray(mask) || !(cellSize > 0)) return;

  const canUseCache =
    typeof grid?.getObstacleRenderSurface === "function" &&
    fill === DEFAULT_OBSTACLE_MASK_FILL &&
    outline === DEFAULT_OBSTACLE_MASK_OUTLINE;

  if (canUseCache) {
    const surface = grid.getObstacleRenderSurface(cellSize, {
      lineWidthScale: OBSTACLE_MASK_LINE_WIDTH_SCALE,
    });

    if (surface && surface.hasAny === false) {
      return;
    }

    if (surface?.fillCanvas && surface?.strokeCanvas && surface.hasAny) {
      const alreadyPainted =
        surface.lastBasePaintRevision === surface.revision &&
        surface.lastBasePaintCellSize === cellSize;

      if (!alreadyPainted) {
        ctx.save();
        if (ctx.globalAlpha !== undefined) {
          ctx.globalAlpha = OBSTACLE_MASK_ALPHA;
        }
        ctx.drawImage(surface.fillCanvas, 0, 0);
        ctx.drawImage(surface.strokeCanvas, 0, 0);
        ctx.restore();
      }

      return;
    }
  }

  const rows = grid.rows || mask.length;
  const cols = grid.cols || (mask[0]?.length ?? 0);

  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(1, cellSize * OBSTACLE_MASK_LINE_WIDTH_SCALE);

  for (let r = 0; r < rows; r++) {
    const rowMask = mask[r];

    if (!rowMask) continue;
    for (let c = 0; c < cols; c++) {
      if (!rowMask[c]) continue;
      const x = c * cellSize;
      const y = r * cellSize;

      ctx.fillRect(x, y, cellSize, cellSize);
    }
  }

  const canStroke =
    typeof ctx.beginPath === "function" &&
    typeof ctx.moveTo === "function" &&
    typeof ctx.lineTo === "function" &&
    typeof ctx.stroke === "function";

  if (canStroke) {
    ctx.beginPath();
    const halfPixel = 0.5;

    for (let r = 0; r < rows; r++) {
      const rowMask = mask[r];

      if (!rowMask) continue;
      const prevRow = r > 0 ? mask[r - 1] : null;
      const nextRow = r + 1 < rows ? mask[r + 1] : null;

      for (let c = 0; c < cols; c++) {
        if (!rowMask[c]) continue;

        const x = c * cellSize;
        const y = r * cellSize;
        const leftBlocked = c > 0 && rowMask[c - 1];
        const rightBlocked = c + 1 < cols && rowMask[c + 1];
        const topBlocked = prevRow ? prevRow[c] : false;
        const bottomBlocked = nextRow ? nextRow[c] : false;

        if (!topBlocked) {
          ctx.moveTo(x, y + halfPixel);
          ctx.lineTo(x + cellSize, y + halfPixel);
        }

        if (!bottomBlocked) {
          const bottomY = y + cellSize - halfPixel;

          ctx.moveTo(x, bottomY);
          ctx.lineTo(x + cellSize, bottomY);
        }

        if (!leftBlocked) {
          ctx.moveTo(x + halfPixel, y);
          ctx.lineTo(x + halfPixel, y + cellSize);
        }

        if (!rightBlocked) {
          const rightX = x + cellSize - halfPixel;

          ctx.moveTo(rightX, y);
          ctx.lineTo(rightX, y + cellSize);
        }
      }
    }

    ctx.stroke();
  }

  ctx.restore();
}

function createGridLineCacheKey({
  rows,
  cols,
  cellSize,
  lineWidth,
  baseColor,
  highlightColor,
  emphasisInterval,
}) {
  return JSON.stringify([
    rows,
    cols,
    cellSize,
    lineWidth,
    baseColor,
    highlightColor,
    emphasisInterval,
  ]);
}

function createGridLineCanvas(width, height) {
  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  if (typeof OffscreenCanvas === "function") {
    try {
      return new OffscreenCanvas(width, height);
    } catch (error) {
      warnOnce("Failed to allocate OffscreenCanvas for grid lines.", error);
    }
  }

  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    return canvas;
  }

  return null;
}

function paintGridLinesToContext(
  ctx,
  { cellSize, rows, cols, baseColor, highlightColor, emphasisInterval, lineWidth },
) {
  if (!ctx) return false;

  const width = cols * cellSize;
  const height = rows * cellSize;

  const minorVertical = [];
  const majorVertical = [];
  const minorHorizontal = [];
  const majorHorizontal = [];

  for (let c = 1; c < cols; c += 1) {
    const target = c * cellSize;

    if (emphasisInterval > 1 && c % emphasisInterval === 0) majorVertical.push(target);
    else minorVertical.push(target);
  }

  for (let r = 1; r < rows; r += 1) {
    const target = r * cellSize;

    if (emphasisInterval > 1 && r % emphasisInterval === 0)
      majorHorizontal.push(target);
    else minorHorizontal.push(target);
  }

  const drawLines = (positions, orientation, strokeStyle) => {
    if (!positions.length) return;
    if (typeof ctx.beginPath !== "function") return;
    if (typeof ctx.moveTo !== "function" || typeof ctx.lineTo !== "function") return;
    if (typeof ctx.stroke !== "function") return;

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    const offset = lineWidth % 2 === 0 ? 0 : 0.5;

    ctx.beginPath();

    for (const position of positions) {
      if (orientation === "vertical") {
        const x = position + offset;

        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      } else {
        const y = position + offset;

        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
    }

    ctx.stroke();
  };

  drawLines(minorVertical, "vertical", baseColor);
  drawLines(minorHorizontal, "horizontal", baseColor);
  drawLines(majorVertical, "vertical", highlightColor);
  drawLines(majorHorizontal, "horizontal", highlightColor);

  return true;
}

function getGridLineSurface(config) {
  const { cellSize, rows, cols } = config;
  const width = cols * cellSize;
  const height = rows * cellSize;

  if (!(width > 0) || !(height > 0)) {
    return null;
  }

  const key = createGridLineCacheKey(config);
  let entry = gridLineCache.get(key);

  if (entry && entry.width === width && entry.height === height) {
    return entry;
  }

  const canvas = createGridLineCanvas(width, height);

  if (!canvas) {
    gridLineCache.delete(key);

    return null;
  }

  const context = canvas.getContext("2d");

  if (!context) {
    gridLineCache.delete(key);

    return null;
  }

  if (context.imageSmoothingEnabled != null) {
    context.imageSmoothingEnabled = false;
  }

  const painted = paintGridLinesToContext(context, config);

  if (!painted) {
    gridLineCache.delete(key);

    return null;
  }

  entry = { canvas, width, height };
  gridLineCache.set(key, entry);

  const existingIndex = gridLineCacheOrder.indexOf(key);

  if (existingIndex !== -1) {
    gridLineCacheOrder.splice(existingIndex, 1);
  }

  gridLineCacheOrder.push(key);

  if (gridLineCacheOrder.length > GRID_LINE_CACHE_LIMIT) {
    const evictKey = gridLineCacheOrder.shift();

    if (evictKey && evictKey !== key) {
      gridLineCache.delete(evictKey);
    }
  }

  return entry;
}

export function drawGridLines(ctx, cellSize, rows, cols, options = {}) {
  if (!ctx || !(cellSize > 0) || !(rows > 0) || !(cols > 0)) return;

  const { color, emphasisColor, emphasisStep, lineWidth } = toPlainObject(options);
  const baseColor = resolveNonEmptyString(color, GRID_LINE_COLOR);
  const highlightColor = resolveNonEmptyString(emphasisColor, GRID_LINE_EMPHASIS_COLOR);
  const emphasisInterval =
    Number.isFinite(emphasisStep) && emphasisStep > 1
      ? Math.floor(emphasisStep)
      : GRID_LINE_EMPHASIS_STEP;
  const resolvedLineWidth =
    Number.isFinite(lineWidth) && lineWidth > 0 ? lineWidth : cellSize >= 18 ? 2 : 1;

  const config = {
    cellSize,
    rows,
    cols,
    baseColor,
    highlightColor,
    emphasisInterval,
    lineWidth: resolvedLineWidth,
  };

  const surface = getGridLineSurface(config);

  if (surface && typeof ctx.drawImage === "function") {
    const { width, height } = surface;
    const previousSmoothing = ctx.imageSmoothingEnabled;

    if (typeof ctx.save === "function") ctx.save();

    if (ctx.imageSmoothingEnabled != null) {
      ctx.imageSmoothingEnabled = false;
    }

    ctx.drawImage(
      surface.canvas,
      0,
      0,
      width,
      height,
      0,
      0,
      cols * cellSize,
      rows * cellSize,
    );

    if (ctx.imageSmoothingEnabled != null) {
      ctx.imageSmoothingEnabled = previousSmoothing;
    }

    if (typeof ctx.restore === "function") ctx.restore();

    return;
  }

  if (typeof ctx.save === "function") ctx.save();
  paintGridLinesToContext(ctx, config);
  if (typeof ctx.restore === "function") ctx.restore();
}

function formatAlpha(alpha) {
  if (!(alpha > 0)) return "0";
  if (alpha >= 1) return "1";

  const safeAlpha = alpha < 0.001 ? 0.001 : alpha;
  const formatted = safeAlpha.toFixed(3);

  return formatted === "1.000" ? "1" : formatted;
}

const heatmapFillStyleCache = new Map();

function resolveHeatmapFillStyle(color, alpha) {
  const normalizedAlpha = clampFinite(alpha, 0, 1, 0);

  if (!(normalizedAlpha > 0)) {
    return null;
  }

  let bucket = Math.round(normalizedAlpha * 255);

  if (bucket <= 0) {
    bucket = 1;
  }

  let colorCache = heatmapFillStyleCache.get(color);

  if (!colorCache) {
    colorCache = new Array(256);
    heatmapFillStyleCache.set(color, colorCache);
  }

  let fillStyle = colorCache[bucket];

  if (!fillStyle) {
    const bucketAlpha = bucket / 255;

    fillStyle = `rgba(${color},${formatAlpha(bucketAlpha)})`;
    colorCache[bucket] = fillStyle;
  }

  return fillStyle;
}

function drawScalarHeatmap(grid, ctx, cellSize, alphaAt, color = "0,0,0") {
  const rows = Number.isFinite(grid?.rows) ? grid.rows : 0;
  const cols = Number.isFinite(grid?.cols) ? grid.cols : 0;

  if (!(rows > 0) || !(cols > 0)) {
    return;
  }

  let lastFillStyle = null;

  for (let r = 0; r < rows; r++) {
    const y = r * cellSize;

    for (let c = 0; c < cols; c++) {
      const fillStyle = resolveHeatmapFillStyle(color, alphaAt(r, c));

      if (!fillStyle) continue;

      if (fillStyle !== lastFillStyle) {
        ctx.fillStyle = fillStyle;
        lastFillStyle = fillStyle;
      }

      ctx.fillRect(c * cellSize, y, cellSize, cellSize);
    }
  }
}

function formatEnergyLegendValue(value, maxTileEnergy) {
  if (!Number.isFinite(value)) return "N/A";

  const boundedMax =
    Number.isFinite(maxTileEnergy) && maxTileEnergy > 0 ? maxTileEnergy : 0;

  if (boundedMax <= 0) {
    return value.toFixed(1);
  }

  const percent = clamp01(value / boundedMax) * 100;

  return `${value.toFixed(1)} (${percent.toFixed(0)}%)`;
}

function computeEnergyStats(grid, maxTileEnergy = MAX_TILE_ENERGY) {
  const rows = grid?.rows;
  const cols = grid?.cols;
  const energyGrid = Array.isArray(grid?.energyGrid) ? grid.energyGrid : null;

  if (!energyGrid || !rows || !cols) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (let r = 0; r < rows; r++) {
    const energyRow = Array.isArray(energyGrid[r]) ? energyGrid[r] : [];

    for (let c = 0; c < cols; c++) {
      const rawEnergy = energyRow[c];
      const value = clampFinite(rawEnergy, 0, maxTileEnergy, 0);

      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      count++;
    }
  }

  if (count === 0) return null;

  const average = sum / count;

  return { min, max, average };
}

function drawEnergyLegend(ctx, cellSize, cols, rows, stats, maxTileEnergy) {
  if (!stats || !Number.isFinite(cols) || !Number.isFinite(rows)) return;

  const { min, max, average } = stats;

  if (!Number.isFinite(min) || !Number.isFinite(max)) return;

  const padding = 10;
  const gradientHeight = 14;
  const gradientWidth = clamp(cols * cellSize * 0.25, 120, 160);
  const textLineHeight = 14;
  const lines = [
    { label: "Min", value: min },
    Number.isFinite(average) ? { label: "Mean", value: average } : null,
    { label: "Max", value: max },
  ].filter(Boolean);
  const blockHeight =
    gradientHeight + padding * 3 + textLineHeight * Math.max(1, lines.length);
  const blockWidth = gradientWidth + padding * 2;
  const x = cols * cellSize - blockWidth - padding;
  const y = rows * cellSize - blockHeight - padding;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, blockWidth, blockHeight);

  const gradientX = x + padding;
  const gradientY = y + padding;
  const gradient = ctx.createLinearGradient(
    gradientX,
    gradientY,
    gradientX + gradientWidth,
    gradientY,
  );
  const stops = [0, 0.25, 0.5, 0.75, 1];

  for (const stop of stops) {
    const alpha = clamp01(stop * 0.99);

    gradient.addColorStop(stop, `rgba(0,255,0,${alpha.toFixed(3)})`);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let textY = gradientY + gradientHeight + padding;

  for (const { label, value } of lines) {
    ctx.fillText(
      `${label}: ${formatEnergyLegendValue(value, maxTileEnergy)}`,
      gradientX,
      textY,
    );
    textY += textLineHeight;
  }

  ctx.restore();
}

/**
 * Converts a normalized density value into an RGBA string using the density
 * overlay palette.
 *
 * @param {number} normalizedValue - Density value in the 0..1 range.
 * @param {{opaque?: boolean}} [options] - Controls alpha output.
 * @returns {string} RGBA colour suitable for `fillStyle`.
 */
export function densityToRgba(normalizedValue, { opaque = false } = {}) {
  const normalized = clamp01(Number.isFinite(normalizedValue) ? normalizedValue : 0);
  const bucket = Math.round(normalized * (DENSITY_COLOR_CACHE_SIZE - 1));
  const cache = opaque ? densityColorCacheOpaque : densityColorCache;
  const cached = cache[bucket];

  if (cached) {
    return cached;
  }

  const segment = resolveDensityGradientSegment(normalized);
  const localT = segment.span > 0 ? (normalized - segment.startT) / segment.span : 0;
  const r = Math.round(segment.startColor[0] + segment.deltaR * localT);
  const g = Math.round(segment.startColor[1] + segment.deltaG * localT);
  const b = Math.round(segment.startColor[2] + segment.deltaB * localT);
  const alphaString = opaque ? "1" : (0.18 + 0.65 * normalized).toFixed(3);
  const color = `rgba(${r},${g},${b},${alphaString})`;

  cache[bucket] = color;

  return color;
}

function resolveDensityGradientSegment(t) {
  if (DENSITY_GRADIENT_SEGMENTS.length === 0) {
    return DENSITY_GRADIENT_FALLBACK_SEGMENT;
  }

  return (
    DENSITY_GRADIENT_SEGMENTS.find((segment) => t <= segment.endT) ??
    DENSITY_GRADIENT_FALLBACK_SEGMENT
  );
}

function formatDensityLegendValue(value) {
  if (!Number.isFinite(value)) return "N/A";

  const percent = clamp01(value) * 100;
  const percentText =
    percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;

  return `${value.toFixed(2)} (${percentText} occupancy)`;
}

function formatDensityLocation(location) {
  if (!location || typeof location !== "object") {
    return "";
  }

  const row = Number.isFinite(location.row) ? Math.round(location.row) : null;
  const col = Number.isFinite(location.col) ? Math.round(location.col) : null;

  if (row == null || col == null) {
    return "";
  }

  return `@ (${row}, ${col})`;
}

function drawDensityLegend(ctx, cellSize, cols, rows, stats = {}) {
  const minDensity = stats?.min;
  const maxDensity = stats?.max;

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) {
    return;
  }

  const gradientWidth = clamp(cols * cellSize * 0.25, 120, 160);
  const gradientHeight = 14;
  const padding = 10;
  const textLineHeight = 14;
  const lines = [
    { label: "Min", value: minDensity, location: stats?.minLocation },
    Number.isFinite(stats?.average)
      ? { label: "Mean", value: stats.average, location: null }
      : null,
    { label: "Max", value: maxDensity, location: stats?.maxLocation },
  ].filter(Boolean);
  const blockWidth = gradientWidth + padding * 2;
  const blockHeight =
    gradientHeight + textLineHeight * Math.max(1, lines.length) + padding * 3;
  const x = padding;
  const y = rows * cellSize - blockHeight - padding;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, blockWidth, blockHeight);

  const gradientX = x + padding;
  const gradientY = y + padding;

  const gradient = ctx.createLinearGradient(
    gradientX,
    gradientY,
    gradientX + gradientWidth,
    gradientY,
  );
  const stops = [0, 0.25, 0.5, 0.75, 1];

  for (const stop of stops) {
    gradient.addColorStop(stop, densityToRgba(stop, { opaque: true }));
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let textY = gradientY + gradientHeight + padding;

  for (const line of lines) {
    const valueText = formatDensityLegendValue(line.value);
    const locationText = formatDensityLocation(line.location);
    const text = [`${line.label}: ${valueText}`, locationText]
      .filter(Boolean)
      .join(" ");

    ctx.fillText(text, gradientX, textY);
    textY += textLineHeight;
  }

  ctx.restore();
}

/**
 * High-level overlay renderer orchestrating density, energy, fitness, trait,
 * and event layers.
 *
 * @param {Object} grid - Grid snapshot from {@link GridManager}.
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 * @param {Object} [opts] - Overlay toggles and helpers.
 * @param {{topPercent?: number}} [opts.fitnessOverlayOptions] - Customisation hooks for
 *   {@link drawFitnessHeatmap}. Defaults preserve the original 10% highlight window.
 */
export function drawOverlays(grid, ctx, cellSize, opts = {}) {
  const {
    showEnergy,
    showDensity,
    showAge,
    showFitness,
    showLifeEventMarkers,
    showGridLines,
    showObstacles = true,
    maxTileEnergy = MAX_TILE_ENERGY,
    activeEvents,
    getEventColor,
    snapshot: providedSnapshot,
    fitnessOverlayOptions,
    gridLineOptions,
    lifeEvents,
    currentTick: lifeEventCurrentTick,
    lifeEventFadeTicks,
    lifeEventLimit,
  } = opts;
  let snapshot = providedSnapshot;
  const rows = Number.isFinite(grid?.rows) ? grid.rows : 0;
  const cols = Number.isFinite(grid?.cols) ? grid.cols : 0;

  if (Array.isArray(activeEvents) && activeEvents.length > 0) {
    drawEventOverlays(ctx, cellSize, activeEvents, getEventColor);
  }

  if (showObstacles) drawObstacleMask(grid, ctx, cellSize);

  if (showEnergy) {
    const stats = computeEnergyStats(grid, maxTileEnergy);

    drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy, stats);
  }
  if (showDensity) drawDensityHeatmap(grid, ctx, cellSize);
  if (showAge) drawAgeHeatmap(grid, ctx, cellSize);
  if (showFitness) {
    if (!snapshot && typeof grid?.getLastSnapshot === "function") {
      snapshot = grid.getLastSnapshot();
    }
  }
  if (showFitness) {
    drawFitnessHeatmap(snapshot, ctx, cellSize, fitnessOverlayOptions);
  }
  if (showGridLines) {
    drawGridLines(ctx, cellSize, rows, cols, gridLineOptions);
  }
  if (showLifeEventMarkers && Array.isArray(lifeEvents) && lifeEvents.length > 0) {
    drawLifeEventMarkers(ctx, cellSize, lifeEvents, {
      currentTick: lifeEventCurrentTick,
      fadeTicks: lifeEventFadeTicks,
      limit: lifeEventLimit,
    });
  }
}

/**
 * Draws the energy heatmap overlay summarising per-tile energy levels.
 *
 * @param {Object} grid - Grid snapshot containing energy data.
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 * @param {number} [maxTileEnergy=MAX_TILE_ENERGY] - Energy cap used to normalise colours.
 * @param {{min:number,max:number,average:number}|null} [statsOverride] - Optional
 *   precomputed energy statistics to reuse when multiple overlays need the
 *   same summary values.
 */
export function drawEnergyHeatmap(
  grid,
  ctx,
  cellSize,
  maxTileEnergy = MAX_TILE_ENERGY,
  statsOverride = null,
) {
  if (!grid || !Array.isArray(grid.energyGrid) || !grid.rows || !grid.cols) return;

  const scale = 0.99;
  const stats = statsOverride ?? computeEnergyStats(grid, maxTileEnergy);

  drawScalarHeatmap(
    grid,
    ctx,
    cellSize,
    (r, c) => (grid.energyGrid[r][c] / maxTileEnergy) * scale,
    "0,255,0",
  );

  if (stats) {
    drawEnergyLegend(ctx, cellSize, grid.cols, grid.rows, stats, maxTileEnergy);
  }
}

let densityScratchBuffer = null;
let densityScratchSize = 0;

function ensureDensityScratchSize(size) {
  if (!densityScratchBuffer || densityScratchSize < size) {
    densityScratchBuffer = new Float32Array(size);
    densityScratchSize = size;
  }

  return densityScratchBuffer;
}

/**
 * Renders the density heatmap overlay using density normalisation helpers.
 *
 * @param {Object} grid - Grid snapshot containing density data.
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 */
export function drawDensityHeatmap(grid, ctx, cellSize) {
  const rows = grid.rows;
  const cols = grid.cols;

  if (!rows || !cols) return;

  const totalCells = rows * cols;
  const scratch = ensureDensityScratchSize(totalCells);
  let scratchIndex = 0;
  let minDensity = Infinity;
  let maxDensity = -Infinity;
  let sumDensity = 0;
  let minRow = 0;
  let minCol = 0;
  let maxRow = 0;
  let maxCol = 0;
  const densityGrid = Array.isArray(grid.densityGrid) ? grid.densityGrid : null;

  for (let r = 0; r < rows; r++) {
    const densityRow = densityGrid ? densityGrid[r] : null;

    for (let c = 0; c < cols; c++) {
      const rawDensity =
        densityRow && Number.isFinite(densityRow[c])
          ? densityRow[c]
          : getDensityAt(grid, r, c);
      const density = Number.isFinite(rawDensity) ? rawDensity : 0;

      scratch[scratchIndex++] = density;
      sumDensity += density;

      if (density < minDensity) {
        minDensity = density;
        minRow = r;
        minCol = c;
      }
      if (density > maxDensity) {
        maxDensity = density;
        maxRow = r;
        maxCol = c;
      }
    }
  }

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) return;

  const originalMin = minDensity;
  const originalMax = maxDensity;
  const minLocation = Number.isFinite(minDensity) ? { row: minRow, col: minCol } : null;
  const maxLocation = Number.isFinite(maxDensity) ? { row: maxRow, col: maxCol } : null;
  const averageDensity =
    totalCells > 0 && Number.isFinite(sumDensity) ? sumDensity / totalCells : null;
  let range = maxDensity - minDensity;

  if (range <= 1e-8) {
    const epsilon = Math.abs(maxDensity) * 0.01 || 0.5;

    minDensity -= epsilon;
    maxDensity += epsilon;
    range = maxDensity - minDensity;
  }

  scratchIndex = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const density = scratch[scratchIndex++];
      const normalized = (density - minDensity) / range;

      ctx.fillStyle = densityToRgba(normalized);
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }

  drawDensityLegend(ctx, cellSize, cols, rows, {
    min: originalMin,
    max: originalMax,
    average: averageDensity,
    minLocation,
    maxLocation,
  });
}

let ageFractionScratch = null;
let ageFractionScratchSize = 0;

function ensureAgeScratchSize(size) {
  if (!ageFractionScratch || ageFractionScratchSize < size) {
    ageFractionScratch = new Float32Array(size);
    ageFractionScratchSize = size;
  }

  return ageFractionScratch;
}

function summarizeAgeOverlay(grid, scratch, rows, cols) {
  const gridRows = Array.isArray(grid?.grid) ? grid.grid : null;
  let minFraction = Infinity;
  let maxFraction = -Infinity;
  let sumFraction = 0;
  let sumAge = 0;
  let tracked = 0;
  let minEntry = null;
  let maxEntry = null;

  for (let r = 0; r < rows; r++) {
    const rowCells = Array.isArray(gridRows?.[r]) ? gridRows[r] : null;

    for (let c = 0; c < cols; c++) {
      const index = r * cols + c;
      let cell = rowCells ? rowCells[c] : null;

      if (!cell && typeof grid?.getCell === "function") {
        cell = grid.getCell(r, c);
      }

      if (!cell || typeof cell !== "object") {
        scratch[index] = 0;

        continue;
      }

      const age = Number.isFinite(cell.age) && cell.age > 0 ? cell.age : 0;
      const lifespan =
        Number.isFinite(cell.lifespan) && cell.lifespan > 0 ? cell.lifespan : null;
      let normalized = 0;

      if (lifespan) {
        normalized = clamp01(age / lifespan);
      } else if (age > 0) {
        normalized = 1;
      }

      scratch[index] = normalized;

      sumFraction += normalized;
      sumAge += age;
      tracked += 1;

      if (normalized < minFraction) {
        minFraction = normalized;
        minEntry = { row: r, col: c, age, lifespan, fraction: normalized };
      }

      if (normalized > maxFraction) {
        maxFraction = normalized;
        maxEntry = { row: r, col: c, age, lifespan, fraction: normalized };
      }
    }
  }

  if (tracked === 0) {
    return null;
  }

  return {
    min: minEntry ? { ...minEntry } : null,
    max: maxEntry ? { ...maxEntry } : null,
    averageFraction: clamp01(sumFraction / tracked),
    averageAge: sumAge / tracked,
    count: tracked,
  };
}

function formatAgePercent(fraction, { approximate = false } = {}) {
  if (!Number.isFinite(fraction)) {
    return null;
  }

  const percent = clamp01(fraction) * 100;
  const precision = percent >= 10 ? 0 : 1;
  const prefix = approximate ? "~" : "";

  return `${prefix}${percent.toFixed(precision)}% lifespan`;
}

function formatAgeLegendEntry(label, entry) {
  if (!entry) {
    return null;
  }

  const ageTicks = Number.isFinite(entry.age) ? Math.round(entry.age) : 0;
  const percentText = formatAgePercent(entry.fraction);
  const locationText =
    Number.isFinite(entry.row) && Number.isFinite(entry.col)
      ? `@ (${Math.round(entry.row)}, ${Math.round(entry.col)})`
      : "";
  const percentSegment = percentText ? ` (${percentText})` : "";
  const locationSegment = locationText ? ` ${locationText}` : "";

  return `${label}: ${ageTicks} ticks${percentSegment}${locationSegment}`;
}

function formatAgeAverageLine(age, fraction) {
  const ageTicks = Number.isFinite(age) ? Math.round(age) : null;
  const percentText = formatAgePercent(fraction, { approximate: true });
  const ageSegment = ageTicks != null ? `${ageTicks} ticks` : null;
  const percentSegment = percentText ? `(${percentText})` : null;
  const parts = [ageSegment, percentSegment].filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return `Mean: ${parts.join(" ")}`;
}

function formatAgeCountLine(count) {
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  const rounded = Math.round(count);
  const label = rounded === 1 ? "Tracked: 1 organism" : `Tracked: ${rounded} organisms`;

  return label;
}

function drawAgeLegend(ctx, cellSize, cols, rows, stats) {
  if (!ctx || !stats || stats.count <= 0) {
    return;
  }

  const padding = 10;
  const gradientHeight = 12;
  const gradientWidth = clamp(cols * cellSize * 0.22, 120, 160);
  const textLineHeight = 14;
  const lines = [
    formatAgeLegendEntry("Oldest", stats.max),
    formatAgeAverageLine(stats.averageAge, stats.averageFraction),
    formatAgeLegendEntry("Youngest", stats.min),
    formatAgeCountLine(stats.count),
  ].filter(Boolean);
  const blockHeight =
    gradientHeight + padding * 3 + textLineHeight * Math.max(1, lines.length);
  const blockWidth = gradientWidth + padding * 2;
  const x = padding;
  const y = padding;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, blockWidth, blockHeight);

  const gradientX = x + padding;
  const gradientY = y + padding;
  let gradient = null;

  if (typeof ctx.createLinearGradient === "function") {
    gradient = ctx.createLinearGradient(
      gradientX,
      gradientY,
      gradientX + gradientWidth,
      gradientY,
    );
    gradient.addColorStop(
      0,
      `rgba(${AGE_HEATMAP_COLOR},${formatAlpha(AGE_HEATMAP_BASE_ALPHA)})`,
    );
    gradient.addColorStop(1, `rgba(${AGE_HEATMAP_COLOR},1)`);
  }

  ctx.fillStyle =
    gradient ?? `rgba(${AGE_HEATMAP_COLOR},${formatAlpha(AGE_HEATMAP_BASE_ALPHA)})`;
  ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

  if (!gradient) {
    ctx.fillStyle = `rgba(${AGE_HEATMAP_COLOR},1)`;
    ctx.fillRect(
      gradientX + gradientWidth - Math.min(gradientWidth, 12),
      gradientY,
      Math.min(gradientWidth, 12),
      gradientHeight,
    );
  }

  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let textY = gradientY + gradientHeight + padding;

  for (const line of lines) {
    ctx.fillText(line, gradientX, textY);
    textY += textLineHeight;
  }

  ctx.restore();
}

export function drawAgeHeatmap(grid, ctx, cellSize) {
  if (!grid || !ctx) return;

  const rows = Number.isFinite(grid?.rows) ? grid.rows : 0;
  const cols = Number.isFinite(grid?.cols) ? grid.cols : 0;

  if (!(rows > 0) || !(cols > 0) || !(cellSize > 0)) {
    return;
  }

  const totalTiles = rows * cols;
  const scratch = ensureAgeScratchSize(totalTiles);
  const stats = summarizeAgeOverlay(grid, scratch, rows, cols);

  const alphaAt = (r, c) => {
    const fraction = scratch[r * cols + c];

    if (!(fraction > 0)) {
      return 0;
    }

    const normalized = clamp01(fraction);
    const blended = AGE_HEATMAP_BASE_ALPHA + (1 - AGE_HEATMAP_BASE_ALPHA) * normalized;

    return clamp01(blended);
  };

  drawScalarHeatmap(grid, ctx, cellSize, alphaAt, AGE_HEATMAP_COLOR);

  if (stats) {
    drawAgeLegend(ctx, cellSize, cols, rows, stats);
  }
}

/**
 * Shades the canvas to highlight the fittest organisms based on the latest
 * leaderboard snapshot.
 *
 * @param {{rows?: number, cols?: number, entries?: Array, maxFitness?: number}} snapshot - Leaderboard data.
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 * @param {{topPercent?: number}} [options] - Overrides for highlight selection. `topPercent`
 *   controls the fraction of the leaderboard emphasised. Defaults to 0.1 when omitted.
 */
export function drawFitnessHeatmap(snapshot, ctx, cellSize, options = {}) {
  if (!snapshot || snapshot.maxFitness <= 0) return;

  const { rows, cols } = snapshot;
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];

  if (!entries.length) return;

  const topPercentCandidate = Number.isFinite(options.topPercent)
    ? clamp(options.topPercent, 0, 1)
    : DEFAULT_FITNESS_TOP_PERCENT;
  const keepCount = Math.max(1, Math.floor(entries.length * topPercentCandidate));
  const topEntries = selectTopFitnessEntries(entries, keepCount);

  if (topEntries.length === 0) {
    return;
  }
  const palette = createFitnessPalette(FITNESS_GRADIENT_STEPS, FITNESS_BASE_HUE);
  const tierSize = Math.max(1, Math.ceil(topEntries.length / palette.length));

  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

  topEntries.forEach(({ row, col }, index) => {
    const paletteIndex = Math.min(palette.length - 1, Math.floor(index / tierSize));

    ctx.fillStyle = palette[paletteIndex];
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
  });

  drawFitnessLegend(ctx, cellSize, cols, rows, palette, {
    highlighted: topEntries.length,
    total: entries.length,
    requestedPercent: topPercentCandidate,
    maxFitness: snapshot.maxFitness,
  });
}

function compareFitnessEntries(a, b) {
  const fitnessA = Number.isFinite(a?.fitness) ? a.fitness : -Infinity;
  const fitnessB = Number.isFinite(b?.fitness) ? b.fitness : -Infinity;

  if (fitnessA === fitnessB) {
    return 0;
  }

  return fitnessA > fitnessB ? -1 : 1;
}

export function selectTopFitnessEntries(entries, keepCount) {
  const list = Array.isArray(entries) ? entries : [];
  const limit = Math.max(0, Math.floor(keepCount ?? 0));

  if (limit === 0 || list.length === 0) {
    return [];
  }

  const buffer = createRankedBuffer(limit, compareFitnessEntries);

  list.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    buffer.add(entry);
  });

  return buffer.getItems();
}

function drawFitnessLegend(
  ctx,
  cellSize,
  cols,
  rows,
  palette,
  {
    highlighted = 0,
    total = 0,
    requestedPercent = DEFAULT_FITNESS_TOP_PERCENT,
    maxFitness,
  },
) {
  const safePalette = Array.isArray(palette) ? palette.filter(Boolean) : [];

  if (!ctx || safePalette.length === 0) return;
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || !(cellSize > 0)) return;

  const padding = 10;
  const gradientHeight = 12;
  const gradientWidth = clamp(cols * cellSize * 0.22, 120, 160);
  const textLineHeight = 14;
  const requestedPercentDisplay = clamp(requestedPercent * 100, 0, 100);
  const coveragePercent =
    total > 0 ? (highlighted / total) * 100 : requestedPercentDisplay;
  const lines = [];

  if (total > 0) {
    lines.push(
      `Highlighting ${highlighted}/${total} cells (~${coveragePercent.toFixed(1)}%)`,
    );
  } else {
    lines.push("Highlighting top performers");
  }

  if (Math.abs(coveragePercent - requestedPercentDisplay) > 0.5) {
    lines.push(`Requested top ${requestedPercentDisplay.toFixed(1)}% window`);
  }

  lines.push("Palette strongest → weaker");

  if (Number.isFinite(maxFitness)) {
    lines.push(`Peak fitness ${maxFitness.toFixed(2)}`);
  }

  const blockHeight =
    gradientHeight + padding * 3 + textLineHeight * Math.max(1, lines.length);
  const blockWidth = gradientWidth + padding * 2;
  const x = cols * cellSize - blockWidth - padding;
  const y = padding;

  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(x, y, blockWidth, blockHeight);

  const gradientX = x + padding;
  const gradientY = y + padding;
  const gradient = ctx.createLinearGradient(
    gradientX,
    gradientY,
    gradientX + gradientWidth,
    gradientY,
  );
  const stopDenominator = Math.max(1, safePalette.length - 1);

  safePalette.forEach((color, index) => {
    gradient.addColorStop(index / stopDenominator, color);
  });

  ctx.fillStyle = gradient;
  ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  let textY = gradientY + gradientHeight + padding;

  for (const line of lines) {
    ctx.fillText(line, gradientX, textY);
    textY += textLineHeight;
  }

  ctx.restore();
}

// Expose the scalar heatmap painter for profiling scripts without
// promoting it to the public API surface.
export { drawScalarHeatmap as __profileDrawScalarHeatmap };
