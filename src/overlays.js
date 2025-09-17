import { computeFitness } from './fitness.js';
import { getDefaultMaxTileEnergy } from './config.js';

function drawScalarHeatmap(grid, ctx, cellSize, alphaAt, color = '0,0,0') {
  const rows = grid.rows;
  const cols = grid.cols;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = alphaAt(r, c);

      if (a <= 0) continue;
      ctx.fillStyle = `rgba(${color},${a.toFixed(3)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}

export function drawOverlays(grid, ctx, cellSize, opts = {}) {
  const { showEnergy, showDensity, showFitness, maxTileEnergy = getDefaultMaxTileEnergy() } = opts;

  if (showEnergy) drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy);
  if (showDensity) drawDensityHeatmap(grid, ctx, cellSize);
  if (showFitness) drawFitnessHeatmap(grid, ctx, cellSize, maxTileEnergy);
}

export function drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy = getDefaultMaxTileEnergy()) {
  const scale = 0.99;

  drawScalarHeatmap(
    grid,
    ctx,
    cellSize,
    (r, c) => (grid.energyGrid[r][c] / maxTileEnergy) * scale,
    '0,255,0'
  );
}

export function drawDensityHeatmap(grid, ctx, cellSize) {
  const scale = 0.35;

  drawScalarHeatmap(
    grid,
    ctx,
    cellSize,
    (r, c) =>
      (typeof grid.getDensityAt === 'function'
        ? grid.getDensityAt(r, c)
        : grid.localDensity(r, c, 1)) * scale,
    '255,0,0'
  );
}

export function drawFitnessHeatmap(grid, ctx, cellSize, maxTileEnergy = getDefaultMaxTileEnergy()) {
  const rows = grid.rows;
  const cols = grid.cols;
  let maxF = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.getCell(r, c);

      if (!cell) continue;
      const f = computeFitness(cell, maxTileEnergy);

      if (f > maxF) maxF = f;
    }
  }
  if (maxF <= 0) return;

  // Dim the scene so top performers pop
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(0, 0, cols * cellSize, rows * cellSize);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.getCell(r, c);

      if (!cell) continue;
      const f = computeFitness(cell, maxTileEnergy);
      const t = f / maxF;
      const a = (t * 0.45).toFixed(3);

      ctx.fillStyle = `rgba(255,255,0,${a})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}
