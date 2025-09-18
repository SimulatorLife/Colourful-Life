export function computeLeaderboard(snapshot, topN = 5) {
  const source = snapshot || {};
  const items = [];

  for (const { cell, fitness } of source.entries || []) {
    items.push({
      fitness,
      offspring: cell.offspring || 0,
      fightsWon: cell.fightsWon || 0,
      age: cell.age,
      color: cell.color,
    });
  }
  items.sort((a, b) => b.fitness - a.fitness);

  return items.slice(0, topN);
}
