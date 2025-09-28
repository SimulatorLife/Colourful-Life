import { clamp } from './utils.js';
import { computeTileEnergyUpdate } from './energySystem.js';
import {
  CONSUMPTION_DENSITY_PENALTY,
  DENSITY_RADIUS_DEFAULT,
  REGEN_DENSITY_PENALTY,
} from './config.js';

export default class EnvironmentSystem {
  constructor(
    rows,
    cols,
    {
      maxTileEnergy,
      densityRadius = DENSITY_RADIUS_DEFAULT,
      regenDensityPenalty = REGEN_DENSITY_PENALTY,
      consumptionDensityPenalty = CONSUMPTION_DENSITY_PENALTY,
      isEventAffecting,
      getEventEffect,
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.maxTileEnergy = maxTileEnergy;
    this.regenDensityPenalty = regenDensityPenalty;
    this.consumptionDensityPenalty = consumptionDensityPenalty;
    this.isEventAffecting = isEventAffecting;
    this.getEventEffect = getEventEffect;
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => (this.maxTileEnergy ?? 0) / 2)
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityRadius = Math.max(0, Math.floor(densityRadius));
    this.densityTotals = this.buildDensityTotals(this.densityRadius);
    this.densityCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityLiveGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityDirtyTiles = new Set();
    this.cellGrid = null;
  }

  setCellGrid(cellGrid) {
    this.cellGrid = cellGrid;
  }

