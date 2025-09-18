export function computeLeaderboard(snapshot, topN = 5) {
  const source = snapshot || {};
  const numericTopN = Number(topN);
  const sanitizedTopN = Number.isFinite(numericTopN) ? Math.max(0, Math.floor(numericTopN)) : 0;

  if (sanitizedTopN === 0) {
    return [];
  }

  const topItems = [];

  const compareItems = (a, b) => {
    const smoothedDiff = (b?.smoothedFitness ?? Number.NaN) - (a?.smoothedFitness ?? Number.NaN);

    if (!Number.isNaN(smoothedDiff) && smoothedDiff !== 0) {
      return smoothedDiff;
    }

    const fitnessDiff = (b?.fitness ?? Number.NaN) - (a?.fitness ?? Number.NaN);

    return Number.isNaN(fitnessDiff) ? 0 : fitnessDiff;
  };

  for (const entry of source.entries || []) {
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

    let inserted = false;

    for (let index = 0; index < topItems.length; index += 1) {
      if (compareItems(item, topItems[index]) < 0) {
        topItems.splice(index, 0, item);
        inserted = true;
        break;
      }
    }

    if (!inserted) {
      topItems.push(item);
    }

    if (topItems.length > sanitizedTopN) {
      topItems.length = sanitizedTopN;
    }
  }

  return topItems;
}
