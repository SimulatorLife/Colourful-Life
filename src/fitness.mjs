import { MAX_TILE_ENERGY } from './config.js';

export function computeFitness(cell, maxTileEnergy) {
  const gridManager = typeof globalThis !== 'undefined' ? globalThis.GridManager : undefined;
  const maxEnergy =
    maxTileEnergy ??
    (gridManager && gridManager.maxTileEnergy != null
      ? gridManager.maxTileEnergy
      : MAX_TILE_ENERGY);

  return (
    (cell.fightsWon - cell.fightsLost) * 0.5 +
    (cell.offspring || 0) * 1.5 +
    cell.energy / maxEnergy +
    (cell.lifespan ? cell.age / cell.lifespan : 0)
  );
}
