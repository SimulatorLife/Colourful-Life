import { MAX_TILE_ENERGY } from "../config.js";
import { pickFirstFinitePositive } from "../utils.js";
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

  registerDeath(cell, details = {}) {
    if (this.#managerHas("registerDeath")) {
      this.gridManager.registerDeath(cell, details);

      return;
    }

    const row = Number.isInteger(details?.row) ? details.row : cell?.row;
    const col = Number.isInteger(details?.col) ? details.col : cell?.col;

    if (this.gridManager?.stats?.onDeath && cell) {
      const metadata = { ...(details || {}), row, col };

      this.gridManager.stats.onDeath(cell, metadata);
    }
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    if (this.#managerHas("relocateCell")) {
      return this.gridManager.relocateCell(fromRow, fromCol, toRow, toCol);
    }

    const coordinates = [fromRow, fromCol, toRow, toCol];

    if (!coordinates.every(Number.isInteger)) {
      return false;
    }

    if (fromRow === toRow && fromCol === toCol) {
      return true;
    }

    const rowDelta = Math.abs(toRow - fromRow);
    const colDelta = Math.abs(toCol - fromCol);

    if (rowDelta > 1 || colDelta > 1) {
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
    const positiveOverride = pickFirstFinitePositive([
      this.gridManager?.maxTileEnergy,
      globalThis?.GridManager?.maxTileEnergy,
    ]);

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
