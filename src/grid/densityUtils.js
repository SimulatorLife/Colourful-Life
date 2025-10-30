import { isArrayLike } from "../utils/collections.js";

/**
 * Retrieves a normalized density value for the given grid coordinates while
 * tolerating different snapshot representations. Grid overlays and analytics
 * frequently need density data but should not depend on the UI layer where the
 * helper previously lived. Keeping the lookup under `src/grid/` aligns it with
 * other grid-centric utilities like `energyUtils` so simulation modules can
 * reuse it without pulling in rendering code.
 *
 * @param {{
 *   getDensityAt?: (row: number, col: number) => number,
 *   densityGrid?: ArrayLike<ArrayLike<number>>,
 *   localDensity?: (row: number, col: number, radius?: number) => number,
 * }} grid - Grid snapshot or manager.
 * @param {number} row - Row index.
 * @param {number} col - Column index.
 * @returns {number} Density value in the 0..1 range when available, otherwise 0.
 */
export function getDensityAt(grid, row, col) {
  if (!grid) return 0;

  if (typeof grid.getDensityAt === "function") {
    return grid.getDensityAt(row, col);
  }

  if (isArrayLike(grid.densityGrid)) {
    const densityRow = grid.densityGrid[row];

    if (isArrayLike(densityRow) && col >= 0 && col < densityRow.length) {
      const value = densityRow[col];

      return Number.isFinite(value) ? value : 0;
    }
  }

  if (typeof grid.localDensity === "function") {
    const value = grid.localDensity(row, col, 1);

    return Number.isFinite(value) ? value : 0;
  }

  return 0;
}

export default getDensityAt;
