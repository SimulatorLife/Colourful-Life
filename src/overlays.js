import { MAX_TILE_ENERGY } from './config.js';
import { lerp } from './utils.js';

const FITNESS_TOP_PERCENT = 0.1;
const FITNESS_GRADIENT_STEPS = 5;
const FITNESS_BASE_HUE = 52;

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

export function drawEventOverlays(ctx, cellSize, activeEvents, getColor) {
  if (!ctx || !Array.isArray(activeEvents) || activeEvents.length === 0) return;

  ctx.save();
  for (const event of activeEvents) {
    if (!event || !event.affectedArea) continue;

    const { affectedArea } = event;
    const color =
      (typeof getColor === 'function' && getColor(event)) ||
      event.color ||
      'rgba(255,255,255,0.15)';

    if (!color) continue;

    ctx.fillStyle = color;
    ctx.fillRect(
      affectedArea.x * cellSize,
      affectedArea.y * cellSize,
      affectedArea.width * cellSize,
      affectedArea.height * cellSize
    );
  }
  ctx.restore();
}

function drawObstacleMask(
  grid,
  ctx,
  cellSize,
  { fill = 'rgba(40,40,55,0.35)', outline = 'rgba(200,200,255,0.35)' } = {}
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

function drawScalarHeatmap(grid, ctx, cellSize, alphaAt, color = '0,0,0') {
  const rows = grid.rows;
  const cols = grid.cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawAlpha = alphaAt(r, c);
      let a = Number.isFinite(rawAlpha) ? rawAlpha : 0;

      if (a > 1) a = 1;
      else if (a < 0) a = 0;

      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${color},${a.toFixed(3)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}

function getDensityAt(grid, r, c) {
  if (typeof grid.getDensityAt === 'function') return grid.getDensityAt(r, c);
  if (Array.isArray(grid.densityGrid)) return grid.densityGrid[r]?.[c] ?? 0;
  if (typeof grid.localDensity === 'function') return grid.localDensity(r, c, 1);

  return 0;
}

function densityToRgba(normalizedValue, { opaque = false } = {}) {
  const clampedValue = Number.isFinite(normalizedValue) ? normalizedValue : 0;
  const t = Math.min(1, Math.max(0, clampedValue));
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
  const gradientWidth = Math.min(160, Math.max(120, cols * cellSize * 0.25));
  const gradientHeight = 14;
  const padding = 10;
  const textLineHeight = 14;
  const blockWidth = gradientWidth + padding * 2;
  const blockHeight = gradientHeight + textLineHeight * 2 + padding * 3;
  const x = padding;
  const y = rows * cellSize - blockHeight - padding;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, blockWidth, blockHeight);

  const gradientX = x + padding;
  const gradientY = y + padding;

  const gradient = ctx.createLinearGradient(
    gradientX,
    gradientY,
    gradientX + gradientWidth,
    gradientY
  );
  const stops = [0, 0.25, 0.5, 0.75, 1];

  for (const stop of stops) {
    gradient.addColorStop(stop, densityToRgba(stop, { opaque: true }));
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(gradientX, gradientY, gradientWidth, gradientHeight);

  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textBaseline = 'top';

  ctx.textAlign = 'left';
  ctx.fillText(`Min: ${minDensity.toFixed(2)}`, gradientX, gradientY + gradientHeight + padding);
  ctx.fillText(
    `Max: ${maxDensity.toFixed(2)}`,
    gradientX,
    gradientY + gradientHeight + padding + textLineHeight
  );

  ctx.restore();
}

function drawSelectionZones(selectionManager, ctx, cellSize) {
  if (!selectionManager?.hasActiveZones()) return;

  const zoneEntries =
    typeof selectionManager.getActiveZoneRenderData === 'function'
      ? selectionManager.getActiveZoneRenderData()
      : null;

  if (!Array.isArray(zoneEntries) || zoneEntries.length === 0) return;

  ctx.save();
  for (const entry of zoneEntries) {
    const zone = entry?.zone;
    const geometry = entry?.geometry;

    if (!zone) continue;

    const color = zone.color || 'rgba(255,255,255,0.2)';

    if (!color) continue;

    const rects = geometry?.rects;

    if (!Array.isArray(rects) || rects.length === 0) {
      continue;
    }

    ctx.fillStyle = color;
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];

      if (!rect) continue;

      const { row, col, rowSpan = 1, colSpan = 1 } = rect;

      if (rowSpan <= 0 || colSpan <= 0) continue;

      ctx.fillRect(col * cellSize, row * cellSize, colSpan * cellSize, rowSpan * cellSize);
    }
  }
  ctx.restore();
}

export { drawSelectionZones };

export function drawOverlays(grid, ctx, cellSize, opts = {}) {
  const {
    showEnergy,
    showDensity,
    showFitness,
    showObstacles = true,
    maxTileEnergy = MAX_TILE_ENERGY,
    activeEvents,
    getEventColor,
    snapshot: providedSnapshot,
    selectionManager: explicitSelection,
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
    if (!snapshot && typeof grid?.getLastSnapshot === 'function') {
      snapshot = grid.getLastSnapshot();
    }
    drawFitnessHeatmap(snapshot, ctx, cellSize);
  }
}

export function drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy = MAX_TILE_ENERGY) {
  const scale = 0.99;

  drawScalarHeatmap(
    grid,
    ctx,
    cellSize,
    (r, c) => (grid.energyGrid[r][c] / maxTileEnergy) * scale,
    '0,255,0'
  );
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
        densityRow && Number.isFinite(densityRow[c]) ? densityRow[c] : getDensityAt(grid, r, c);
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

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

  topEntries.forEach(({ row, col }, index) => {
    const paletteIndex = Math.min(palette.length - 1, Math.floor(index / tierSize));

    ctx.fillStyle = palette[paletteIndex];
    ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
  });
}
