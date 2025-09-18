export function computeLeaderboard(snapshot, topN = 5) {
  const source = snapshot || {};
  const items = [];

  for (const { cell, fitness, smoothedFitness } of source.entries || []) {
    const smoothed =
      smoothedFitness ??
      (Number.isFinite(cell?.fitnessScore) ? cell.fitnessScore : undefined) ??
      fitness;

    items.push({
      fitness,
      smoothedFitness: smoothed,
      offspring: cell.offspring || 0,
      fightsWon: cell.fightsWon || 0,
      age: cell.age,
      color: cell.color,
    });
  }
  items.sort((a, b) => b.smoothedFitness - a.smoothedFitness || b.fitness - a.fitness);

  return items.slice(0, topN);
}
