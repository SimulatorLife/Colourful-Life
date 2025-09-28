export function forEachNeighbor(
  row,
  col,
  radius,
  rows,
  cols,
  callback,
  { includeOrigin = false } = {}
) {
  if (typeof callback !== 'function') return;
  if (!Number.isFinite(rows) || !Number.isFinite(cols)) return;

  const normalizedRadius = Math.max(0, Math.floor(radius ?? 0));

  if (normalizedRadius === 0) {
    if (includeOrigin && row >= 0 && row < rows && col >= 0 && col < cols) {
      callback(row, col);
    }

    return true;
  }

  const minRow = Math.max(0, Math.floor(row - normalizedRadius));
  const maxRow = Math.min(rows - 1, Math.floor(row + normalizedRadius));
  const minCol = Math.max(0, Math.floor(col - normalizedRadius));
  const maxCol = Math.min(cols - 1, Math.floor(col + normalizedRadius));

  for (let rr = minRow; rr <= maxRow; rr += 1) {
    for (let cc = minCol; cc <= maxCol; cc += 1) {
      if (!includeOrigin && rr === row && cc === col) continue;

      if (callback(rr, cc) === false) {
        return false;
      }
    }
  }

  return true;
}
