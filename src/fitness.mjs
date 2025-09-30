import { MAX_TILE_ENERGY } from "./config.js";

/**
 * Calculates the leaderboard fitness score for a cell.
 *
 * Fitness blends combat results, offspring count, relative energy, and
 * age-based survival so the leaderboard highlights organisms that thrive across
 * multiple dimensions instead of a single metric.
 *
 * @param {import('./cell.js').default} cell - Cell being evaluated.
 * @param {number} [maxTileEnergy] - Optional override for the maximum tile
 *   energy. Falls back to {@link MAX_TILE_ENERGY} when omitted.
 * @returns {number} Fitness score used by the leaderboard.
 */
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
