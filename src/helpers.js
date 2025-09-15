export const DENSITY_RADIUS = 1; // Moore neighborhood radius for density calc

export const lerp = (a, b, t) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);

export function tryMove(gridArr, sr, sc, dr, dc, rows, cols) {
  const nr = (sr + dr + rows) % rows;
  const nc = (sc + dc + cols) % cols;
  const dcell = gridArr[nr][nc];

  if (!dcell) {
    gridArr[nr][nc] = gridArr[sr][sc];
    gridArr[sr][sc] = null;

    return true;
  }

  return false;
}

export function moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
  const dRow = targetRow - row;
  const dCol = targetCol - col;
  let dr = 0,
    dc = 0;

  if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
  else dc = Math.sign(dCol);

  return tryMove(gridArr, row, col, dr, dc, rows, cols);
}

export function moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
  const dRow = targetRow - row;
  const dCol = targetCol - col;
  let dr = 0,
    dc = 0;

  if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
  else dc = -Math.sign(dCol);

  return tryMove(gridArr, row, col, dr, dc, rows, cols);
}

export function moveRandomly(gridArr, row, col, cell, rows, cols) {
  const { dr, dc } = cell.decideMove();

  return tryMove(gridArr, row, col, dr, dc, rows, cols);
}
