import { computeFitness } from './fitness.js';

export function drawOverlays(grid, ctx, cellSize, opts = {}) {
  const { showEnergy, showDensity, showFitness, maxTileEnergy = 5 } = opts;

  if (showEnergy) drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy);
  if (showDensity) drawDensityHeatmap(grid, ctx, cellSize);
  if (showFitness) drawFitnessHeatmap(grid, ctx, cellSize, maxTileEnergy);
}

export function drawEnergyHeatmap(grid, ctx, cellSize, maxTileEnergy = 5) {
  const rows = grid.rows;
  const cols = grid.cols;
  const a = 0.99;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = grid.energyGrid[r][c] / maxTileEnergy;

      if (e <= 0) continue;
      ctx.fillStyle = `rgba(0,255,0,${(e * a).toFixed(3)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}

export function drawDensityHeatmap(grid, ctx, cellSize) {
  const rows = grid.rows;
  const cols = grid.cols;
  const a = 0.35;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = grid.localDensity(r, c, 1);

      if (d <= 0) continue;
      ctx.fillStyle = `rgba(255,0,0,${(d * a).toFixed(3)})`;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
}

export function drawFitnessHeatmap(grid, ctx, cellSize, maxTileEnergy = 5) {
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
