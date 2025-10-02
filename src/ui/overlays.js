import { MAX_TILE_ENERGY } from "../config.js";
import { clamp, clamp01, lerp, warnOnce } from "../utils.js";

const FITNESS_TOP_PERCENT = 0.1;
const FITNESS_GRADIENT_STEPS = 5;
const FITNESS_BASE_HUE = 52;
const DEFAULT_CELEBRATION_PALETTE = Object.freeze([
  { rgb: [255, 214, 137] },
  { rgb: [172, 210, 255] },
  { rgb: [255, 176, 208] },
  { rgb: [198, 255, 214] },
]);
const MAX_CELEBRATION_HIGHLIGHTS = 4;

function toCelebrationColor(rgb, alpha) {
  if (!Array.isArray(rgb) || rgb.length < 3) return "rgba(255,255,255,0)";

  const [r, g, b] = rgb;
  const clamped = clamp01(Number.isFinite(alpha) ? alpha : 0);

  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${clamped.toFixed(3)})`;
}

function selectCelebrationHighlights(entries, limit = MAX_CELEBRATION_HIGHLIGHTS) {
  if (!Array.isArray(entries) || entries.length === 0) return [];

  const capped = Math.max(0, Math.min(limit, MAX_CELEBRATION_HIGHLIGHTS));

  if (capped === 0) return [];

  const highlights = [];

  for (const entry of entries) {
    if (!entry) continue;

    const value = Number.isFinite(entry.fitness)
      ? entry.fitness
      : Number.NEGATIVE_INFINITY;

    if (!Number.isFinite(value)) continue;

    const candidate = { entry, score: value };
    let inserted = false;

    for (let i = 0; i < highlights.length; i++) {
      if (value > highlights[i].score) {
        highlights.splice(i, 0, candidate);
        inserted = true;
        break;
      }
    }

    if (!inserted && highlights.length < capped) {
      highlights.push(candidate);
      inserted = true;
    }

    if (inserted && highlights.length > capped) {
      highlights.length = capped;
    }
  }

  return highlights.map((item) => item.entry);
}

export function drawCelebrationAuras(snapshot, ctx, cellSize, options = {}) {
  if (!snapshot || !ctx || typeof ctx.createRadialGradient !== "function") return;
  if (!(cellSize > 0)) return;

  const entries = Array.isArray(snapshot.entries)
    ? snapshot.entries
    : Array.isArray(snapshot.cells)
      ? snapshot.cells
      : null;

  if (!entries || entries.length === 0) return;

  const palette =
    Array.isArray(options.palette) && options.palette.length > 0
      ? options.palette
      : DEFAULT_CELEBRATION_PALETTE;
  const limit = Math.max(
    0,
    Math.min(
      Number.isFinite(options.maxHighlights) ? options.maxHighlights : palette.length,
      palette.length,
      MAX_CELEBRATION_HIGHLIGHTS,
    ),
  );

  if (limit === 0) return;

  const highlights = selectCelebrationHighlights(entries, limit);

  if (highlights.length === 0) return;

  let maxFitness = Number.isFinite(snapshot.maxFitness) ? snapshot.maxFitness : 0;

  if (!(maxFitness > 0)) {
    for (const entry of highlights) {
      const candidate = Number.isFinite(entry?.fitness) ? entry.fitness : 0;

      if (candidate > maxFitness) maxFitness = candidate;
    }
  }

  maxFitness = maxFitness > 0 ? maxFitness : 1;

  ctx.save();

  for (let i = 0; i < highlights.length; i++) {
    const entry = highlights[i];

    if (!entry) continue;

    const { row, col } = entry;

    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;

    const x = (col + 0.5) * cellSize;
    const y = (row + 0.5) * cellSize;
    const rawScore = Number.isFinite(entry.fitness) ? entry.fitness : 0;
    const normalized = clamp01(rawScore / maxFitness);
    const paletteEntry = palette[i % palette.length];
    const rgb = Array.isArray(paletteEntry?.rgb)
      ? paletteEntry.rgb
      : Array.isArray(paletteEntry)
        ? paletteEntry
        : null;

    if (!rgb) continue;

    const outerRadius = Math.min(cellSize * (2.2 + normalized * 3.4), cellSize * 6.5);
    const innerRadius = Math.max(cellSize * 0.4, outerRadius * 0.2);
    const gradient = ctx.createRadialGradient(x, y, innerRadius, x, y, outerRadius);
    const baseAlpha = 0.22 + normalized * 0.4;

    gradient.addColorStop(0, toCelebrationColor(rgb, Math.min(0.8, baseAlpha + 0.18)));
    gradient.addColorStop(0.5, toCelebrationColor(rgb, Math.min(0.55, baseAlpha)));
    gradient.addColorStop(1, toCelebrationColor(rgb, 0));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
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
 * Paints translucent rectangles for each active environmental event. Colour
 * resolution is delegated to the supplied callback so custom palettes can be
 * injected by UI extensions.
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas context receiving the draw calls.
 * @param {number} cellSize - Width/height of a single grid cell in pixels.
 * @param {Array} activeEvents - Events with `affectedArea` rectangles to render.
 * @param {(event: object) => string} [getColor] - Optional colour resolver invoked per event.
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
 * Resolves the local density value for a given tile by consulting whichever
 * API the grid exposes. GridManager provides `getDensityAt`, but tests and
 * headless consumers may only surface `densityGrid` or `localDensity`.
 *
 * @param {object} grid - Grid-like object returned by `GridManager`.
 * @param {number} r - Row index to inspect.
 * @param {number} c - Column index to inspect.
 * @returns {number} Normalized density value for the tile.
 */
export function getDensityAt(grid, r, c) {
  if (typeof grid.getDensityAt === "function") return grid.getDensityAt(r, c);
  if (Array.isArray(grid.densityGrid)) return grid.densityGrid[r]?.[c] ?? 0;
  if (typeof grid.localDensity === "function") return grid.localDensity(r, c, 1);

  return 0;
}

/**
 * Maps a normalized density value (0..1) to an RGBA colour along a perceptually
 * smooth gradient used by the density heatmap and legend.
 *
 * @param {number} normalizedValue - Density value in the 0..1 range.
 * @param {{opaque?: boolean}} [options] - When `opaque` is true the alpha channel is set to 1.
 * @returns {string} CSS rgba() string representing the density colour.
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
 * Fills active reproduction zones using cached geometry supplied by the
 * selection manager. Zones are rendered on top of the canvas to mirror UI state
 * in the visual overlays.
 *
 * @param {import('../ui/selectionManager.js').default|undefined} selectionManager - Active selection manager.
 * @param {CanvasRenderingContext2D} ctx - Canvas context used for drawing.
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
 * Master overlay renderer invoked by {@link SimulationEngine}. It orchestrates
 * event shading, reproduction zones, obstacle masks, and heatmaps depending on
 * the flags provided by UI controls.
 *
 * @param {object} grid - Grid manager exposing obstacle, energy, and density data.
 * @param {CanvasRenderingContext2D} ctx - Canvas context receiving the draw calls.
 * @param {number} cellSize - Width/height of each cell in pixels.
 * @param {object} [opts] - Overlay options and data dependencies.
 */
export function drawOverlays(grid, ctx, cellSize, opts = {}) {
  const {
    showEnergy,
    showDensity,
    showFitness,
    showCelebrationAuras,
    showObstacles = true,
    maxTileEnergy = MAX_TILE_ENERGY,
    activeEvents,
    getEventColor,
    snapshot: providedSnapshot,
    selectionManager: explicitSelection,
    celebrationAurasOptions,
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
  if (showFitness || showCelebrationAuras) {
    if (!snapshot && typeof grid?.getLastSnapshot === "function") {
      snapshot = grid.getLastSnapshot();
    }
  }
  if (showFitness) {
    drawFitnessHeatmap(snapshot, ctx, cellSize);
  }
  if (showCelebrationAuras) {
    drawCelebrationAuras(snapshot, ctx, cellSize, celebrationAurasOptions);
  }
}

/**
 * Renders a green energy heatmap layer plus summary legend showing minimum,
 * maximum, and mean tile energy.
 *
 * @param {object} grid - Grid-like object exposing `energyGrid`, `rows`, and `cols`.
 * @param {CanvasRenderingContext2D} ctx - Canvas context receiving the draw calls.
 * @param {number} cellSize - Width/height of each cell in pixels.
 * @param {number} [maxTileEnergy=MAX_TILE_ENERGY] - Energy cap used to normalize colours.
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
 * Visualizes population density across the grid using a blue→red gradient and
 * accompanying legend so observers can contextualize numeric extremes.
 *
 * @param {object} grid - Grid-like object exposing `rows`, `cols`, and density helpers.
 * @param {CanvasRenderingContext2D} ctx - Canvas context receiving the draw calls.
 * @param {number} cellSize - Width/height of each cell in pixels.
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
 * Highlights the top performers from a leaderboard snapshot by tinting their
 * grid cells using a warm palette. Lower performers are ignored to keep the
 * overlay legible.
 *
 * @param {{rows:number, cols:number, entries:Array, maxFitness:number}} snapshot - Latest leaderboard snapshot.
 * @param {CanvasRenderingContext2D} ctx - Canvas context receiving the draw calls.
 * @param {number} cellSize - Width/height of a single grid cell in pixels.
 */
export function drawFitnessHeatmap(snapshot, ctx, cellSize) {
  if (!snapshot || snapshot.maxFitness <= 0) return;

  const { rows, cols } = snapshot;
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];

  if (!entries.length) return;

  const sortedEntries = [...entries].sort((a, b) => b.fitness - a.fitness);
  const keepCount = Math.max(1, Math.floor(sortedEntries.length * FITNESS_TOP_PERCENT));
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
