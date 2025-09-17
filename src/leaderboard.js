import { computeFitness } from './fitness.js';
import { getDefaultMaxTileEnergy } from './config.js';

export function computeLeaderboard(grid, topN = 5, maxTileEnergy = getDefaultMaxTileEnergy()) {
  const rows = grid.rows;
  const cols = grid.cols;
  const items = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = grid.getCell(r, c);

      if (!cell) continue;
      const fitness = computeFitness(cell, maxTileEnergy);

      items.push({
        fitness,
        offspring: cell.offspring || 0,
        fightsWon: cell.fightsWon || 0,
        age: cell.age,
        color: cell.color,
      });
    }
  }
  items.sort((a, b) => b.fitness - a.fitness);

  return items.slice(0, topN);
}
