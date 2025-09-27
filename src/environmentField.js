import { clamp } from './utils.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  REGEN_DENSITY_PENALTY,
} from './config.js';
import { isEventAffecting } from './eventManager.js';
import { getEventEffect } from './eventEffects.js';

export default class EnvironmentField {
  constructor(
    rows,
    cols,
    {
      maxTileEnergy = MAX_TILE_ENERGY,
      regenRate = ENERGY_REGEN_RATE_DEFAULT,
      diffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT,
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.maxTileEnergy = maxTileEnergy;
    this.regenRate = regenRate;
    this.diffusionRate = diffusionRate;
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => this.maxTileEnergy / 2)
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.isObstacle = () => false;
  }

  setObstacleChecker(checker) {
    this.isObstacle = typeof checker === 'function' ? checker : () => false;
  }

  getEnergy(row, col) {
    return this.energyGrid[row]?.[col] ?? 0;
  }

  getNormalizedEnergy(row, col) {
    const value = this.getEnergy(row, col);

    return this.maxTileEnergy > 0 ? value / this.maxTileEnergy : 0;
  }

  setEnergy(row, col, value) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    const val = clamp(value, 0, this.maxTileEnergy);

    this.energyGrid[row][col] = val;
  }

  takeEnergy(row, col, requested) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return 0;
    const available = this.energyGrid[row][col];
    const amount = Math.min(
      available,
      Number.isFinite(requested) && requested >= 0 ? requested : available
    );

    this.energyGrid[row][col] = available - amount;

    return amount;
  }

  resetTile(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;
    this.energyGrid[row][col] = 0;
    this.energyNext[row][col] = 0;
  }

  tick({
    events = [],
    eventStrengthMultiplier = 1,
    densityGrid = null,
    densityEffectMultiplier = 1,
    regenRate = this.regenRate,
    diffusionRate = this.diffusionRate,
  } = {}) {
    const maxEnergy = this.maxTileEnergy;
    const next = this.energyNext;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.isObstacle(r, c)) {
          next[r][c] = 0;
          if (this.energyGrid[r][c] !== 0) {
            this.energyGrid[r][c] = 0;
          }

          continue;
        }

        const current = this.energyGrid[r][c];
        let regen = regenRate * (1 - current / maxEnergy);
        let drain = 0;

        const density = densityGrid ? densityGrid[r][c] : 0;
        const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);

        regen *= Math.max(0, 1 - REGEN_DENSITY_PENALTY * effDensity);

        const activeEvents = Array.isArray(events) ? events : events ? [events] : [];

        for (const ev of activeEvents) {
          if (!isEventAffecting(ev, r, c)) continue;

          const strength = (ev.strength || 0) * (eventStrengthMultiplier || 1);
          const effect = getEventEffect(ev.eventType);

          if (!effect || strength === 0) continue;

          const { regenScale, regenAdd, drainAdd } = effect;

          if (regenScale) {
            const { base = 1, change = 0, min = 0 } = regenScale;
            const scale = Math.max(min, base + change * strength);

            regen *= scale;
          }

          if (typeof regenAdd === 'number') {
            regen += regenAdd * strength;
          }

          if (typeof drainAdd === 'number') {
            drain += drainAdd * strength;
          }
        }

        let neighborSum = 0;
        let neighborCount = 0;

        if (r > 0 && !this.isObstacle(r - 1, c)) {
          neighborSum += this.energyGrid[r - 1][c];
          neighborCount++;
        }
        if (r < this.rows - 1 && !this.isObstacle(r + 1, c)) {
          neighborSum += this.energyGrid[r + 1][c];
          neighborCount++;
        }
        if (c > 0 && !this.isObstacle(r, c - 1)) {
          neighborSum += this.energyGrid[r][c - 1];
          neighborCount++;
        }
        if (c < this.cols - 1 && !this.isObstacle(r, c + 1)) {
          neighborSum += this.energyGrid[r][c + 1];
          neighborCount++;
        }

        const neighborAvg = neighborCount > 0 ? neighborSum / neighborCount : current;
        const diffusion = neighborCount > 0 ? diffusionRate * (neighborAvg - current) : 0;

        let value = current + regen - drain + diffusion;

        if (value < 0) value = 0;
        if (value > maxEnergy) value = maxEnergy;
        next[r][c] = value;
      }
    }

    const currentGrid = this.energyGrid;

    this.energyGrid = next;
    this.energyNext = currentGrid;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.energyNext[r][c] = 0;
      }
    }
  }
}
