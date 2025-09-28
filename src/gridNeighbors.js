/**
 * Iterates each neighbor within the provided radius while clamping coordinates to the grid.
 * The callback may return `false` to short-circuit remaining traversal.
 *
 * @param {number} rows
 * @param {number} cols
 * @param {number} row
 * @param {number} col
 * @param {number} radius
 * @param {(row: number, col: number) => (void | boolean)} callback
 * @param {{ includeOrigin?: boolean, reuse?: { row: number, col: number } }} [options]
 */
export function forEachNeighbor(rows, cols, row, col, radius, callback, options = {}) {
  if (!Number.isFinite(radius)) return;

  const normalizedRadius = Math.floor(radius);

  if (normalizedRadius < 0) return;

  const { includeOrigin = false, reuse } = options;
  const minRow = Math.max(0, row - normalizedRadius);
  const maxRow = Math.min(rows - 1, row + normalizedRadius);
  const minCol = Math.max(0, col - normalizedRadius);
  const maxCol = Math.min(cols - 1, col + normalizedRadius);

  const shouldReuse = reuse && typeof reuse === 'object';

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (!includeOrigin && r === row && c === col) continue;

      if (shouldReuse) {
        reuse.row = r;
        reuse.col = c;
        if (callback(reuse) === false) return;
      } else if (callback(r, c) === false) {
        return;
      }
    }
  }
}
