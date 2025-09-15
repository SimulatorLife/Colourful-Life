export function computeFitness(cell) {
  const maxEnergy =
    typeof GridManager !== 'undefined' && GridManager.maxTileEnergy ? GridManager.maxTileEnergy : 1;

  return (
    (cell.fightsWon - cell.fightsLost) * 0.5 +
    (cell.offspring || 0) * 1.5 +
    cell.energy / maxEnergy +
    (cell.lifespan ? cell.age / cell.lifespan : 0)
  );
}
