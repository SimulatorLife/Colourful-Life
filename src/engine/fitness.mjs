import { MAX_TILE_ENERGY } from "../config.js";

function resolveMaxTileEnergy(candidate) {
  if (Number.isFinite(candidate) && candidate > 0) {
    return candidate;
  }

  return MAX_TILE_ENERGY;
}

/**
 * Calculates the leaderboard fitness score for a cell.
 *
 * Fitness blends combat results, offspring count, relative energy, and
 * age-based survival so the leaderboard highlights organisms that thrive across
 * multiple dimensions instead of a single metric.
 *
 * @param {import('../cell.js').default} cell - Cell being evaluated.
 * @param {number} [maxTileEnergy] - Optional override for the maximum tile
 *   energy. Falls back to {@link MAX_TILE_ENERGY} when omitted.
 * @returns {number} Fitness score used by the leaderboard.
 */
export function computeFitness(cell, maxTileEnergy) {
  const maxEnergy = resolveMaxTileEnergy(maxTileEnergy);

  const fights = (cell.fightsWon - cell.fightsLost) * 0.5;
  const offspring = (cell.offspring || 0) * 1.5;
  const energyShare = maxEnergy > 0 ? cell.energy / maxEnergy : 0;
  const survival = cell.lifespan ? cell.age / cell.lifespan : 0;

  const attempts = Number.isFinite(cell.matingAttempts)
    ? Math.max(0, cell.matingAttempts)
    : 0;
  const successes = Number.isFinite(cell.matingSuccesses)
    ? Math.max(0, cell.matingSuccesses)
    : 0;
  const diversitySum = Number.isFinite(cell.diverseMateScore)
    ? Math.max(0, cell.diverseMateScore)
    : 0;
  const complementSum = Number.isFinite(cell.complementaryMateScore)
    ? Math.max(0, cell.complementaryMateScore)
    : 0;
  const penaltySum = Number.isFinite(cell.similarityPenalty)
    ? Math.max(0, cell.similarityPenalty)
    : 0;
  const monotonySum = Number.isFinite(cell.strategyPenalty)
    ? Math.max(0, cell.strategyPenalty)
    : 0;

  const successRate = attempts > 0 ? successes / attempts : 0;
  const diversityRate = successes > 0 ? diversitySum / successes : 0;
  const complementRate = successes > 0 ? complementSum / successes : 0;
  const penaltyRate = attempts > 0 ? Math.min(1, penaltySum / attempts) : 0;
  const monotonyRate = attempts > 0 ? Math.min(1, monotonySum / attempts) : 0;

  const diversityBonus = diversityRate * 1.2;
  const adaptabilityBonus = successRate * 0.4;
  const complementBonus = complementRate * (0.9 + diversityRate * 0.35);
  const similarityDrag = penaltyRate * 0.6;
  const monotonyDrag = monotonyRate * 0.4;
  const complementDrag = (1 - complementRate) * penaltyRate * 0.2;

  return (
    fights +
    offspring +
    energyShare +
    survival +
    diversityBonus +
    adaptabilityBonus +
    complementBonus -
    similarityDrag -
    monotonyDrag -
    complementDrag
  );
}
