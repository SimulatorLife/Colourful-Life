import { isArrayLike } from "../utils/collections.js";

/**
 * Zeros out the staged energy buffers for a specific tile so downstream
 * diffusion/regen math can treat the location as freshly vacated.
 *
 * The helper normalizes indices, short-circuits when coordinates fall outside
 * the grid, tolerates partially initialised buffers, and optionally preserves
 * the currently rendered energy level while still clearing future-step
 * buffers. Callers typically invoke this immediately after a cell dies or an
 * obstacle is placed so stale energy does not leak back in on the following
 * tick.
 *
 * @param {{
 *   energyGrid?: number[][],
 *   energyNext?: number[][],
 *   energyDeltaGrid?: number[][],
 *   markEnergyDirty?: (row: number, col: number, options?: { radius?: number }) => void,
 * }} source - Grid-like owner containing the buffers to clear.
 * @param {number} row - Tile row index (integer or float; will be floored).
 * @param {number} col - Tile column index (integer or float; will be floored).
 * @param {{ preserveCurrent?: boolean }} [options] - Flags controlling whether
 *   the current-frame `energyGrid` value is reset.
 * @returns {void}
 */

export function clearTileEnergyBuffers(source, row, col, options = {}) {
  if (!source || row == null || col == null) return;

  const preserveCurrent = options?.preserveCurrent === true;

  const normalizedRow = Number.isInteger(row) ? row : Math.floor(row);
  const normalizedCol = Number.isInteger(col) ? col : Math.floor(col);

  if (normalizedRow < 0 || normalizedCol < 0) return;

  const { energyGrid, energyNext, energyDeltaGrid } = source;

  if (!preserveCurrent && isArrayLike(energyGrid)) {
    const energyRow = energyGrid[normalizedRow];

    if (isArrayLike(energyRow) && normalizedCol < energyRow.length) {
      energyRow[normalizedCol] = 0;
    }
  }

  if (isArrayLike(energyNext)) {
    const nextRow = energyNext[normalizedRow];

    if (isArrayLike(nextRow) && normalizedCol < nextRow.length) {
      nextRow[normalizedCol] = 0;
    }
  }

  if (isArrayLike(energyDeltaGrid)) {
    const deltaRow = energyDeltaGrid[normalizedRow];

    if (isArrayLike(deltaRow) && normalizedCol < deltaRow.length) {
      deltaRow[normalizedCol] = 0;
    }
  }

  if (typeof source?.markEnergyDirty === "function") {
    source.markEnergyDirty(normalizedRow, normalizedCol, { radius: 1 });
  }
}
