export function forEachNeighbor(rows, cols, row, col, radius, callback, includeOrigin = false) {
  if (radius < 0) return;
  const minRow = row - radius < 0 ? 0 : row - radius;
  const maxRow = row + radius >= rows ? rows - 1 : row + radius;
  const minCol = col - radius < 0 ? 0 : col - radius;
  const maxCol = col + radius >= cols ? cols - 1 : col + radius;

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (!includeOrigin && r === row && c === col) continue;

      callback(r, c);
    }
  }
}
