import { MAX_TILE_ENERGY } from "../config.js";
import { clearTileEnergyBuffers } from "./energyUtils.js";

/**
 * Thin adapter exposing a stable API for systems that need to query or mutate
 * the grid without depending on the full {@link GridManager} surface. Used by
 * {@link InteractionSystem} and tests to swap in mock managers.
 */
export default class GridInteractionAdapter {
  constructor({ gridManager } = {}) {
    this.gridManager = gridManager ?? null;
  }

  #managerHas(method) {
    const manager = this.gridManager;

    return manager && typeof manager[method] === "function";
  }

  getCell(row, col) {
    if (this.#managerHas("getCell")) {
      return this.gridManager.getCell(row, col);
    }

    return this.gridManager?.grid?.[row]?.[col] ?? null;
  }

  setCell(row, col, cell, options = {}) {
    if (this.#managerHas("setCell")) {
      return this.gridManager.setCell(row, col, cell, options);
    }

    if (!cell) {
      this.removeCell(row, col);

      return null;
    }

    if (!this.gridManager?.grid?.[row]) return null;

    this.gridManager.grid[row][col] = cell;
    clearTileEnergyBuffers(this.gridManager, row, col);

    if (cell && typeof cell === "object") {
      if ("row" in cell) cell.row = row;
      if ("col" in cell) cell.col = col;
    }

    return cell;
  }

  removeCell(row, col) {
    if (this.#managerHas("removeCell")) {
      return this.gridManager.removeCell(row, col);
    }

    const current = this.gridManager?.grid?.[row]?.[col] ?? null;

    if (current) {
      this.gridManager.grid[row][col] = null;
    }

    return current;
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    if (this.#managerHas("relocateCell")) {
      return this.gridManager.relocateCell(fromRow, fromCol, toRow, toCol);
    }

    if (
      fromRow === toRow &&
      fromCol === toCol &&
      Number.isInteger(fromRow) &&
      Number.isInteger(fromCol)
    ) {
      return true;
    }

    if (
      !Number.isInteger(fromRow) ||
      !Number.isInteger(fromCol) ||
      !Number.isInteger(toRow) ||
      !Number.isInteger(toCol)
    ) {
      return false;
    }

    const rowDelta = Math.abs(toRow - fromRow);
    const colDelta = Math.abs(toCol - fromCol);

    if (rowDelta > 1 || colDelta > 1 || (rowDelta === 0 && colDelta === 0)) {
      return false;
    }

    const moving = this.getCell(fromRow, fromCol);

    if (!moving || this.getCell(toRow, toCol)) return false;

    this.setCell(toRow, toCol, moving);
    this.removeCell(fromRow, fromCol);
    clearTileEnergyBuffers(this.gridManager, toRow, toCol);

    return true;
  }

  consumeTileEnergy({ cell, row, col, densityGrid, densityEffectMultiplier } = {}) {
    if (!cell || row == null || col == null) return 0;

    if (this.#managerHas("consumeEnergy")) {
      this.gridManager.consumeEnergy(
        cell,
        row,
        col,
        densityGrid,
        densityEffectMultiplier,
      );

      return 1;
    }

    return 0;
  }

  transferEnergy({ from, to, amount } = {}) {
    const donor = from ?? null;
    const recipient = to ?? null;
    const requested = Math.max(0, amount ?? 0);

    if (!donor || requested <= 0 || typeof donor.energy !== "number") return 0;

    const available = Math.max(0, Math.min(requested, donor.energy));
    const tileEnergyCapacity = this.maxTileEnergy();
    let transferred = available;

    if (recipient) {
      const current = typeof recipient.energy === "number" ? recipient.energy : 0;
      const capacity = Math.max(0, tileEnergyCapacity - current);

      transferred = Math.max(0, Math.min(available, capacity));
      recipient.energy = current + transferred;
    }

    donor.energy = Math.max(0, donor.energy - transferred);

    return transferred;
  }

  maxTileEnergy() {
    const positiveOverride = [
      this.gridManager?.maxTileEnergy,
      globalThis?.GridManager?.maxTileEnergy,
    ].find((value) => Number.isFinite(value) && value > 0);

    return positiveOverride ?? MAX_TILE_ENERGY;
  }

  densityAt(row, col, { densityGrid } = {}) {
    if (densityGrid?.[row]?.[col] != null) {
      return densityGrid[row][col];
    }

    if (this.#managerHas("getDensityAt")) {
      return this.gridManager.getDensityAt(row, col);
    }

    return 0;
  }
}
