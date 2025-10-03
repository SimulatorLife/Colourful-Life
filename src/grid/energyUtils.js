export function clearTileEnergyBuffers(source, row, col) {
  if (!source || row == null || col == null) return;

  const normalizedRow = Number.isInteger(row) ? row : Math.floor(row);
  const normalizedCol = Number.isInteger(col) ? col : Math.floor(col);

  if (normalizedRow < 0 || normalizedCol < 0) return;

  const { energyGrid, energyNext, energyDeltaGrid } = source;

  if (Array.isArray(energyGrid)) {
    const energyRow = energyGrid[normalizedRow];

    if (Array.isArray(energyRow) && normalizedCol < energyRow.length) {
      energyRow[normalizedCol] = 0;
    }
  }

  if (Array.isArray(energyNext)) {
    const nextRow = energyNext[normalizedRow];

    if (Array.isArray(nextRow) && normalizedCol < nextRow.length) {
      nextRow[normalizedCol] = 0;
    }
  }

  if (Array.isArray(energyDeltaGrid)) {
    const deltaRow = energyDeltaGrid[normalizedRow];

    if (Array.isArray(deltaRow) && normalizedCol < deltaRow.length) {
      deltaRow[normalizedCol] = 0;
    }
  }
}
