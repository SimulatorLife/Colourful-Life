import { createRankedBuffer } from "./utils.js";

/**
 * Generates a ranked leaderboard from the latest grid snapshot. The helper
 * combines raw fitness metrics with smoothed scores and optional brain
 * telemetry so UI panels can highlight the most successful organisms.
 *
 * @param {{entries:Array,brainSnapshots:Array}} snapshot - Data collected by {@link GridManager}.
 * @param {number} [topN=5] - Maximum number of entries to return.
 * @returns {Array<Object>} Ranked list sorted by smoothed then raw fitness.
 */
function sanitizeCoordinate(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

export function computeLeaderboard(snapshot, topN = 5) {
  const numericTopN = Number(topN);
  const sanitizedTopN = Number.isFinite(numericTopN)
    ? Math.max(0, Math.floor(numericTopN))
    : 0;

  if (sanitizedTopN === 0) {
    return [];
  }

  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const brainSnapshots = Array.isArray(snapshot?.brainSnapshots)
    ? snapshot.brainSnapshots
    : [];
  const compareItems = (a, b) => {
    const smoothedDiff =
      (b?.smoothedFitness ?? Number.NaN) - (a?.smoothedFitness ?? Number.NaN);

    if (!Number.isNaN(smoothedDiff) && smoothedDiff !== 0) {
      return smoothedDiff;
    }

    const fitnessDiff = (b?.fitness ?? Number.NaN) - (a?.fitness ?? Number.NaN);

    return Number.isNaN(fitnessDiff) ? 0 : fitnessDiff;
  };

  const brainLookup = new Map();

  for (let i = 0; i < brainSnapshots.length; i++) {
    const entry = brainSnapshots[i];

    if (!entry) continue;

    const key = `${entry.row},${entry.col}`;

    if (!brainLookup.has(key)) brainLookup.set(key, entry);
  }

  const topItems = createRankedBuffer(sanitizedTopN, compareItems);

  for (const entry of entries) {
    const { cell, fitness, smoothedFitness } = entry || {};

    if (!cell || !Number.isFinite(fitness)) {
      continue;
    }

    const smoothed =
      (Number.isFinite(smoothedFitness) ? smoothedFitness : undefined) ??
      (Number.isFinite(cell?.fitnessScore) ? cell.fitnessScore : undefined) ??
      fitness;

    const item = {
      fitness,
      smoothedFitness: smoothed,
      offspring: Number.isFinite(cell?.offspring) ? cell.offspring : 0,
      fightsWon: Number.isFinite(cell?.fightsWon) ? cell.fightsWon : 0,
      age: Number.isFinite(cell?.age) ? cell.age : 0,
      color: cell?.color,
    };
    const row = sanitizeCoordinate(entry?.row);
    const col = sanitizeCoordinate(entry?.col);

    if (row !== null) item.row = row;
    if (col !== null) item.col = col;
    const key = `${entry.row},${entry.col}`;
    const brain = brainLookup.get(key);

    if (brain) {
      item.brain = brain;
    }
    topItems.add(item);
  }

  return topItems.getItems();
}
