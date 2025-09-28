import { clamp } from '../utils.js';
import { computeTileEnergyUpdate } from '../energySystem.js';
import { isEventAffecting } from '../eventManager.js';
import { getEventEffect } from '../eventEffects.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
  REGEN_DENSITY_PENALTY,
  CONSUMPTION_DENSITY_PENALTY,
} from '../config.js';

export default class GridState {
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
  static energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT;
  static DENSITY_RADIUS = DENSITY_RADIUS_DEFAULT;

  constructor(rows, cols, { maxTileEnergy } = {}) {
    this.rows = rows;
    this.cols = cols;
    this.maxTileEnergy =
      typeof maxTileEnergy === 'number'
        ? maxTileEnergy
        : (GridState.maxTileEnergy ?? MAX_TILE_ENERGY);
    GridState.maxTileEnergy = this.maxTileEnergy;

    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => this.maxTileEnergy / 2)
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.obstacles = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.activeCells = new Set();

    this.densityRadius = GridState.DENSITY_RADIUS;
    this.densityCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    this.densityLiveGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityDirtyTiles = new Set();
  }

  getCell(row, col) {
    return this.grid[row]?.[col] ?? null;
  }

  setCell(row, col, cell) {
    if (!cell) {
      return this.removeCell(row, col);
    }

    return this.placeCell(row, col, cell);
  }

  placeCell(row, col, cell) {
    if (!cell) return null;
    const current = this.grid[row][col];

    if (current === cell) return cell;
    if (current) this.removeCell(row, col);

    this.grid[row][col] = cell;
    if (cell && typeof cell === 'object') {
      if ('row' in cell) cell.row = row;
      if ('col' in cell) cell.col = col;
    }
    this.activeCells.add(cell);
    this.#applyDensityDelta(row, col, 1);

    return cell;
  }

  removeCell(row, col) {
    const current = this.grid[row]?.[col];

    if (!current) return null;

    this.grid[row][col] = null;
    this.activeCells.delete(current);
    this.#applyDensityDelta(row, col, -1);

    return current;
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    if (fromRow === toRow && fromCol === toCol) return true;
    const moving = this.grid[fromRow]?.[fromCol];

    if (!moving) return false;
    if (this.grid[toRow]?.[toCol]) return false;

    this.grid[toRow][toCol] = moving;
    this.grid[fromRow][fromCol] = null;
    if (moving && typeof moving === 'object') {
      if ('row' in moving) moving.row = toRow;
      if ('col' in moving) moving.col = toCol;
    }
    this.#applyDensityDelta(fromRow, fromCol, -1);
    this.#applyDensityDelta(toRow, toCol, 1);

    return true;
  }

  getActiveCellsSnapshot() {
    return Array.from(this.activeCells);
  }

  rebuildActiveCells() {
    this.activeCells.clear();
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.grid[row][col];

        if (cell) this.activeCells.add(cell);
      }
    }
  }

  consumeEnergy(cell, row, col, densityGrid = this.densityGrid, densityEffectMultiplier = 1) {
    const available = this.energyGrid[row][col];
    const baseRate = typeof cell.dna?.forageRate === 'function' ? cell.dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density =
      densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridState.DENSITY_RADIUS);
    const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
    const crowdPenalty = Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * effDensity);
    const minCap = typeof cell.dna?.harvestCapMin === 'function' ? cell.dna.harvestCapMin() : 0.1;
    const maxCapRaw =
      typeof cell.dna?.harvestCapMax === 'function' ? cell.dna.harvestCapMax() : 0.5;
    const maxCap = Math.max(minCap, clamp(maxCapRaw, minCap, 1));
    const cap = clamp(base * crowdPenalty, minCap, maxCap);
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(this.maxTileEnergy, cell.energy + take);
  }

  regenerateEnergyGrid(
    events = null,
    eventStrengthMultiplier = 1,
    regenRate = GridState.energyRegenRate,
    diffusionRate = GridState.energyDiffusionRate,
    densityGrid = null,
    densityEffectMultiplier = 1
  ) {
    const next = this.energyNext;
    const evs = Array.isArray(events) ? events : events ? [events] : [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isObstacle(r, c)) {
          next[r][c] = 0;
          if (this.energyGrid[r][c] !== 0) {
            this.energyGrid[r][c] = 0;
          }

          continue;
        }

        const density = densityGrid
          ? densityGrid[r][c]
          : this.localDensity(r, c, GridState.DENSITY_RADIUS);

        const neighborEnergies = [];

        if (r > 0 && !this.isObstacle(r - 1, c)) neighborEnergies.push(this.energyGrid[r - 1][c]);
        if (r < this.rows - 1 && !this.isObstacle(r + 1, c))
          neighborEnergies.push(this.energyGrid[r + 1][c]);
        if (c > 0 && !this.isObstacle(r, c - 1)) neighborEnergies.push(this.energyGrid[r][c - 1]);
        if (c < this.cols - 1 && !this.isObstacle(r, c + 1))
          neighborEnergies.push(this.energyGrid[r][c + 1]);

        const { nextEnergy } = computeTileEnergyUpdate({
          currentEnergy: this.energyGrid[r][c],
          density,
          neighborEnergies,
          events: evs,
          row: r,
          col: c,
          config: {
            maxTileEnergy: this.maxTileEnergy,
            regenRate,
            diffusionRate,
            densityEffectMultiplier,
            regenDensityPenalty: REGEN_DENSITY_PENALTY,
            eventStrengthMultiplier,
            isEventAffecting,
            getEventEffect,
          },
        });

        next[r][c] = nextEnergy;
      }
    }

    const cur = this.energyGrid;

    this.energyGrid = next;
    this.energyNext = cur;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.energyNext[r][c] = 0;
    }
  }

  isObstacle(row, col) {
    return Boolean(this.obstacles?.[row]?.[col]);
  }

  isTileBlocked(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;

    return this.isObstacle(row, col);
  }

  clearObstacles() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.obstacles[r][c] = false;
      }
    }
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const wasBlocked = this.obstacles[row][col];

    if (blocked) {
      this.obstacles[row][col] = true;
      if (!wasBlocked) {
        const occupant = this.grid[row][col];

        if (occupant) {
          if (evict) {
            this.removeCell(row, col);
          }
        }

        this.energyGrid[row][col] = 0;
        this.energyNext[row][col] = 0;
      } else {
        this.energyGrid[row][col] = 0;
        this.energyNext[row][col] = 0;
      }
    } else {
      this.obstacles[row][col] = false;
    }

    return true;
  }

  getDensityAt(row, col) {
    if (this.densityGrid?.[row]?.[col] != null) {
      return this.densityGrid[row][col];
    }

    return this.localDensity(row, col, this.densityRadius);
  }

  computeDensityGrid(radius = GridState.DENSITY_RADIUS) {
    const useCache =
      radius === this.densityRadius &&
      this.densityCounts &&
      this.densityTotals &&
      this.densityLiveGrid;

    if (useCache) {
      this.syncDensitySnapshot();

      return this.densityGrid.map((row) => row.slice());
    }

    const out = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const { count, total } = this.#countNeighbors(row, col, radius);

        out[row][col] = total > 0 ? count / total : 0;
      }
    }

    return out;
  }

  localDensity(row, col, radius = 1) {
    if (radius === this.densityRadius && this.densityCounts && this.densityTotals) {
      const total = this.densityTotals[row]?.[col] ?? 0;

      if (total <= 0) return 0;

      const count = this.densityCounts[row]?.[col] ?? 0;

      return Math.max(0, Math.min(1, count / total));
    }

    const { count, total } = this.#countNeighbors(row, col, radius);

    return total > 0 ? count / total : 0;
  }

  recalculateDensityCounts(radius = this.densityRadius) {
    const normalizedRadius = Math.max(0, Math.floor(radius));
    const targetRadius = normalizedRadius > 0 ? normalizedRadius : this.densityRadius;

    if (!this.densityCounts) {
      this.densityCounts = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    if (!this.densityLiveGrid) {
      this.densityLiveGrid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    if (!this.densityGrid) {
      this.densityGrid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    if (!this.densityDirtyTiles) {
      this.densityDirtyTiles = new Set();
    }

    if (targetRadius !== this.densityRadius) {
      this.densityRadius = targetRadius;
      this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityCounts[r][c] = 0;
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityLiveGrid[r][c] = 0;
    }

    this.densityDirtyTiles.clear();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) this.#applyDensityDelta(r, c, 1);
      }
    }

    this.syncDensitySnapshot(true);
  }

  syncDensitySnapshot(force = false) {
    const liveGrid = this.densityLiveGrid;

    if (!liveGrid) return;

    if (!this.densityGrid || this.densityGrid.length !== this.rows) {
      this.densityGrid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    if (force) {
      for (let r = 0; r < this.rows; r++) {
        const destRow = this.densityGrid[r];
        const srcRow = liveGrid[r];

        for (let c = 0; c < this.cols; c++) destRow[c] = srcRow[c];
      }

      if (this.densityDirtyTiles) this.densityDirtyTiles.clear();

      return;
    }

    if (!this.densityDirtyTiles || this.densityDirtyTiles.size === 0) return;

    for (const key of this.densityDirtyTiles) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      this.densityGrid[row][col] = liveGrid[row][col];
    }

    this.densityDirtyTiles.clear();
  }

  getEnergyAt(row, col) {
    return this.energyGrid?.[row]?.[col] ?? 0;
  }

  getEnergyFraction(row, col) {
    return this.getEnergyAt(row, col) / this.maxTileEnergy;
  }

  #applyDensityDelta(row, col, delta, radius = this.densityRadius) {
    if (!this.densityCounts) return;

    const totals = this.densityTotals;
    const liveGrid = this.densityLiveGrid;

    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue;

        const rr = row + dr;
        const cc = col + dc;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        this.densityCounts[rr][cc] += delta;
        if (liveGrid?.[rr]) {
          const total = totals?.[rr]?.[cc] ?? 0;

          liveGrid[rr][cc] =
            total > 0 ? Math.max(0, Math.min(1, this.densityCounts[rr][cc] / total)) : 0;
          this.#markDensityDirty(rr, cc);
        }
      }
    }

    const total = totals?.[row]?.[col] ?? 0;

    if (liveGrid?.[row]) {
      liveGrid[row][col] =
        total > 0 ? Math.max(0, Math.min(1, this.densityCounts[row][col] / total)) : 0;
      this.#markDensityDirty(row, col);
    }
  }

  #markDensityDirty(row, col) {
    if (!this.densityDirtyTiles) this.densityDirtyTiles = new Set();

    this.densityDirtyTiles.add(row * this.cols + col);
  }

  #countNeighbors(row, col, radius = GridState.DENSITY_RADIUS) {
    let count = 0;
    let total = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        total++;
        if (this.grid[rr][cc]) count++;
      }
    }

    return { count, total };
  }

  #computeNeighborTotal(row, col, radius) {
    let total = 0;

    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = row + dr;
        const cc = col + dc;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        total += 1;
      }
    }

    return total;
  }

  #buildDensityTotals(radius = this.densityRadius) {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.#computeNeighborTotal(r, c, radius))
    );
  }
}
