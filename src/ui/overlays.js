import { MAX_TILE_ENERGY } from "../config.js";
import { clamp, clamp01, lerp, toPlainObject, warnOnce } from "../utils.js";

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

function resolveLifeEventColor(event, overridesInput) {
  const candidateColors = [event?.highlight?.color, event?.color];
  const overrides = toPlainObject(overridesInput);

  const typeOverride = overrides[event?.type];
  const fallbackOverride = overrides.default ?? overrides.fallback ?? overrides.other;

  if (typeof typeOverride === "string" && typeOverride.length > 0) {
    candidateColors.push(typeOverride);
  }

  if (
    typeof fallbackOverride === "string" &&
    fallbackOverride.length > 0 &&
    fallbackOverride !== typeOverride
  ) {
    candidateColors.push(fallbackOverride);
  }

  candidateColors.push(LIFE_EVENT_MARKER_DEFAULT_COLORS[event?.type]);
  candidateColors.push(LIFE_EVENT_MARKER_DEFAULT_COLORS.birth);

  return (
    candidateColors.find(
      (candidate) => typeof candidate === "string" && candidate.length > 0,
    ) ?? LIFE_EVENT_MARKER_DEFAULT_COLORS.birth
  );
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

    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(radius * 0.45, 1), 0, Math.PI * 2);
    if (typeof ctx.fill === "function") {
      ctx.fillStyle = color;
      ctx.fill();
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
export function drawLifeEventMarkers(ctx, cellSize, events, options = {}) {
  if (!ctx || !(cellSize > 0)) return;
  if (!Array.isArray(events) || events.length === 0) return;

  const maxCount = Math.max(
    0,
    Math.floor(options.limit ?? LIFE_EVENT_MARKER_MAX_COUNT),
  );

  if (maxCount === 0) return;

  const currentTick = Number.isFinite(options.currentTick) ? options.currentTick : null;
  const fadeWindow = Number.isFinite(options.fadeTicks)
    ? Math.max(1, options.fadeTicks)
    : LIFE_EVENT_MARKER_FADE_TICKS;
  const markerRadius = Math.max(cellSize * 0.42, cellSize * 0.24);
  const strokeWidth = Math.max(cellSize * 0.18, 1.25);
  let rendered = 0;

  if (typeof ctx.save === "function") ctx.save();

  if (ctx.lineJoin !== undefined) ctx.lineJoin = "round";
  if (ctx.lineCap !== undefined) ctx.lineCap = "round";

  const previousLineWidth = ctx.lineWidth;

  if (ctx.lineWidth !== undefined) ctx.lineWidth = strokeWidth;

  for (let i = 0; i < events.length && rendered < maxCount; i++) {
    const event = events[i];

    if (!event) continue;

    const row = Number(event.row);
    const col = Number(event.col);

    if (!Number.isFinite(row) || !Number.isFinite(col)) {
      continue;
    }

    const tick = Number(event.tick);

    if (currentTick != null && Number.isFinite(tick)) {
      const age = currentTick - tick;

      if (age < 0) {
        continue;
      }

      if (age > fadeWindow) {
        continue;
      }

      const alpha = computeLifeEventAlpha(age, { maxAge: fadeWindow });

      if (ctx.globalAlpha !== undefined) {
        ctx.globalAlpha = clamp(alpha, 0, 1);
      }
    } else if (ctx.globalAlpha !== undefined) {
      ctx.globalAlpha = LIFE_EVENT_MARKER_MAX_ALPHA;
    }

    const color = resolveLifeEventColor(event, options.colors);
    const centerX = (col + 0.5) * cellSize;
    const centerY = (row + 0.5) * cellSize;

    if (event.type === "death") {
      drawDeathMarker(ctx, centerX, centerY, markerRadius, color);
    } else {
      drawBirthMarker(ctx, centerX, centerY, markerRadius, color);
    }

    rendered++;
  }

  if (ctx.globalAlpha !== undefined) {
    ctx.globalAlpha = 1;
  }
  if (ctx.lineWidth !== undefined && Number.isFinite(previousLineWidth)) {
    ctx.lineWidth = previousLineWidth;
  }
  if (typeof ctx.restore === "function") ctx.restore();
}

function createFitnessPalette(steps, hue) {
  const palette = [];
  const minLightness = 32;
  const maxLightness = 82;
  const saturation = 88;

  if (steps <= 1) {
    const midLightness = (minLightness + maxLightness) / 2;

    return [`hsl(${hue}, ${saturation}%, ${midLightness.toFixed(1)}%)`];
  }

  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const lightness = maxLightness - (maxLightness - minLightness) * t;

    palette.push(`hsl(${hue}, ${saturation}%, ${lightness.toFixed(1)}%)`);
  }

  return palette;
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
export function drawEventOverlays(ctx, cellSize, activeEvents, getColor) {
  if (!ctx || !Array.isArray(activeEvents) || activeEvents.length === 0) return;

  ctx.save();
  for (const event of activeEvents) {
    if (!event || !event.affectedArea) continue;

    const { affectedArea } = event;
    let color = event.color || "rgba(255,255,255,0.15)";

    if (typeof getColor === "function") {
      try {
        const resolved = getColor(event);

        if (typeof resolved === "string" && resolved.length > 0) {
          color = resolved;
        }
      } catch (error) {
        warnOnce("Failed to resolve event overlay color; using fallback.", error);
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
  { fill = "rgba(40,40,55,0.35)", outline = "rgba(200,200,255,0.35)" } = {},
) {
  const mask = grid?.obstacles;

  if (!Array.isArray(mask)) return;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(1, cellSize * 0.12);
  const rows = grid.rows || mask.length;
  const cols = grid.cols || (mask[0]?.length ?? 0);

  for (let r = 0; r < rows; r++) {
    const rowMask = mask[r];

    if (!rowMask) continue;
    for (let c = 0; c < cols; c++) {
      if (!rowMask[c]) continue;
      const x = c * cellSize;
      const y = r * cellSize;

      ctx.fillRect(x, y, cellSize, cellSize);
      ctx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
    }
  }
  ctx.restore();
}

function formatAlpha(alpha) {
  if (!(alpha > 0)) return "0";
  if (alpha >= 1) return "1";

  const safeAlpha = alpha < 0.001 ? 0.001 : alpha;
  const formatted = safeAlpha.toFixed(3);

  return formatted === "1.000" ? "1" : formatted;
}

function drawScalarHeatmap(grid, ctx, cellSize, alphaAt, color = "0,0,0") {
  const rows = grid.rows;
  const cols = grid.cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawAlpha = alphaAt(r, c);
      const alpha = clamp01(Number.isFinite(rawAlpha) ? rawAlpha : 0);

      if (alpha <= 0) continue;
      ctx.fillStyle = `rgba(${color},${formatAlpha(alpha)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
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
      const value = clamp(Number.isFinite(rawEnergy) ? rawEnergy : 0, 0, maxTileEnergy);

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
  ctx.fillStyle = "rgba(0,0,0,0.55)";
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
 * Reads the normalized density value for the supplied coordinates.
 *
 * @param {{density?: Array<Array<number>>}} grid - Grid snapshot.
 * @param {number} r - Row index.
 * @param {number} c - Column index.
 * @returns {number} Density value in the 0..1 range.
 */
export function getDensityAt(grid, r, c) {
  if (typeof grid.getDensityAt === "function") return grid.getDensityAt(r, c);
  if (Array.isArray(grid.densityGrid)) return grid.densityGrid[r]?.[c] ?? 0;
  if (typeof grid.localDensity === "function") return grid.localDensity(r, c, 1);

  return 0;
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
  const clampedValue = Number.isFinite(normalizedValue) ? normalizedValue : 0;
  const t = clamp01(clampedValue);
  const stops = [
    { t: 0, color: [59, 76, 192] },
    { t: 0.5, color: [221, 244, 255] },
    { t: 1, color: [220, 36, 31] },
  ];

  let start = stops[0];
  let end = stops[stops.length - 1];

  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      start = stops[i - 1];
      end = stops[i];
      break;
    }
  }

  const segmentSpan = end.t - start.t || 1;
  const localT = (t - start.t) / segmentSpan;
  const r = Math.round(lerp(start.color[0], end.color[0], localT));
  const g = Math.round(lerp(start.color[1], end.color[1], localT));
  const b = Math.round(lerp(start.color[2], end.color[2], localT));
  const alpha = opaque ? 1 : 0.18 + 0.65 * t;

  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

function drawDensityLegend(ctx, cellSize, cols, rows, minDensity, maxDensity) {
  const gradientWidth = clamp(cols * cellSize * 0.25, 120, 160);
  const gradientHeight = 14;
  const padding = 10;
  const textLineHeight = 14;
  const blockWidth = gradientWidth + padding * 2;
  const blockHeight = gradientHeight + textLineHeight * 2 + padding * 3;
  const x = padding;
  const y = rows * cellSize - blockHeight - padding;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
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
  ctx.fillText(
    `Min: ${minDensity.toFixed(2)}`,
    gradientX,
    gradientY + gradientHeight + padding,
  );
  ctx.fillText(
    `Max: ${maxDensity.toFixed(2)}`,
    gradientX,
    gradientY + gradientHeight + padding + textLineHeight,
  );

  ctx.restore();
}

function hasActiveSelectionZones(selectionManager) {
  if (!selectionManager || typeof selectionManager.hasActiveZones !== "function") {
    return false;
  }

  try {
    return Boolean(selectionManager.hasActiveZones());
  } catch (error) {
    warnOnce("Selection manager failed during active zone check.", error);

    return false;
  }
}

function getSelectionZoneEntries(selectionManager) {
  if (
    !selectionManager ||
    typeof selectionManager.getActiveZoneRenderData !== "function"
  ) {
    return [];
  }

  try {
    const entries = selectionManager.getActiveZoneRenderData();

    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    warnOnce("Selection manager failed while resolving zone geometry.", error);

    return [];
  }
}

/**
 * Outlines active reproduction zones supplied by the selection manager.
 *
 * @param {import('../grid/selectionManager.js').default} selectionManager
 *   - Selection manager instance controlling mating zones.
 * @param {CanvasRenderingContext2D} ctx - Rendering context.
 * @param {number} cellSize - Size of a single grid cell in pixels.
 */
export function drawSelectionZones(selectionManager, ctx, cellSize) {
  if (!hasActiveSelectionZones(selectionManager)) return;

  const zoneEntries = getSelectionZoneEntries(selectionManager);

  if (zoneEntries.length === 0) return;

  ctx.save();
  for (const entry of zoneEntries) {
    const zone = entry?.zone;
    const geometry = entry?.geometry;

    if (!zone) continue;

    const color = zone.color || "rgba(255,255,255,0.2)";

    if (!color) continue;

    const rects = Array.isArray(geometry?.rects) ? geometry.rects : null;

    if (!rects || rects.length === 0) {
      continue;
    }

    ctx.fillStyle = color;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];

      if (!rect) continue;

      const { row, col, rowSpan = 1, colSpan = 1 } = rect;

      if (rowSpan <= 0 || colSpan <= 0) continue;

      ctx.fillRect(
        col * cellSize,
        row * cellSize,
        colSpan * cellSize,
        rowSpan * cellSize,
      );
    }
  }
  ctx.restore();
}

/**
 * High-level overlay renderer orchestrating density, energy, fitness, event,
 * and selection layers.
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
    showFitness,
    showLifeEventMarkers,
    showObstacles = true,
    maxTileEnergy = MAX_TILE_ENERGY,
    activeEvents,
    getEventColor,
    snapshot: providedSnapshot,
    selectionManager: explicitSelection,
    fitnessOverlayOptions,
    lifeEvents,
    currentTick: lifeEventCurrentTick,
    lifeEventFadeTicks,
    lifeEventLimit,
  } = opts;
  let snapshot = providedSnapshot;
  const selectionManager = explicitSelection || grid?.selectionManager;

  if (Array.isArray(activeEvents) && activeEvents.length > 0) {
    drawEventOverlays(ctx, cellSize, activeEvents, getEventColor);
  }

  if (selectionManager) {
    drawSelectionZones(selectionManager, ctx, cellSize);
  }
  if (showObstacles) drawObstacleMask(grid, ctx, cellSize);

  if (showEnergy) drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy);
  if (showDensity) drawDensityHeatmap(grid, ctx, cellSize);
  if (showFitness) {
    if (!snapshot && typeof grid?.getLastSnapshot === "function") {
      snapshot = grid.getLastSnapshot();
    }
  }
  if (showFitness) {
    drawFitnessHeatmap(snapshot, ctx, cellSize, fitnessOverlayOptions);
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
 */
export function drawEnergyHeatmap(
  grid,
  ctx,
  cellSize,
  maxTileEnergy = MAX_TILE_ENERGY,
) {
  if (!grid || !Array.isArray(grid.energyGrid) || !grid.rows || !grid.cols) return;

  const scale = 0.99;
  const stats = computeEnergyStats(grid, maxTileEnergy);

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

      if (density < minDensity) minDensity = density;
      if (density > maxDensity) maxDensity = density;
    }
  }

  if (!Number.isFinite(minDensity) || !Number.isFinite(maxDensity)) return;

  const originalMin = minDensity;
  const originalMax = maxDensity;
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

  drawDensityLegend(ctx, cellSize, cols, rows, originalMin, originalMax);
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

  const sortedEntries = [...entries].sort((a, b) => b.fitness - a.fitness);
  const topPercentCandidate = Number.isFinite(options.topPercent)
    ? clamp(options.topPercent, 0, 1)
    : DEFAULT_FITNESS_TOP_PERCENT;
  const keepCount = Math.max(1, Math.floor(sortedEntries.length * topPercentCandidate));
  const topEntries = sortedEntries.slice(0, keepCount);
  const palette = createFitnessPalette(FITNESS_GRADIENT_STEPS, FITNESS_BASE_HUE);
  const tierSize = Math.max(1, Math.ceil(topEntries.length / palette.length));

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

  topEntries.forEach(({ row, col }, index) => {
    const paletteIndex = Math.min(palette.length - 1, Math.floor(index / tierSize));

    ctx.fillStyle = palette[paletteIndex];
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
  });
}