  setMaxTileEnergy(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      this.maxTileEnergy = value;
    }
  }

  clearEnergyAt(row, col) {
    if (this.energyGrid[row]?.[col] == null || this.energyNext[row]?.[col] == null) return;
    this.energyGrid[row][col] = 0;
    this.energyNext[row][col] = 0;
  }

  getEnergyAt(row, col) {
    return this.energyGrid[row]?.[col] ?? 0;
  }

  setEnergyAt(row, col, value) {
    if (this.energyGrid[row]?.[col] == null) return;
    this.energyGrid[row][col] = clamp(value, 0, this.maxTileEnergy ?? Infinity);
  }

  consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier = 1) {
    const available = this.getEnergyAt(row, col);
    const baseRate = typeof cell.dna.forageRate === 'function' ? cell.dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density = densityGrid?.[row]?.[col] ?? this.localDensity(row, col, this.densityRadius);
    const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
    const crowdPenalty = Math.max(0, 1 - this.consumptionDensityPenalty * effDensity);
    const minCap = typeof cell.dna.harvestCapMin === 'function' ? cell.dna.harvestCapMin() : 0.1;
    const maxCapRaw = typeof cell.dna.harvestCapMax === 'function' ? cell.dna.harvestCapMax() : 0.5;
    const maxCap = Math.max(minCap, clamp(maxCapRaw, minCap, 1));
    const cap = clamp(base * crowdPenalty, minCap, maxCap);
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(this.maxTileEnergy, cell.energy + take);
  }

  prepareForTick({
    events = [],
    eventStrengthMultiplier = 1,
    regenRate,
    diffusionRate,
    densityEffectMultiplier = 1,
    isObstacle,
  }) {
    this.syncDensitySnapshot();
    this.regenerateEnergyGrid({
      events,
      eventStrengthMultiplier,
      regenRate,
      diffusionRate,
      densityEffectMultiplier,
      isObstacle,
    });

    return { densityGrid: this.densityGrid };
  }

  regenerateEnergyGrid({
    events = [],
    eventStrengthMultiplier = 1,
    regenRate = 0,
    diffusionRate = 0,
    densityGrid = this.densityGrid,
    densityEffectMultiplier = 1,
    isObstacle,
  }) {
    const next = this.energyNext;
    const eventList = Array.isArray(events) ? events : events ? [events] : [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (typeof isObstacle === 'function' && isObstacle(r, c)) {
          next[r][c] = 0;
          if (this.energyGrid[r][c] !== 0) {
            this.energyGrid[r][c] = 0;
          }

          continue;
        }

        const density = densityGrid
          ? densityGrid[r][c]
          : this.localDensity(r, c, this.densityRadius);
        const neighborEnergies = [];

        if (r > 0 && (!isObstacle || !isObstacle(r - 1, c)))
          neighborEnergies.push(this.energyGrid[r - 1][c]);
        if (r < this.rows - 1 && (!isObstacle || !isObstacle(r + 1, c)))
          neighborEnergies.push(this.energyGrid[r + 1][c]);
        if (c > 0 && (!isObstacle || !isObstacle(r, c - 1)))
          neighborEnergies.push(this.energyGrid[r][c - 1]);
        if (c < this.cols - 1 && (!isObstacle || !isObstacle(r, c + 1)))
          neighborEnergies.push(this.energyGrid[r][c + 1]);

        const { nextEnergy } = computeTileEnergyUpdate({
          currentEnergy: this.energyGrid[r][c],
          density,
          neighborEnergies,
          events: eventList,
          row: r,
          col: c,
          config: {
            maxTileEnergy: this.maxTileEnergy,
            regenRate,
            diffusionRate,
            densityEffectMultiplier,
            regenDensityPenalty: this.regenDensityPenalty,
            eventStrengthMultiplier,
            isEventAffecting: this.isEventAffecting,
            getEventEffect: this.getEventEffect,
          },
        });

        next[r][c] = nextEnergy;
      }
    }

    const current = this.energyGrid;

    this.energyGrid = next;
    this.energyNext = current;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.energyNext[r][c] = 0;
    }
  }

  syncDensitySnapshot({ force = false } = {}) {
    const live = this.densityLiveGrid;

    if (!live) return;

    if (!this.densityGrid || this.densityGrid.length !== this.rows) {
      this.densityGrid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    }

    if (force) {
      for (let r = 0; r < this.rows; r++) {
        const destRow = this.densityGrid[r];
        const srcRow = live[r];

        for (let c = 0; c < this.cols; c++) destRow[c] = srcRow[c];
      }

      if (this.densityDirtyTiles) this.densityDirtyTiles.clear();

      return;
    }

    if (!this.densityDirtyTiles || this.densityDirtyTiles.size === 0) return;

    for (const key of this.densityDirtyTiles) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      this.densityGrid[row][col] = live[row][col];
    }

    this.densityDirtyTiles.clear();
  }

  applyDensityDelta(row, col, delta, radius = this.densityRadius) {
    if (!this.densityCounts) return;

    const totals = this.densityTotals;
    const liveGrid = this.densityLiveGrid;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        const countsRow = this.densityCounts[rr];
        const nextCount = (countsRow[cc] || 0) + delta;

        countsRow[cc] = nextCount;

        if (!liveGrid || !totals) continue;

        const total = totals[rr]?.[cc] ?? 0;
        const nextDensity = total > 0 ? clamp(nextCount / total, 0, 1) : 0;

        if (liveGrid[rr][cc] !== nextDensity) {
          liveGrid[rr][cc] = nextDensity;
          this.markDensityDirty(rr, cc);
        }
      }
    }
  }

  markDensityDirty(row, col) {
    if (!this.densityDirtyTiles) this.densityDirtyTiles = new Set();

    this.densityDirtyTiles.add(row * this.cols + col);
  }

  recalculateDensityCounts(cellGrid, radius = this.densityRadius) {
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
      this.densityTotals = this.buildDensityTotals(this.densityRadius);
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityCounts[r][c] = 0;
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityLiveGrid[r][c] = 0;
    }

    this.densityDirtyTiles.clear();
    this.cellGrid = cellGrid;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (cellGrid?.[r]?.[c]) this.applyDensityDelta(r, c, 1);
      }
    }

    this.syncDensitySnapshot({ force: true });
  }

  localDensity(row, col, radius = 1) {
    if (radius === this.densityRadius && this.densityCounts && this.densityTotals) {
      const total = this.densityTotals[row]?.[col] ?? 0;

      if (total <= 0) return 0;

      const count = this.densityCounts[row]?.[col] ?? 0;

      return Math.max(0, Math.min(1, count / total));
    }

    const { count, total } = this.countNeighbors(row, col, radius);

    return total > 0 ? count / total : 0;
  }

  getDensityAt(row, col) {
    if (this.densityGrid?.[row]?.[col] != null) {
      return this.densityGrid[row][col];
    }

    return this.localDensity(row, col, this.densityRadius);
  }

  buildDensityTotals(radius = this.densityRadius) {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.computeNeighborTotal(r, c, radius))
    );
  }

  computeNeighborTotal(row, col, radius = this.densityRadius) {
    let total = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        total += 1;
      }
    }

    return total;
  }

  countNeighbors(row, col, radius = 1) {
    let count = 0;
    let total = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        total++;
        if (this.cellGrid?.[rr]?.[cc]) count++;
      }
    }

    return { count, total };
  }
}
