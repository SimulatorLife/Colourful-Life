import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';
import { computeFitness } from './fitness.js';
import BrainDebugger from './brainDebugger.js';
import { isEventAffecting } from './eventManager.js';
import { getEventEffect } from './eventEffects.js';
import { forEachNeighbor } from './gridNeighbors.js';
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
      onMove = null,
      activeCells = null,
      onCellMoved = null,
    } = options;
    const nr = sr + dr;
    const nc = sc + dc;
    const moving = gridArr[sr]?.[sc] ?? null;

    if (!moving) {
      return false;
    }

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
      if (typeof onMove === 'function') {
        onMove({ cell: moving, fromRow: sr, fromCol: sc, toRow: nr, toCol: nc });
      }
      // Charge movement energy cost to the mover if available
      if (moving && typeof moving === 'object' && moving.energy != null && moving.dna) {
        const cost = typeof moving.dna.moveCost === 'function' ? moving.dna.moveCost() : 0.005;

        moving.energy = Math.max(0, moving.energy - cost);
      }

      if (typeof onCellMoved === 'function') {
        onCellMoved(moving, sr, sc, nr, nc);
      }
      if (activeCells && moving) {
        activeCells.add(moving);
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
    this.activeCells = new Set();
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
    this.densityRadius = GridManager.DENSITY_RADIUS;
    this.densityCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    this.densityLiveGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityDirtyTiles = new Set();
    this.lastSnapshot = null;
    this.lingerPenalty = 0;
    this.obstacleSchedules = [];
    this.currentObstaclePreset = 'none';
    this.currentScenarioId = 'manual';
    this.tickCount = 0;
    this.onMoveCallback = (payload) => this.#handleCellMoved(payload);
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
    this.recalculateDensityCounts();
    this.rebuildActiveCells();
  }

  #movementOptions() {
    return {
      obstacles: this.obstacles,
      lingerPenalty: this.lingerPenalty,
      penalizeOnBounds: true,
      onMove: this.onMoveCallback,
      activeCells: this.activeCells,
      onCellMoved: (cell) => {
        if (!cell) return;

        this.activeCells.add(cell);
      },
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
      if (!wasBlocked) {
        const occupant = this.grid[row][col];

        if (occupant) {
          if (evict) {
            const removed = this.removeCell(row, col);

            if (this.stats?.onDeath) this.stats.onDeath();
            if (removed) {
              this.energyGrid[row][col] = 0;
              this.energyNext[row][col] = 0;
            }
          } else {
            this.energyGrid[row][col] = 0;
            this.energyNext[row][col] = 0;
          }
        } else {
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

  _paintWallLine(
    axis,
    index,
    {
      spanStart = 0,
      spanEnd = axis === 'vertical' ? this.rows - 1 : this.cols - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {}
  ) {
    const isVertical = axis === 'vertical';
    const primaryLimit = isVertical ? this.rows : this.cols;
    const secondaryLimit = isVertical ? this.cols : this.rows;
    const normalizedStart = Math.max(0, Math.floor(spanStart));
    const normalizedEnd = Math.min(primaryLimit - 1, Math.floor(spanEnd));
    const thicknessValue = Math.max(1, Math.floor(thickness));

    for (let offset = 0; offset < thicknessValue; offset++) {
      const secondaryIndex = index + offset;

      if (secondaryIndex < 0 || secondaryIndex >= secondaryLimit) continue;
      for (let primary = normalizedStart; primary <= normalizedEnd; primary++) {
        if (gapEvery > 0) {
          const idx = primary - normalizedStart + gapOffset;

          if (idx % gapEvery === 0) continue;
        }

        if (isVertical) {
          this.setObstacle(primary, secondaryIndex, true, { evict });
        } else {
          this.setObstacle(secondaryIndex, primary, true, { evict });
        }
      }
    }
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
    this._paintWallLine('vertical', col, {
      spanStart: startRow,
      spanEnd: endRow,
      gapEvery,
      gapOffset,
      thickness,
      evict,
    });
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
    this._paintWallLine('horizontal', row, {
      spanStart: startCol,
      spanEnd: endCol,
      gapEvery,
      gapOffset,
      thickness,
      evict,
    });
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

  consumeEnergy(cell, row, col, densityGrid = this.densityGrid, densityEffectMultiplier = 1) {
    const available = this.energyGrid[row][col];
    // DNA-driven harvest with density penalty
    const baseRate = typeof cell.dna.forageRate === 'function' ? cell.dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density =
      densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
    const crowdPenalty = Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * effDensity);
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
    densityGrid = null,
    densityEffectMultiplier = 1
  ) {
    const maxE = this.maxTileEnergy;
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
        const e = this.energyGrid[r][c];
        // Logistic toward max
        let regen = R * (1 - e / maxE);
        let drain = 0;

        // Density reduces local regen (overgrazing effect)
        const density = densityGrid
          ? densityGrid[r][c]
          : this.localDensity(r, c, GridManager.DENSITY_RADIUS);
        const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);

        regen *= Math.max(0, 1 - REGEN_DENSITY_PENALTY * effDensity);

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

        if (r > 0 && !this.isObstacle(r - 1, c)) {
          neighSum += this.energyGrid[r - 1][c];
          neighCount++;
        }
        if (r < this.rows - 1 && !this.isObstacle(r + 1, c)) {
          neighSum += this.energyGrid[r + 1][c];
          neighCount++;
        }
        if (c > 0 && !this.isObstacle(r, c - 1)) {
          neighSum += this.energyGrid[r][c - 1];
          neighCount++;
        }
        if (c < this.cols - 1 && !this.isObstacle(r, c + 1)) {
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
    if (!cell) {
      this.removeCell(row, col);

      return null;
    }

    return this.placeCell(row, col, cell);
  }

  clearCell(row, col) {
    this.removeCell(row, col);
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

  #handleCellMoved({ fromRow, fromCol, toRow, toCol }) {
    this.#applyDensityDelta(fromRow, fromCol, -1);
    this.#applyDensityDelta(toRow, toCol, 1);
  }

  #applyDensityDelta(row, col, delta, radius = this.densityRadius) {
    if (!this.densityCounts) return;

    const totals = this.densityTotals;
    const liveGrid = this.densityLiveGrid;

    forEachNeighbor(row, col, radius, this.rows, this.cols, (rr, cc) => {
      const countsRow = this.densityCounts[rr];
      const nextCount = (countsRow[cc] ?? 0) + delta;

      countsRow[cc] = nextCount;

      if (!liveGrid || !totals) return;

      const total = totals[rr]?.[cc] ?? 0;
      const nextDensity = total > 0 ? clamp(nextCount / total, 0, 1) : 0;

      if (liveGrid[rr][cc] !== nextDensity) {
        liveGrid[rr][cc] = nextDensity;
        this.#markDensityDirty(rr, cc);
      }
    });
  }

  #computeNeighborTotal(row, col, radius = this.densityRadius) {
    let total = 0;

    forEachNeighbor(row, col, radius, this.rows, this.cols, () => {
      total += 1;
    });

    return total;
  }

  #buildDensityTotals(radius = this.densityRadius) {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.#computeNeighborTotal(r, c, radius))
    );
  }

  #markDensityDirty(row, col) {
    if (!this.densityDirtyTiles) this.densityDirtyTiles = new Set();

    this.densityDirtyTiles.add(row * this.cols + col);
  }

  #syncDensitySnapshot(force = false) {
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

    this.#syncDensitySnapshot(true);
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
    if (this.densityGrid?.[row]?.[col] != null) {
      return this.densityGrid[row][col];
    }

    return this.localDensity(row, col, this.densityRadius);
  }

  // Precompute density for all tiles (fraction of occupied neighbors)
  #countNeighbors(row, col, radius = GridManager.DENSITY_RADIUS) {
    let count = 0;
    let total = 0;

    forEachNeighbor(row, col, radius, this.rows, this.cols, (rr, cc) => {
      total += 1;
      if (this.grid[rr][cc]) count += 1;
    });

    return { count, total };
  }

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    const useCache =
      radius === this.densityRadius &&
      this.densityCounts &&
      this.densityTotals &&
      this.densityLiveGrid;

    if (useCache) {
      this.#syncDensitySnapshot();

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

    let count = 0;
    let total = 0;

    forEachNeighbor(row, col, radius, this.rows, this.cols, (rr, cc) => {
      total += 1;
      if (this.grid[rr][cc]) count += 1;
    });

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

  prepareTick({
    eventManager,
    eventStrengthMultiplier,
    energyRegenRate,
    energyDiffusionRate,
    densityEffectMultiplier = 1,
  }) {
    this.#syncDensitySnapshot();

    const densityGrid = this.densityGrid;

    this.regenerateEnergyGrid(
      eventManager.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityGrid,
      densityEffectMultiplier
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
      this.removeCell(row, col);
      stats.onDeath();

      return;
    }

    const events = eventManager.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, this.maxTileEnergy);
    }

    this.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);
    const localDensity = densityGrid[row][col];

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (starved || cell.energy <= 0) {
      this.removeCell(row, col);
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

    if (
      this.handleCombat(row, col, cell, targets, {
        stats,
        densityEffectMultiplier,
        densityGrid,
      })
    ) {
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

    const densitySourceRow = moveSucceeded ? parentRow : originalParentRow;
    const densitySourceCol = moveSucceeded ? parentCol : originalParentCol;
    let localDensity = densityGrid?.[densitySourceRow]?.[densitySourceCol];

    if (localDensity == null) {
      localDensity = this.getDensityAt(densitySourceRow, densitySourceCol);
    }
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
        if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;

        const key = `${r},${c}`;

        if (!candidateSet.has(key) && !this.isObstacle(r, c)) {
          candidateSet.add(key);
          candidates.push({ r, c });
        }
      };
      const addNeighbors = (baseRow, baseCol) => {
        forEachNeighbor(baseRow, baseCol, 1, this.rows, this.cols, (rr, cc) => {
          addCandidate(rr, cc);
        });
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
            this.setCell(spawn.r, spawn.c, offspring);
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

    return reproduced;
  }

  handleCombat(
    row,
    col,
    cell,
    { enemies, society = [] },
    { stats, densityEffectMultiplier, densityGrid }
  ) {
    if (!Array.isArray(enemies) || enemies.length === 0) return false;

    const targetEnemy = enemies[Math.floor(randomRange(0, enemies.length))];
    const localDensity = densityGrid?.[row]?.[col] ?? this.getDensityAt(row, col);
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
      densityEffectMultiplier,
    });

    this.densityGrid = densityGrid;
    const processed = new WeakSet();
    const activeSnapshot = Array.from(this.activeCells);

    for (const cell of activeSnapshot) {
      if (!cell) continue;
      const row = cell.row;
      const col = cell.col;

      if (
        row == null ||
        col == null ||
        row < 0 ||
        row >= this.rows ||
        col < 0 ||
        col >= this.cols ||
        this.grid[row][col] !== cell
      ) {
        continue;
      }

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
