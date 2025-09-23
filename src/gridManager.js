import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';
import { computeFitness } from './fitness.js';
import BrainDebugger from './brainDebugger.js';
import { isEventAffecting } from './eventManager.js';
import { getEventEffect } from './eventEffects.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
  REGEN_DENSITY_PENALTY,
  CONSUMPTION_DENSITY_PENALTY,
} from './config.js';

export const OBSTACLE_PRESETS = [
  {
    id: 'none',
    label: 'Open Field',
    description: 'Clears all obstacles for free movement.',
  },
  {
    id: 'midline',
    label: 'Midline Wall',
    description: 'Single vertical barrier with regular gates.',
  },
  {
    id: 'corridor',
    label: 'Triple Corridor',
    description: 'Two vertical walls that divide the map into three lanes.',
  },
  {
    id: 'checkerboard',
    label: 'Checkerboard Gaps',
    description: 'Alternating impassable tiles to force weaving paths.',
  },
  {
    id: 'perimeter',
    label: 'Perimeter Ring',
    description: 'Walls around the rim that keep populations in-bounds.',
  },
];

export const OBSTACLE_SCENARIOS = [
  {
    id: 'manual',
    label: 'Manual Control',
    description: 'No scheduled obstacle changes.',
    schedule: [],
  },
  {
    id: 'mid-run-wall',
    label: 'Mid-run Wall Drop',
    description: 'Start open, then add a midline wall with gates after 600 ticks.',
    schedule: [
      { delay: 0, preset: 'none', clearExisting: true },
      { delay: 600, preset: 'midline', clearExisting: true, presetOptions: { gapEvery: 12 } },
    ],
  },
  {
    id: 'pressure-maze',
    label: 'Closing Maze',
    description: 'Perimeter walls first, then corridors, ending with checkerboard choke points.',
    schedule: [
      { delay: 0, preset: 'perimeter', clearExisting: true },
      { delay: 400, preset: 'corridor', append: true },
      { delay: 900, preset: 'checkerboard', clearExisting: true, presetOptions: { tileSize: 3 } },
    ],
  },
];

export default class GridManager {
  // Base per-tick regen before modifiers; logistic to max, density-aware
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
  // Fraction to diffuse toward neighbors each tick
  static energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT;
  static DENSITY_RADIUS = DENSITY_RADIUS_DEFAULT;
  static maxTileEnergy = MAX_TILE_ENERGY;

  static tryMove(gridArr, sr, sc, dr, dc, rows, cols, options = {}) {
    const {
      obstacles = null,
      lingerPenalty = 0,
      penalizeOnBounds = true,
      onBlocked = null,
    } = options;
    const nr = sr + dr;
    const nc = sc + dc;
    const moving = gridArr[sr][sc];
    const applyWallPenalty = (reason) => {
      if (!moving || typeof moving !== 'object' || moving.energy == null) return;
      const base =
        typeof lingerPenalty === 'function'
          ? lingerPenalty({ cell: moving, reason, attemptedRow: nr, attemptedCol: nc })
          : lingerPenalty;
      const amount = Number.isFinite(base) ? Math.max(0, base) : 0;

      if (amount <= 0) return;
      const prior = moving.wallContactTicks || 0;
      const scale = 1 + Math.min(prior, 6) * 0.25;

      moving.energy = Math.max(0, moving.energy - amount * scale);
      moving.wallContactTicks = prior + 1;
    };
    const clearWallPenalty = () => {
      if (moving && typeof moving === 'object' && moving.wallContactTicks) {
        moving.wallContactTicks = 0;
      }
    };

    if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
      if (penalizeOnBounds) applyWallPenalty('bounds');
      if (typeof onBlocked === 'function')
        onBlocked({ reason: 'bounds', row: sr, col: sc, nextRow: nr, nextCol: nc, mover: moving });

      return false;
    }

    if (obstacles && obstacles[nr]?.[nc]) {
      applyWallPenalty('obstacle');
      if (typeof onBlocked === 'function')
        onBlocked({
          reason: 'obstacle',
          row: sr,
          col: sc,
          nextRow: nr,
          nextCol: nc,
          mover: moving,
        });

      return false;
    }

    const dcell = gridArr[nr][nc];

