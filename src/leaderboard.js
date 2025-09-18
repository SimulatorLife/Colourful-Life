export function computeLeaderboard(snapshot, topN = 5) {
  const items = [];
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];

  for (const entry of entries) {
    const { cell, fitness, smoothedFitness } = entry || {};

    if (!cell || !Number.isFinite(fitness)) {
      continue;
    }

    const smoothed =
      (Number.isFinite(smoothedFitness) ? smoothedFitness : undefined) ??
      (Number.isFinite(cell?.fitnessScore) ? cell.fitnessScore : undefined) ??
      fitness;

    items.push({
      fitness,
      smoothedFitness: smoothed,
      offspring: Number.isFinite(cell?.offspring) ? cell.offspring : 0,
      fightsWon: Number.isFinite(cell?.fightsWon) ? cell.fightsWon : 0,
      age: Number.isFinite(cell?.age) ? cell.age : 0,
      color: cell?.color,
    });
  }
  items.sort((a, b) => b.smoothedFitness - a.smoothedFitness || b.fitness - a.fitness);

  return items.slice(0, topN);
}
