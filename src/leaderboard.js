import { createRankedBuffer, sanitizeNumber } from "./utils.js";

function sanitizeCoordinate(value) {
  return sanitizeNumber(value, { fallback: null });
}

function resolveStatValue(primary, secondary, fallback = 0) {
  if (Number.isFinite(primary)) {
    return primary;
  }

  if (Number.isFinite(secondary)) {
    return secondary;
  }

  return fallback;
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
  const sanitizedTopN = sanitizeNumber(topN, {
    fallback: 0,
    min: 0,
    round: Math.floor,
  });

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
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const { cell, fitness } = entry;

    if (!Number.isFinite(fitness)) {
      continue;
    }

    const colorCandidate = entry.color ?? cell?.color;

    const item = {
      fitness,
      offspring: resolveStatValue(entry?.offspring, cell?.offspring),
      fightsWon: resolveStatValue(entry?.fightsWon, cell?.fightsWon),
      age: resolveStatValue(entry?.age, cell?.age),
      color: colorCandidate,
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