    if (!dcell) {
      gridArr[nr][nc] = moving;
      gridArr[sr][sc] = null;
      if (moving && typeof moving === 'object') {
        if ('row' in moving) moving.row = nr;
        if ('col' in moving) moving.col = nc;
      }
      // Charge movement energy cost to the mover if available
      if (moving && typeof moving === 'object' && moving.energy != null && moving.dna) {
        const cost = typeof moving.dna.moveCost === 'function' ? moving.dna.moveCost() : 0.005;

        moving.energy = Math.max(0, moving.energy - cost);
      }

      clearWallPenalty();

      return true;
    }

    return false;
  }

  static moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
    else dc = -Math.sign(dCol);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveRandomly(gridArr, row, col, cell, rows, cols, options = {}) {
    const { dr, dc } = cell.decideRandomMove();

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  constructor(
    rows,
    cols,
    { eventManager, ctx = null, cellSize = 8, stats, maxTileEnergy, selectionManager } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.maxTileEnergy =
      typeof maxTileEnergy === 'number' ? maxTileEnergy : GridManager.maxTileEnergy;
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => this.maxTileEnergy / 2)
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.obstacles = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.eventManager = eventManager || window.eventManager;
    this.ctx = ctx || window.ctx;
    this.cellSize = cellSize || window.cellSize || 8;
    this.stats = stats || window.stats;
    this.selectionManager = selectionManager || null;
    this.densityGrid = null;
    this.lastSnapshot = null;
    this.lingerPenalty = 0;
    this.obstacleSchedules = [];
    this.currentObstaclePreset = 'none';
    this.currentScenarioId = 'manual';
    this.tickCount = 0;
    this.boundTryMove = (gridArr, sr, sc, dr, dc, rows, cols) =>
      GridManager.tryMove(gridArr, sr, sc, dr, dc, rows, cols, this.#movementOptions());
    this.boundMoveToTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      GridManager.moveToTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rows,
        cols,
        this.#movementOptions()
      );
    this.boundMoveAwayFromTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      GridManager.moveAwayFromTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rows,
        cols,
        this.#movementOptions()
      );
    this.boundMoveRandomly = (gridArr, row, col, cell, rows, cols) =>
      GridManager.moveRandomly(gridArr, row, col, cell, rows, cols, this.#movementOptions());
    this.init();
  }

  #movementOptions() {
    return {
      obstacles: this.obstacles,
      lingerPenalty: this.lingerPenalty,
      penalizeOnBounds: true,
    };
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
  }

  setLingerPenalty(value = 0) {
    const numeric = Number(value);

    this.lingerPenalty = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
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
    this.currentObstaclePreset = 'none';
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const wasBlocked = this.obstacles[row][col];

    if (blocked) {
      this.obstacles[row][col] = true;
      if (!wasBlocked && this.grid[row][col]) {
        const occupant = this.grid[row][col];

        this.grid[row][col] = null;
        if (evict && this.stats?.onDeath) this.stats.onDeath();
        if (occupant && occupant.energy != null) {
          this.energyGrid[row][col] = 0;
          this.energyNext[row][col] = 0;
        }
      } else {
        this.energyGrid[row][col] = 0;
        this.energyNext[row][col] = 0;
      }
    } else {
      this.obstacles[row][col] = false;
    }

    return true;
  }

  paintVerticalWall(
    col,
    {
      startRow = 0,
      endRow = this.rows - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {}
  ) {
    const normalizedStart = Math.max(0, startRow);
    const normalizedEnd = Math.min(this.rows - 1, endRow);
    const width = Math.max(1, Math.floor(thickness));

    for (let offset = 0; offset < width; offset++) {
      const cc = col + offset;

      if (cc < 0 || cc >= this.cols) continue;
      for (let r = normalizedStart; r <= normalizedEnd; r++) {
        if (gapEvery > 0) {
          const idx = r - normalizedStart + gapOffset;

          if (idx % gapEvery === 0) continue;
        }
        this.setObstacle(r, cc, true, { evict });
      }
    }
  }

  paintHorizontalWall(
    row,
    {
      startCol = 0,
      endCol = this.cols - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {}
  ) {
    const normalizedStart = Math.max(0, startCol);
    const normalizedEnd = Math.min(this.cols - 1, endCol);
    const height = Math.max(1, Math.floor(thickness));

    for (let offset = 0; offset < height; offset++) {
      const rr = row + offset;

      if (rr < 0 || rr >= this.rows) continue;
      for (let c = normalizedStart; c <= normalizedEnd; c++) {
        if (gapEvery > 0) {
          const idx = c - normalizedStart + gapOffset;

          if (idx % gapEvery === 0) continue;
        }
        this.setObstacle(rr, c, true, { evict });
      }
    }
  }

  paintCheckerboard({
    tileSize = 2,
    offsetRow = 0,
    offsetCol = 0,
    blockParity = 0,
    evict = true,
  } = {}) {
    const size = Math.max(1, Math.floor(tileSize));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tileR = Math.floor((r + offsetRow) / size);
        const tileC = Math.floor((c + offsetCol) / size);
        const parity = (tileR + tileC) % 2;

        if (parity === blockParity) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  paintPerimeter({ thickness = 1, evict = true } = {}) {
    const t = Math.max(1, Math.floor(thickness));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const onEdge = r < t || r >= this.rows - t || c < t || c >= this.cols - t;

        if (onEdge) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  applyObstaclePreset(
    presetId,
    { clearExisting = true, append = false, presetOptions = {}, evict = true } = {}
  ) {
    if (clearExisting && !append) this.clearObstacles();
    const options = presetOptions || {};

    switch (presetId) {
      case 'none':
        if (clearExisting) this.clearObstacles();
        break;
      case 'midline': {
        const col = Math.floor(this.cols / 2);
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 10));
        const gapOffset = Math.floor(options.gapOffset ?? gapEvery / 2);
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintVerticalWall(col, { gapEvery, gapOffset, thickness, evict });
        break;
      }
      case 'corridor': {
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 12));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const first = Math.max(1, Math.floor(this.cols / 3));
        const second = Math.min(this.cols - 2, Math.floor((2 * this.cols) / 3));

        this.paintVerticalWall(first, { gapEvery, thickness, evict });
        this.paintVerticalWall(second, {
          gapEvery,
          thickness,
          evict,
          gapOffset: Math.floor(gapEvery / 2),
        });
        break;
      }
      case 'checkerboard': {
        const tileSize = Math.max(1, Math.floor(options.tileSize ?? 2));
        const offsetRow = Math.floor(options.offsetRow ?? 0);
        const offsetCol = Math.floor(options.offsetCol ?? 0);
        const blockParity = Math.floor(options.blockParity ?? 0) % 2;

        this.paintCheckerboard({ tileSize, offsetRow, offsetCol, blockParity, evict });
        break;
      }
      case 'perimeter': {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintPerimeter({ thickness, evict });
        break;
      }
      default:
        break;
    }

    this.currentObstaclePreset = presetId;
  }

  clearScheduledObstacles() {
    this.obstacleSchedules = [];
  }

  scheduleObstaclePreset({
    delay = 0,
    preset = 'none',
    presetOptions = {},
    clearExisting = true,
    append = false,
    evict = true,
  } = {}) {
    const triggerTick = this.tickCount + Math.max(0, Math.floor(delay));

    this.obstacleSchedules.push({
      triggerTick,
      preset,
      clearExisting,
      append,
      presetOptions,
      evict,
    });
    this.obstacleSchedules.sort((a, b) => a.triggerTick - b.triggerTick);
  }

  processScheduledObstacles() {
    if (!Array.isArray(this.obstacleSchedules) || this.obstacleSchedules.length === 0) return;

    while (
      this.obstacleSchedules.length > 0 &&
      this.obstacleSchedules[0].triggerTick <= this.tickCount
    ) {
      const next = this.obstacleSchedules.shift();

      this.applyObstaclePreset(next.preset, {
        clearExisting: next.clearExisting,
        append: next.append,
        presetOptions: next.presetOptions,
        evict: next.evict,
      });
    }
  }

  runObstacleScenario(scenarioId, { resetSchedule = true } = {}) {
    const scenario = OBSTACLE_SCENARIOS.find((s) => s.id === scenarioId);

    if (!scenario) return false;
    if (resetSchedule) this.clearScheduledObstacles();
    this.currentScenarioId = scenario.id;

    for (let i = 0; i < scenario.schedule.length; i++) {
      const step = scenario.schedule[i];
      const delay = Math.max(0, Math.floor(step.delay ?? 0));
      const opts = {
        clearExisting: step.clearExisting,
        append: step.append,
        presetOptions: step.presetOptions,
        evict: step.evict ?? true,
      };

      if (delay === 0) this.applyObstaclePreset(step.preset, opts);
      else
        this.scheduleObstaclePreset({
          delay,
          preset: step.preset,
          presetOptions: step.presetOptions,
          clearExisting: step.clearExisting,
          append: step.append,
          evict: step.evict ?? true,
        });
    }

    if (scenario.schedule.length === 0) this.currentObstaclePreset = 'none';

    return true;
  }

  init() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.isObstacle(row, col)) continue;
        if (randomPercent(0.05)) {
          const dna = DNA.random();

          this.spawnCell(row, col, { dna });
        }
      }
    }
  }

  seed(currentPopulation, minPopulation) {
    if (currentPopulation >= minPopulation) return;
    const empty = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.getCell(r, c) && !this.isObstacle(r, c)) empty.push({ r, c });
      }
    }
    const toSeed = Math.min(minPopulation - currentPopulation, empty.length);

    for (let i = 0; i < toSeed; i++) {
      const idx = Math.floor(randomRange(0, empty.length));
      const { r, c } = empty.splice(idx, 1)[0];
      const dna = DNA.random();

      this.spawnCell(r, c, { dna });
    }
  }

  consumeEnergy(cell, row, col, densityGrid = this.densityGrid) {
    const available = this.energyGrid[row][col];
    // DNA-driven harvest with density penalty
    const baseRate = typeof cell.dna.forageRate === 'function' ? cell.dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density =
      densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const crowdPenalty = Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * density);
    const minCap = typeof cell.dna.harvestCapMin === 'function' ? cell.dna.harvestCapMin() : 0.1;
    const maxCapRaw = typeof cell.dna.harvestCapMax === 'function' ? cell.dna.harvestCapMax() : 0.5;
    const maxCap = Math.max(minCap, clamp(maxCapRaw, minCap, 1));
    const cap = clamp(base * crowdPenalty, minCap, maxCap);
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(this.maxTileEnergy, cell.energy + take);
  }

  regenerateEnergyGrid(
    events = null,
    eventStrengthMultiplier = 1,
    R = GridManager.energyRegenRate,
    D = GridManager.energyDiffusionRate,
    densityGrid = null
  ) {
    const maxE = this.maxTileEnergy;
    const next = this.energyNext;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const e = this.energyGrid[r][c];
        // Logistic toward max
        let regen = R * (1 - e / maxE);
        let drain = 0;

        // Density reduces local regen (overgrazing effect)
        const density = densityGrid
          ? densityGrid[r][c]
          : this.localDensity(r, c, GridManager.DENSITY_RADIUS);

        regen *= Math.max(0, 1 - REGEN_DENSITY_PENALTY * density);

        // Events modulate regen/drain (handle multiple)
        const evs = Array.isArray(events) ? events : events ? [events] : [];

        for (const ev of evs) {
          if (!isEventAffecting(ev, r, c)) continue;

          const s = (ev.strength || 0) * (eventStrengthMultiplier || 1);
          const effect = getEventEffect(ev.eventType);

          if (!effect || s === 0) continue;

          const { regenScale, regenAdd, drainAdd } = effect;

          if (regenScale) {
            const { base = 1, change = 0, min = 0 } = regenScale;
            const scale = Math.max(min, base + change * s);

            regen *= scale;
          }

          if (typeof regenAdd === 'number') {
            regen += regenAdd * s;
          }

          if (typeof drainAdd === 'number') {
            drain += drainAdd * s;
          }
        }

        // Diffusion toward 4-neighbor mean
        let neighSum = 0;
        let neighCount = 0;

        if (r > 0) {
          neighSum += this.energyGrid[r - 1][c];
          neighCount++;
        }
        if (r < this.rows - 1) {
          neighSum += this.energyGrid[r + 1][c];
          neighCount++;
        }
        if (c > 0) {
          neighSum += this.energyGrid[r][c - 1];
          neighCount++;
        }
        if (c < this.cols - 1) {
          neighSum += this.energyGrid[r][c + 1];
          neighCount++;
        }

        const neighAvg = neighCount > 0 ? neighSum / neighCount : e;
        const diff = neighCount > 0 ? D * (neighAvg - e) : 0;

        let val = e + regen - drain + diff;

        if (val < 0) val = 0;
        if (val > maxE) val = maxE;
        next[r][c] = val;
      }
    }
    // Swap buffers and clear the buffer for next tick writes
    const cur = this.energyGrid;

    this.energyGrid = next;
    this.energyNext = cur;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.energyNext[r][c] = 0;
    }
  }

  getCell(row, col) {
    return this.grid[row][col];
  }

  setCell(row, col, cell) {
    this.grid[row][col] = cell;
  }

  spawnCell(row, col, { dna = DNA.random(), spawnEnergy, recordBirth = false } = {}) {
    if (this.isObstacle(row, col)) return null;
    const energy = Math.min(this.maxTileEnergy, spawnEnergy ?? this.energyGrid[row][col]);
    const cell = new Cell(row, col, dna, energy);

    this.setCell(row, col, cell);
    this.energyGrid[row][col] = 0;

    if (recordBirth) this.stats?.onBirth?.(cell);

    return cell;
  }

  getDensityAt(row, col) {
    return (
      this.densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS)
    );
  }

  // Precompute density for all tiles (fraction of occupied neighbors)
  #countNeighbors(row, col, radius = GridManager.DENSITY_RADIUS) {
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

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
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
    const { count, total } = this.#countNeighbors(row, col, radius);

    return total > 0 ? count / total : 0;
  }

  draw() {
    const ctx = this.ctx;
    const cellSize = this.cellSize;

    // Clear full canvas once
    ctx.clearRect(0, 0, this.cols * cellSize, this.rows * cellSize);
    if (this.obstacles) {
      ctx.fillStyle = 'rgba(40,40,55,0.9)';
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (!this.obstacles[row][col]) continue;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
      ctx.strokeStyle = 'rgba(200,200,255,0.25)';
      ctx.lineWidth = Math.max(1, cellSize * 0.1);
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (!this.obstacles[row][col]) continue;
          ctx.strokeRect(col * cellSize + 0.5, row * cellSize + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }
    // Draw cells only
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.getCell(row, col);

        if (!cell) continue;
        ctx.fillStyle = cell.color;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }

  prepareTick({ eventManager, eventStrengthMultiplier, energyRegenRate, energyDiffusionRate }) {
    const densityGrid = this.computeDensityGrid(GridManager.DENSITY_RADIUS);

    this.regenerateEnergyGrid(
      eventManager.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityGrid
    );

    return { densityGrid };
  }

  processCell(
    row,
    col,
    {
      stats,
      eventManager,
      densityGrid,
      processed,
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
      eventStrengthMultiplier,
      mutationMultiplier,
    }
  ) {
    const cell = this.grid[row][col];

    if (!cell || processed.has(cell)) return;
    processed.add(cell);
    cell.age++;
    if (cell.age >= cell.lifespan) {
      this.grid[row][col] = null;
      stats.onDeath();

      return;
    }

    const events = eventManager.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, this.maxTileEnergy);
    }

    this.consumeEnergy(cell, row, col, densityGrid);
    const localDensity = densityGrid[row][col];

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (starved || cell.energy <= 0) {
      this.grid[row][col] = null;
      stats.onDeath();

      return;
    }

    const act = typeof cell.dna.activityRate === 'function' ? cell.dna.activityRate() : 1;

    if (Math.random() > act) {
      return;
    }

    const targets = this.findTargets(row, col, cell, {
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
    });

    if (
      this.handleReproduction(row, col, cell, targets, {
        stats,
        densityGrid,
        densityEffectMultiplier,
        mutationMultiplier,
      })
    ) {
      return;
    }

    if (this.handleCombat(row, col, cell, targets, { stats, densityEffectMultiplier })) {
      return;
    }

    this.handleMovement(row, col, cell, targets, {
      densityGrid,
      densityEffectMultiplier,
    });
  }

  handleReproduction(
    row,
    col,
    cell,
    { mates, society },
    { stats, densityGrid, densityEffectMultiplier, mutationMultiplier }
  ) {
    // findTargets sorts potential partners into neutral mates and allies; fall back
    // to the allied list so strongly kin-seeking genomes still have options.
    const matePool = mates.length > 0 ? mates : society;

    if (matePool.length === 0) return false;

    const selection = cell.selectMateWeighted ? cell.selectMateWeighted(matePool) : null;
    const selectedMate = selection?.chosen ?? null;
    const evaluated = Array.isArray(selection?.evaluated) ? selection.evaluated : [];
    const selectionMode = selection?.mode ?? 'preference';

    let bestMate = selectedMate;

    if (!bestMate || !bestMate.target) {
      bestMate = cell.findBestMate(matePool);

      if (!bestMate) return false;
    }

    const originalParentRow = cell.row;
    const originalParentCol = cell.col;
    const moveSucceeded = this.boundMoveToTarget(
      this.grid,
      row,
      col,
      bestMate.row,
      bestMate.col,
      this.rows,
      this.cols
    );
    const parentRow = cell.row;
    const parentCol = cell.col;
    const mateRow = bestMate.target.row;
    const mateCol = bestMate.target.col;

    const localDensity = densityGrid[row][col];
    const baseProb = cell.computeReproductionProbability(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
    });
    const { probability: reproProb } = cell.decideReproduction(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
      baseProbability: baseProb,
    });

    const thrFracA =
      typeof cell.dna.reproductionThresholdFrac === 'function'
        ? cell.dna.reproductionThresholdFrac()
        : 0.4;
    const thrFracB =
      typeof bestMate.target.dna.reproductionThresholdFrac === 'function'
        ? bestMate.target.dna.reproductionThresholdFrac()
        : 0.4;
    const thrA = thrFracA * this.maxTileEnergy;
    const thrB = thrFracB * this.maxTileEnergy;
    const appetite = cell.diversityAppetite ?? 0;
    const bias = cell.matePreferenceBias ?? 0;
    const selectionListSize = evaluated.length > 0 ? evaluated.length : matePool.length;
    const selectionKind = selectedMate && selectedMate.target ? selectionMode : 'legacy';

    let reproduced = false;
    const zoneParents = this.selectionManager
      ? this.selectionManager.validateReproductionArea({
          parentA: { row: parentRow, col: parentCol },
          parentB: { row: mateRow, col: mateCol },
        })
      : { allowed: true };

    let blockedInfo = null;

    if (!zoneParents.allowed) {
      blockedInfo = {
        reason: zoneParents.reason,
        parentA: { row: parentRow, col: parentCol },
        parentB: { row: mateRow, col: mateCol },
      };
    }

    if (
      !blockedInfo &&
      randomPercent(reproProb) &&
      cell.energy >= thrA &&
      bestMate.target.energy >= thrB
    ) {
      const candidates = [];
      const candidateSet = new Set();
      const addCandidate = (r, c) => {
        const wrappedRow = (r + this.rows) % this.rows;
        const wrappedCol = (c + this.cols) % this.cols;
        const key = `${wrappedRow},${wrappedCol}`;

        if (!candidateSet.has(key) && !this.isObstacle(wrappedRow, wrappedCol)) {
          candidateSet.add(key);
          candidates.push({ r: wrappedRow, c: wrappedCol });
        }
      };
      const addNeighbors = (baseRow, baseCol) => {
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            if (dr === 0 && dc === 0) continue;

            addCandidate(baseRow + dr, baseCol + dc);
          }
        }
      };

      addCandidate(originalParentRow, originalParentCol);
      if (moveSucceeded) addNeighbors(originalParentRow, originalParentCol);
      addCandidate(parentRow, parentCol);
      addCandidate(mateRow, mateCol);
      addNeighbors(parentRow, parentCol);
      addNeighbors(mateRow, mateCol);

      const freeSlots = candidates.filter(({ r, c }) => !this.grid[r][c] && !this.isObstacle(r, c));
      const eligibleSlots =
        this.selectionManager && freeSlots.length > 0 && this.selectionManager.hasActiveZones()
          ? freeSlots.filter(({ r, c }) => this.selectionManager.isInActiveZone(r, c))
          : freeSlots;
      const slotPool = eligibleSlots.length > 0 ? eligibleSlots : freeSlots;

      if (slotPool.length > 0) {
        const spawn = slotPool[Math.floor(randomRange(0, slotPool.length))];
        const zoneCheck = this.selectionManager
          ? this.selectionManager.validateReproductionArea({
              parentA: { row: parentRow, col: parentCol },
              parentB: { row: mateRow, col: mateCol },
              spawn: { row: spawn.r, col: spawn.c },
            })
          : { allowed: true };

        if (!zoneCheck.allowed) {
          blockedInfo = {
            reason: zoneCheck.reason,
            parentA: { row: parentRow, col: parentCol },
            parentB: { row: mateRow, col: mateCol },
            spawn: { row: spawn.r, col: spawn.c },
          };
        } else {
          const offspring = Cell.breed(cell, bestMate.target, mutationMultiplier, {
            maxTileEnergy: this.maxTileEnergy,
          });

          if (offspring) {
            offspring.row = spawn.r;
            offspring.col = spawn.c;
            this.grid[spawn.r][spawn.c] = offspring;
            stats.onBirth();
            reproduced = true;
          }
        }
      }
    }

    if (blockedInfo && stats?.recordReproductionBlocked) {
      stats.recordReproductionBlocked(blockedInfo);
    }

    if (stats?.recordMateChoice) {
      const similarity = bestMate.similarity ?? cell.similarityTo(bestMate.target);
      const diversity = bestMate.diversity ?? 1 - similarity;

      stats.recordMateChoice({
        similarity,
        diversity,
        appetite,
        bias,
        selectionMode: selectionKind,
        poolSize: selectionListSize,
        success: reproduced,
      });
    }

    return reproduced || Boolean(blockedInfo);
  }

  handleCombat(row, col, cell, { enemies, society = [] }, { stats, densityEffectMultiplier }) {
    if (!Array.isArray(enemies) || enemies.length === 0) return false;

    const targetEnemy = enemies[Math.floor(randomRange(0, enemies.length))];
    const localDensity = this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const action = cell.chooseInteractionAction({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies: society,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (action === 'avoid') {
      this.boundMoveAwayFromTarget(
        this.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        this.rows,
        this.cols
      );

      return true;
    }

    const dist = Math.max(Math.abs(targetEnemy.row - row), Math.abs(targetEnemy.col - col));

    if (action === 'fight') {
      if (dist <= 1) {
        cell.fightEnemy(this, row, col, targetEnemy.row, targetEnemy.col, stats);
      } else {
        this.boundMoveToTarget(
          this.grid,
          row,
          col,
          targetEnemy.row,
          targetEnemy.col,
          this.rows,
          this.cols
        );
      }

      return true;
    }

    if (dist <= 1)
      cell.cooperateWithEnemy(
        this,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        this.maxTileEnergy,
        stats
      );
    else
      this.boundMoveToTarget(
        this.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        this.rows,
        this.cols
      );

    return true;
  }

  handleMovement(
    row,
    col,
    cell,
    { mates, enemies, society },
    { densityGrid, densityEffectMultiplier }
  ) {
    const localDensity = densityGrid[row][col];

    cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || [], {
      localDensity,
      densityEffectMultiplier,
      rows: this.rows,
      cols: this.cols,
      moveToTarget: this.boundMoveToTarget,
      moveAwayFromTarget: this.boundMoveAwayFromTarget,
      moveRandomly: this.boundMoveRandomly,
      tryMove: this.boundTryMove,
      getEnergyAt: (rr, cc) => this.energyGrid[rr][cc] / this.maxTileEnergy,
      maxTileEnergy: this.maxTileEnergy,
      isTileBlocked: (rr, cc) => this.isTileBlocked(rr, cc),
    });
  }

  update({
    densityEffectMultiplier = 1,
    societySimilarity = 1,
    enemySimilarity = 0,
    eventStrengthMultiplier = 1,
    energyRegenRate = GridManager.energyRegenRate,
    energyDiffusionRate = GridManager.energyDiffusionRate,
    mutationMultiplier = 1,
  } = {}) {
    const stats = this.stats;
    const eventManager = this.eventManager;

    this.lastSnapshot = null;
    this.tickCount += 1;
    this.processScheduledObstacles();

    const { densityGrid } = this.prepareTick({
      eventManager,
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
    });

    this.densityGrid = densityGrid;
    const processed = new WeakSet();

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        this.processCell(row, col, {
          stats,
          eventManager,
          densityGrid,
          processed,
          densityEffectMultiplier,
          societySimilarity,
          enemySimilarity,
          eventStrengthMultiplier,
          mutationMultiplier,
        });
      }
    }

    this.lastSnapshot = this.buildSnapshot();

    return this.lastSnapshot;
  }

  buildSnapshot(maxTileEnergy) {
    const cap = typeof maxTileEnergy === 'number' ? maxTileEnergy : this.maxTileEnergy;
    const snapshot = {
      rows: this.rows,
      cols: this.cols,
      population: 0,
      totalEnergy: 0,
      totalAge: 0,
      maxFitness: 0,
      cells: [],
      entries: [],
    };

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.grid[row][col];

        if (!cell) continue;

        const fitness = computeFitness(cell, cap);
        const previous = Number.isFinite(cell.fitnessScore) ? cell.fitnessScore : fitness;
        const smoothed = previous * 0.8 + fitness * 0.2;

        cell.fitnessScore = smoothed;

        snapshot.population++;
        snapshot.totalEnergy += cell.energy;
        snapshot.totalAge += cell.age;
        snapshot.cells.push(cell);
        snapshot.entries.push({ row, col, cell, fitness, smoothedFitness: smoothed });
        if (fitness > snapshot.maxFitness) snapshot.maxFitness = fitness;
      }
    }

    const ranked = [...snapshot.entries].sort((a, b) => (b?.fitness ?? 0) - (a?.fitness ?? 0));

    snapshot.brainSnapshots = BrainDebugger.captureFromEntries(ranked, { limit: 5 });

    return snapshot;
  }

  getLastSnapshot() {
    if (!this.lastSnapshot) {
      this.lastSnapshot = this.buildSnapshot();
    }

    return this.lastSnapshot;
  }

  calculatePopulationDensity() {
    let population = 0;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.grid[row][col]) {
          population++;
        }
      }
    }

    return population / (this.rows * this.cols);
  }

  findTargets(
    row,
    col,
    cell,
    { densityEffectMultiplier = 1, societySimilarity = 1, enemySimilarity = 0 } = {}
  ) {
    const mates = [];
    const enemies = [];
    const society = [];
    const d =
      this.densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const effD = clamp(d * densityEffectMultiplier, 0, 1);
    let enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);
    // Modulate random enemy bias by DNA risk tolerance
    const risk = typeof cell.dna.riskTolerance === 'function' ? cell.dna.riskTolerance() : 0.5;

    enemyBias = Math.max(0, enemyBias * (0.4 + 0.8 * risk));
    const allyT =
      typeof cell.dna.allyThreshold === 'function' ? cell.dna.allyThreshold() : societySimilarity;
    const enemyT =
      typeof cell.dna.enemyThreshold === 'function' ? cell.dna.enemyThreshold() : enemySimilarity;

    for (let x = -cell.sight; x <= cell.sight; x++) {
      for (let y = -cell.sight; y <= cell.sight; y++) {
        if (x === 0 && y === 0) continue;
        const newRow = row + y;
        const newCol = col + x;

        if (newRow < 0 || newRow >= this.rows || newCol < 0 || newCol >= this.cols) continue;
        const target = this.grid[newRow][newCol];

        if (target) {
          const similarity = cell.similarityTo(target);

          const candidate = { row: newRow, col: newCol, target };

          if (similarity >= allyT) {
            const evaluated = cell.evaluateMateCandidate({
              ...candidate,
              classification: 'society',
            });

            if (evaluated) society.push(evaluated);
          } else if (similarity <= enemyT || randomPercent(enemyBias)) {
            enemies.push({ row: newRow, col: newCol, target });
          } else {
            const evaluated = cell.evaluateMateCandidate({ ...candidate, classification: 'mate' });

            if (evaluated) mates.push(evaluated);
          }
        }
      }
    }

    return { mates, enemies, society };
  }

  // Spawn a cluster of new cells around a center position
  burstAt(centerRow, centerCol, { count = 200, radius = 6 } = {}) {
    const coords = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const rr = centerRow + dy;
        const cc = centerCol + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        coords.push({ rr, cc });
      }
    }
    // Shuffle for random fill
    for (let i = coords.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = coords[i];

      coords[i] = coords[j];
      coords[j] = t;
    }
    let placed = 0;

    for (let i = 0; i < coords.length && placed < count; i++) {
      const { rr, cc } = coords[i];

      if (!this.grid[rr][cc] && !this.isObstacle(rr, cc)) {
        const dna = DNA.random();

        this.spawnCell(rr, cc, { dna, recordBirth: true });
        placed++;
      }
    }

    return placed;
  }

  // Choose a random center and burst there
  burstRandomCells(opts = {}) {
    const r = (Math.random() * this.rows) | 0;
    const c = (Math.random() * this.cols) | 0;

    return this.burstAt(r, c, opts);
  }
}

GridManager.OBSTACLE_PRESETS = OBSTACLE_PRESETS;
GridManager.OBSTACLE_SCENARIOS = OBSTACLE_SCENARIOS;
