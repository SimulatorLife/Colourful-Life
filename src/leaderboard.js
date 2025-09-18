export function computeLeaderboard(snapshot, topN = 5) {
  const source = snapshot || {};
  const topItems = [];

  const compareItems = (a, b) => {
    const smoothedDiff = (b?.smoothedFitness ?? Number.NaN) - (a?.smoothedFitness ?? Number.NaN);

    if (!Number.isNaN(smoothedDiff) && smoothedDiff !== 0) {
      return smoothedDiff;
    }

    const fitnessDiff = (b?.fitness ?? Number.NaN) - (a?.fitness ?? Number.NaN);

    return Number.isNaN(fitnessDiff) ? 0 : fitnessDiff;
  };

  for (const { cell, fitness, smoothedFitness } of source.entries || []) {
    const smoothed =
      smoothedFitness ??
      (Number.isFinite(cell?.fitnessScore) ? cell.fitnessScore : undefined) ??
      fitness;

    const item = {
      fitness,
      smoothedFitness: smoothed,
      offspring: cell.offspring || 0,
      fightsWon: cell.fightsWon || 0,
      age: cell.age,
      color: cell.color,
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

    if (topItems.length > topN) {
      topItems.length = topN;
    }
  }

  return topItems;
}
