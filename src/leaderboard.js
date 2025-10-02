import { createRankedBuffer } from "./utils.js";

function sanitizeCoordinate(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Generates a ranked leaderboard from the latest grid snapshot. The helper
 * ranks entries by their raw fitness and attaches optional brain telemetry so
 * UI panels can highlight the most successful organisms.
 *
 * @param {{entries?: Array, brainSnapshots?: Array}} snapshot - Data collected
 *   by {@link GridManager}.
 * @param {number} [topN=5] - Maximum number of entries to return.
 * @returns {Array<Object>} Ranked list sorted by raw fitness.
 */
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
    const fitnessDiff = (b?.fitness ?? Number.NaN) - (a?.fitness ?? Number.NaN);

    return Number.isNaN(fitnessDiff) ? 0 : fitnessDiff;
  };

  const brainLookup = brainSnapshots.reduce((lookup, entry) => {
    if (!entry) return lookup;

    const key = `${entry.row},${entry.col}`;

    if (!lookup.has(key)) lookup.set(key, entry);

    return lookup;
  }, new Map());

  const topItems = createRankedBuffer(sanitizedTopN, compareItems);

  for (const entry of entries) {
    const { cell, fitness } = entry || {};

    if (!cell || !Number.isFinite(fitness)) {
      continue;
    }

    const item = {
      fitness,
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
