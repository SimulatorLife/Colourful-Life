import DNA from '../genome.js';
import Cell from '../cell.js';
import InteractionSystem from '../interactionSystem.js';
import GridState from './gridState.js';
import PopulationSystem from './populationSystem.js';
import GridRenderer from './gridRenderer.js';
import SnapshotService from '../snapshotService.js';
import { clamp, randomRange } from '../utils.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
} from '../config.js';

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
  {
    id: 'sealed-quadrants',
    label: 'Sealed Quadrants',
    description: 'Thick cross-shaped walls isolate four distinct quadrants.',
  },
  {
    id: 'sealed-chambers',
    label: 'Sealed Chambers',
    description: 'Grid partitions create multiple closed rectangular chambers.',
  },
  {
    id: 'corner-islands',
    label: 'Corner Islands',
    description: 'Four isolated pockets carved out of a blocked landscape.',
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

export default class GridController {
  constructor(
    rows,
    cols,
    {
      eventManager,
      ctx = null,
      cellSize = 8,
      stats,
      maxTileEnergy,
      selectionManager,
      initialObstaclePreset = 'none',
      initialObstaclePresetOptions = {},
      randomizeInitialObstacles = false,
      randomObstaclePresetPool = null,
      rng,
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.eventManager =
      eventManager || (typeof window !== 'undefined' ? window.eventManager : null);
    this.ctx = ctx || (typeof window !== 'undefined' ? window.ctx : null);
    this.cellSize = cellSize || (typeof window !== 'undefined' ? window.cellSize : 8);
    this.stats = stats || (typeof window !== 'undefined' ? window.stats : null);
    this.selectionManager = selectionManager || null;
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.tickCount = 0;
    this.obstacleSchedules = [];
    this.currentObstaclePreset = 'none';
    this.currentScenarioId = 'manual';

    this.gridState = new GridState(rows, cols, { maxTileEnergy });
    const linkState = (prop) => {
      Object.defineProperty(this, prop, {
        get: () => this.gridState[prop],
        set: (value) => {
          this.gridState[prop] = value;
        },
        configurable: true,
        enumerable: true,
      });
    };

    linkState('grid');
    linkState('energyGrid');
    linkState('energyNext');
    linkState('obstacles');
    linkState('activeCells');
    linkState('densityGrid');
    linkState('densityCounts');
    linkState('densityTotals');
    linkState('densityLiveGrid');
    linkState('densityDirtyTiles');
    Object.defineProperty(this, 'maxTileEnergy', {
      get: () => this.gridState.maxTileEnergy,
      set: (value) => {
        if (Number.isFinite(value)) this.gridState.maxTileEnergy = value;
      },
      configurable: true,
      enumerable: true,
    });

    this.interactionSystem = new InteractionSystem({ gridState: this.gridState });
    this.populationSystem = new PopulationSystem({
      gridState: this.gridState,
      interactionSystem: this.interactionSystem,
      selectionManager: this.selectionManager,
      stats: this.stats,
      rng: this.rng,
    });
    this._populationProcessCell = this.populationSystem.processCell.bind(this.populationSystem);
    this._populationHandleReproduction = this.populationSystem.handleReproduction.bind(
      this.populationSystem
    );
    this._populationHandleCombat = this.populationSystem.handleCombat.bind(this.populationSystem);
    this._populationHandleMovement = this.populationSystem.handleMovement.bind(
      this.populationSystem
    );
    this._populationFindTargets = this.populationSystem.findTargets.bind(this.populationSystem);
    this.snapshotService = new SnapshotService({ stats: this.stats });
    this.renderer = new GridRenderer({ ctx: this.ctx, cellSize: this.cellSize });

    this.lingerPenalty = 0;
    this.populationSystem.setLingerPenalty(this.lingerPenalty);
    this.onMoveCallback = (payload) => this.#handleCellMoved(payload);
    this.boundTryMove = (gridArr, sr, sc, dr, dc, rows, cols) =>
      this.populationSystem.tryMove(gridArr, sr, sc, dr, dc, rows, cols, this.#movementOptions());
    this.boundMoveToTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      this.populationSystem.moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols);
    this.boundMoveAwayFromTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      this.populationSystem.moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols);
    this.boundMoveRandomly = (gridArr, row, col, cell, rows, cols) =>
      this.populationSystem.moveRandomly(gridArr, row, col, cell, rows, cols);

    const initialThreshold =
      typeof this.stats?.matingDiversityThreshold === 'number'
        ? clamp(this.stats.matingDiversityThreshold, 0, 1)
        : 0.45;

    this.populationSystem.setMatingDiversityOptions({
      threshold: initialThreshold,
      lowDiversityMultiplier:
        typeof this.stats?.lowDiversityReproMultiplier === 'number'
          ? clamp(this.stats.lowDiversityReproMultiplier, 0, 1)
          : 0.1,
    });

    const resolvedPresetId = this.#resolveInitialObstaclePreset({
      initialPreset: initialObstaclePreset,
      randomize: randomizeInitialObstacles,
      pool: randomObstaclePresetPool,
    });

    if (resolvedPresetId && resolvedPresetId !== 'none') {
      const presetOptions = this.#resolvePresetOptions(
        resolvedPresetId,
        initialObstaclePresetOptions
      );

      this.applyObstaclePreset(resolvedPresetId, {
        clearExisting: true,
        append: false,
        presetOptions,
        evict: true,
      });
    }

    this.init();
    this.gridState.recalculateDensityCounts();
    this.gridState.rebuildActiveCells();
  }

  static get energyRegenRate() {
    return GridState.energyRegenRate;
  }

  static set energyRegenRate(value) {
    GridState.energyRegenRate = value ?? ENERGY_REGEN_RATE_DEFAULT;
  }

  static get energyDiffusionRate() {
    return GridState.energyDiffusionRate;
  }

  static set energyDiffusionRate(value) {
    GridState.energyDiffusionRate = value ?? ENERGY_DIFFUSION_RATE_DEFAULT;
  }

  static get DENSITY_RADIUS() {
    return GridState.DENSITY_RADIUS;
  }

  static set DENSITY_RADIUS(value) {
    GridState.DENSITY_RADIUS = value ?? DENSITY_RADIUS_DEFAULT;
  }

  static get maxTileEnergy() {
    return GridState.maxTileEnergy ?? MAX_TILE_ENERGY;
  }

  static set maxTileEnergy(value) {
    GridState.maxTileEnergy = Number.isFinite(value) ? value : MAX_TILE_ENERGY;
  }

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
    const moving = gridArr?.[sr]?.[sc] ?? null;

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

      const ageScale =
        typeof moving.ageEnergyMultiplier === 'function' ? moving.ageEnergyMultiplier(0.4) : 1;

      moving.energy = Math.max(0, moving.energy - amount * scale * ageScale);
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

    const dcell = gridArr?.[nr]?.[nc];

    if (!dcell) {
      gridArr[nr][nc] = moving;
      if (gridArr?.[sr]) gridArr[sr][sc] = null;
      if (moving && typeof moving === 'object') {
        if ('row' in moving) moving.row = nr;
        if ('col' in moving) moving.col = nc;
      }
      if (typeof onMove === 'function') {
        onMove({ cell: moving, fromRow: sr, fromCol: sc, toRow: nr, toCol: nc });
      }
      if (moving && typeof moving === 'object' && moving.energy != null && moving.dna) {
        const baseCost = typeof moving.dna.moveCost === 'function' ? moving.dna.moveCost() : 0.005;
        const ageScale =
          typeof moving.ageEnergyMultiplier === 'function' ? moving.ageEnergyMultiplier(0.6) : 1;
        const cost = baseCost * ageScale;

        moving.energy = Math.max(0, moving.energy - cost);
      }

      if (activeCells && typeof activeCells.add === 'function') {
        activeCells.add(moving);
      }
      if (typeof onCellMoved === 'function') {
        onCellMoved(moving, sr, sc, nr, nc);
      }

      clearWallPenalty();

      return true;
    }

    return false;
  }

  static moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0;
    let dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return GridController.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0;
    let dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
    else dc = -Math.sign(dCol);

    return GridController.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveRandomly(gridArr, row, col, cell, rows, cols, options = {}) {
    const { dr, dc } = cell.decideRandomMove();

    return GridController.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
    this.populationSystem.setSelectionManager(this.selectionManager);
  }

  setLingerPenalty(value = 0) {
    this.lingerPenalty = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
    this.populationSystem.setLingerPenalty(this.lingerPenalty);
  }

  setMatingDiversityOptions({ threshold, lowDiversityMultiplier } = {}) {
    this.populationSystem.setMatingDiversityOptions({
      threshold,
      lowDiversityMultiplier,
    });
  }

  get matingDiversityThreshold() {
    return this.populationSystem.matingDiversityThreshold;
  }

  get lowDiversityReproMultiplier() {
    return this.populationSystem.lowDiversityReproMultiplier;
  }

  #movementOptions() {
    return {
      obstacles: this.gridState.obstacles,
      lingerPenalty: this.lingerPenalty,
      penalizeOnBounds: true,
      onMove: this.onMoveCallback,
      activeCells: this.activeCells,
      onCellMoved: (cell, fromRow, fromCol, toRow, toCol) =>
        this.#handleCellMoved({ cell, fromRow, fromCol, toRow, toCol }),
    };
  }

  #handleCellMoved({ fromRow, fromCol, toRow, toCol }) {
    if (fromRow === toRow && fromCol === toCol) return;
    this.gridState.syncDensitySnapshot();
  }

  getCell(row, col) {
    return this.gridState.getCell(row, col);
  }

  setCell(row, col, cell) {
    return this.gridState.setCell(row, col, cell);
  }

  processCell(row, col, context) {
    const originals = {
      handleReproduction: this.populationSystem.handleReproduction,
      handleCombat: this.populationSystem.handleCombat,
      handleMovement: this.populationSystem.handleMovement,
      findTargets: this.populationSystem.findTargets,
    };

    try {
      this.populationSystem.handleReproduction = (...args) => this.handleReproduction(...args);
      this.populationSystem.handleCombat = (...args) => this.handleCombat(...args);
      this.populationSystem.handleMovement = (...args) => this.handleMovement(...args);
      this.populationSystem.findTargets = (...args) => this.findTargets(...args);

      return this._populationProcessCell(row, col, context);
    } finally {
      this.populationSystem.handleReproduction = originals.handleReproduction;
      this.populationSystem.handleCombat = originals.handleCombat;
      this.populationSystem.handleMovement = originals.handleMovement;
      this.populationSystem.findTargets = originals.findTargets;
    }
  }

  handleReproduction(...args) {
    return this._populationHandleReproduction(...args);
  }

  handleCombat(...args) {
    return this._populationHandleCombat(...args);
  }

  handleMovement(...args) {
    return this._populationHandleMovement(...args);
  }

  findTargets(...args) {
    return this._populationFindTargets(...args);
  }

  clearCell(row, col) {
    this.gridState.removeCell(row, col);
  }

  placeCell(row, col, cell) {
    return this.gridState.placeCell(row, col, cell);
  }

  removeCell(row, col) {
    return this.gridState.removeCell(row, col);
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    return this.gridState.relocateCell(fromRow, fromCol, toRow, toCol);
  }

  rebuildActiveCells() {
    this.gridState.rebuildActiveCells();
    this.activeCells = this.gridState.activeCells;
  }

  consumeEnergy(...args) {
    return this.gridState.consumeEnergy(...args);
  }

  regenerateEnergyGrid(...args) {
    const result = this.gridState.regenerateEnergyGrid(...args);

    this.energyGrid = this.gridState.energyGrid;
    this.energyNext = this.gridState.energyNext;

    return result;
  }

  getDensityAt(row, col) {
    return this.gridState.getDensityAt(row, col);
  }

  computeDensityGrid(radius) {
    return this.gridState.computeDensityGrid(radius);
  }

  localDensity(row, col, radius) {
    return this.gridState.localDensity(row, col, radius);
  }

  recalculateDensityCounts(radius) {
    this.gridState.recalculateDensityCounts(radius);
    this.densityGrid = this.gridState.densityGrid;
    this.densityCounts = this.gridState.densityCounts;
    this.densityTotals = this.gridState.densityTotals;
    this.densityLiveGrid = this.gridState.densityLiveGrid;
    this.densityDirtyTiles = this.gridState.densityDirtyTiles;
  }

  syncDensitySnapshot(force = false) {
    this.gridState.syncDensitySnapshot(force);
    this.densityGrid = this.gridState.densityGrid;
    this.densityCounts = this.gridState.densityCounts;
    this.densityTotals = this.gridState.densityTotals;
    this.densityLiveGrid = this.gridState.densityLiveGrid;
    this.densityDirtyTiles = this.gridState.densityDirtyTiles;
  }

  isObstacle(row, col) {
    return this.gridState.isObstacle(row, col);
  }

  isTileBlocked(row, col) {
    return this.gridState.isTileBlocked(row, col);
  }

  clearObstacles() {
    this.gridState.clearObstacles();
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    const previous = this.gridState.obstacles[row]?.[col];
    const result = this.gridState.setObstacle(row, col, blocked, { evict });

    if (blocked && !previous && evict) {
      const occupant = this.grid[row]?.[col];

      if (occupant) {
        this.removeCell(row, col);
        this.stats?.onDeath?.();
        this.energyGrid[row][col] = 0;
        this.energyNext[row][col] = 0;
      }
    }

    return result;
  }

  #random() {
    return typeof this.rng === 'function' ? this.rng() : Math.random();
  }

  #getPresetById(id) {
    if (typeof id !== 'string') return null;

    return OBSTACLE_PRESETS.find((preset) => preset.id === id) ?? null;
  }

  #pickRandomObstaclePresetId(poolIds = null) {
    let candidates = OBSTACLE_PRESETS;

    if (Array.isArray(poolIds) && poolIds.length > 0) {
      const normalized = poolIds.map((id) => this.#getPresetById(id)).filter(Boolean);

      if (normalized.length > 0) candidates = normalized;
    }

    if (!candidates || candidates.length === 0) return null;
    const index = Math.floor(this.#random() * candidates.length);

    return candidates[index]?.id ?? null;
  }

  #resolveInitialObstaclePreset({ initialPreset, randomize = false, pool = null } = {}) {
    if (randomize || initialPreset === 'random') {
      return this.#pickRandomObstaclePresetId(pool);
    }

    if (typeof initialPreset === 'string') {
      const match = this.#getPresetById(initialPreset);

      return match ? match.id : null;
    }

    return null;
  }

  #resolvePresetOptions(presetId, presetOptionsInput) {
    if (!presetId) return {};
    if (typeof presetOptionsInput === 'function') {
      const result = presetOptionsInput(presetId);

      return result && typeof result === 'object' ? result : {};
    }

    if (
      presetOptionsInput &&
      typeof presetOptionsInput === 'object' &&
      !Array.isArray(presetOptionsInput)
    ) {
      if (Object.prototype.hasOwnProperty.call(presetOptionsInput, presetId)) {
        const scoped = presetOptionsInput[presetId];

        return scoped && typeof scoped === 'object' ? scoped : {};
      }

      return presetOptionsInput;
    }

    return {};
  }

  paintVerticalWall(index, options = {}) {
    return this.#paintWallLine('vertical', index, options);
  }

  paintHorizontalWall(index, options = {}) {
    return this.#paintWallLine('horizontal', index, options);
  }

  paintPerimeter({ thickness = 1, evict = true } = {}) {
    const t = Math.max(1, Math.floor(thickness));

    for (let r = 0; r < this.rows; r++) {
      for (let k = 0; k < t; k++) {
        this.setObstacle(r, k, true, { evict });
        this.setObstacle(r, this.cols - 1 - k, true, { evict });
      }
    }
    for (let c = 0; c < this.cols; c++) {
      for (let k = 0; k < t; k++) {
        this.setObstacle(k, c, true, { evict });
        this.setObstacle(this.rows - 1 - k, c, true, { evict });
      }
    }
  }

  #paintWallLine(
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
        const shouldSkip =
          gapEvery > 0 && (primary - normalizedStart + gapOffset) % Math.max(1, gapEvery) === 0;

        if (shouldSkip) continue;

        if (isVertical) this.setObstacle(primary, secondaryIndex, true, { evict });
        else this.setObstacle(secondaryIndex, primary, true, { evict });
      }
    }
  }

  applyObstaclePreset(
    presetId,
    { clearExisting = true, append = false, presetOptions = {}, evict = true } = {}
  ) {
    if (clearExisting) this.clearObstacles();
    const options = presetOptions || {};

    switch (presetId) {
      case 'none':
        this.currentObstaclePreset = 'none';

        return;
      case 'midline': {
        const gapEvery = Math.max(2, Math.floor(options.gapEvery ?? 8));
        const offset = Math.max(0, Math.floor(options.gapOffset ?? 0));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const col = Math.floor(this.cols / 2) - Math.floor(thickness / 2);

        this.#paintWallLine('vertical', col, {
          spanStart: 0,
          spanEnd: this.rows - 1,
          gapEvery,
          gapOffset: offset,
          thickness,
          evict,
        });
        break;
      }
      case 'corridor': {
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 0));
        const gapOffset = Math.max(0, Math.floor(options.gapOffset ?? 0));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const spacing = Math.max(
          4,
          Math.floor(options.spacing ?? Math.max(4, Math.floor(this.cols / 3)))
        );
        const start = Math.floor((this.cols - spacing * 3) / 2);

        for (let i = 1; i <= 2; i++) {
          const col = start + i * spacing;

          this.#paintWallLine('vertical', col, {
            spanStart: 0,
            spanEnd: this.rows - 1,
            gapEvery,
            gapOffset,
            thickness,
            evict,
          });
        }
        break;
      }
      case 'checkerboard': {
        const tileSize = Math.max(1, Math.floor(options.tileSize ?? 4));

        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            const shouldFill = Math.floor(r / tileSize) % 2 === Math.floor(c / tileSize) % 2;

            if (shouldFill) this.setObstacle(r, c, true, { evict });
          }
        }
        break;
      }
      case 'perimeter': {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 2));

        this.paintPerimeter({ thickness, evict });
        break;
      }
      case 'sealed-quadrants': {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 2));
        const row = Math.floor(this.rows / 2);
        const col = Math.floor(this.cols / 2);

        this.#paintWallLine('horizontal', row, { thickness, evict });
        this.#paintWallLine('vertical', col, { thickness, evict });
        if (options.perimeter) {
          this.paintPerimeter({ thickness: Math.max(1, Math.floor(options.perimeter)), evict });
        }
        break;
      }
      case 'sealed-chambers': {
        const rows = Math.max(2, Math.floor(options.rows ?? 3));
        const cols = Math.max(2, Math.floor(options.cols ?? 3));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const rowStep = Math.max(1, Math.floor(this.rows / rows));
        const colStep = Math.max(1, Math.floor(this.cols / cols));

        for (let r = 1; r < rows; r++) {
          const rowIndex = Math.min(this.rows - 1, r * rowStep);

          this.paintHorizontalWall(rowIndex, { thickness, evict });
        }

        for (let c = 1; c < cols; c++) {
          const colIndex = Math.min(this.cols - 1, c * colStep);

          this.paintVerticalWall(colIndex, { thickness, evict });
        }

        if (options.perimeter !== false) {
          const perimeterThickness = Math.max(1, Math.floor(options.perimeter ?? thickness));

          this.paintPerimeter({ thickness: perimeterThickness, evict });
        }
        break;
      }
      case 'corner-islands': {
        const moat = Math.max(1, Math.floor(options.moat ?? 3));
        const gapRows = Math.max(moat, Math.floor(options.gapRows ?? moat));
        const gapCols = Math.max(moat, Math.floor(options.gapCols ?? moat));
        const maxIslandRows = Math.max(3, this.rows - 3 * gapRows);
        const maxIslandCols = Math.max(3, this.cols - 3 * gapCols);
        const islandRows = Math.max(
          3,
          Math.min(Math.floor(options.islandRows ?? maxIslandRows / 2), maxIslandRows)
        );
        const islandCols = Math.max(
          3,
          Math.min(Math.floor(options.islandCols ?? maxIslandCols / 2), maxIslandCols)
        );
        const carve = (startRow, startCol) => {
          const endRow = Math.min(this.rows - 1, startRow + islandRows - 1);
          const endCol = Math.min(this.cols - 1, startCol + islandCols - 1);

          for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
              if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
              this.setObstacle(r, c, false, { evict: false });
              this.energyGrid[r][c] = this.gridState.maxTileEnergy / 2;
              this.energyNext[r][c] = 0;
            }
          }
        };

        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            this.setObstacle(r, c, true, { evict });
          }
        }

        const topStart = Math.max(0, gapRows);
        const leftStart = Math.max(0, gapCols);
        const rightStart = Math.max(0, this.cols - gapCols - islandCols);
        const bottomStart = Math.max(0, this.rows - gapRows - islandRows);
        const safeTop = Math.min(topStart, this.rows - islandRows);
        const safeBottom = Math.min(bottomStart, this.rows - islandRows);
        const safeLeft = Math.min(leftStart, this.cols - islandCols);
        const safeRight = Math.min(rightStart, this.cols - islandCols);

        carve(safeTop, safeLeft);
        carve(safeTop, safeRight);
        carve(safeBottom, safeLeft);
        carve(safeBottom, safeRight);
        break;
      }
      default:
        break;
    }

    if (!append) this.currentObstaclePreset = presetId;
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
        if (this.#random() < 0.05) {
          const dna = DNA.random();

          this.spawnCell(row, col, { dna });
        }
      }
    }
  }

  spawnCell(row, col, { dna = DNA.random(), spawnEnergy, recordBirth = false } = {}) {
    if (this.isObstacle(row, col)) return null;
    const energy = Math.min(this.gridState.maxTileEnergy, spawnEnergy ?? this.energyGrid[row][col]);
    const cell = new Cell(row, col, dna, energy);

    this.setCell(row, col, cell);
    this.energyGrid[row][col] = 0;

    if (recordBirth) this.stats?.onBirth?.(cell);

    return cell;
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
      const idx = empty.length > 0 ? Math.floor(this.#random() * empty.length) : 0;
      const { r, c } = empty.splice(idx, 1)[0];
      const dna = DNA.random();

      this.spawnCell(r, c, { dna });
    }
  }

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

    for (let i = coords.length - 1; i > 0; i--) {
      const j = (this.#random() * (i + 1)) | 0;
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

  burstRandomCells(opts = {}) {
    const r = (this.#random() * this.rows) | 0;
    const c = (this.#random() * this.cols) | 0;

    return this.burstAt(r, c, opts);
  }

  prepareTick({
    eventManager,
    eventStrengthMultiplier,
    energyRegenRate,
    energyDiffusionRate,
    densityEffectMultiplier = 1,
  }) {
    this.syncDensitySnapshot();

    const densityGrid = this.densityGrid;

    this.regenerateEnergyGrid(
      eventManager?.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityGrid,
      densityEffectMultiplier
    );

    this.densityGrid = densityGrid;

    return { densityGrid };
  }

  update({
    densityEffectMultiplier = 1,
    societySimilarity = 1,
    enemySimilarity = 0,
    eventStrengthMultiplier = 1,
    energyRegenRate = GridController.energyRegenRate,
    energyDiffusionRate = GridController.energyDiffusionRate,
    mutationMultiplier = 1,
    matingDiversityThreshold,
    lowDiversityReproMultiplier,
  } = {}) {
    const stats = this.stats;
    const eventManager = this.eventManager;

    this.setMatingDiversityOptions({
      threshold:
        matingDiversityThreshold !== undefined
          ? matingDiversityThreshold
          : stats?.matingDiversityThreshold,
      lowDiversityMultiplier: lowDiversityReproMultiplier,
    });

    this.tickCount += 1;
    this.processScheduledObstacles();

    const { densityGrid } = this.prepareTick({
      eventManager,
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityEffectMultiplier,
    });

    const processed = new WeakSet();
    const activeSnapshot = this.gridState.getActiveCellsSnapshot();

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

      this.populationSystem.processCell(row, col, {
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

    const snapshot = this.snapshotService.capture({
      gridState: this.gridState,
      maxTileEnergy: this.gridState.maxTileEnergy,
    });

    this.lastSnapshot = snapshot;

    return snapshot;
  }

  getSnapshot() {
    return this.snapshotService.capture({
      gridState: this.gridState,
      maxTileEnergy: this.gridState.maxTileEnergy,
    });
  }

  getLastSnapshot() {
    return this.snapshotService.getLastSnapshot({
      gridState: this.gridState,
      maxTileEnergy: this.gridState.maxTileEnergy,
    });
  }

  buildSnapshot(maxTileEnergy) {
    const snapshot = this.snapshotService.buildSnapshot({
      gridState: this.gridState,
      maxTileEnergy,
    });

    this.lastSnapshot = snapshot;

    return snapshot;
  }

  draw({ showObstacles = true } = {}) {
    this.renderer.draw({ gridState: this.gridState, showObstacles });
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
}

GridController.OBSTACLE_PRESETS = OBSTACLE_PRESETS;
GridController.OBSTACLE_SCENARIOS = OBSTACLE_SCENARIOS;
