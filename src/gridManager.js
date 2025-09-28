import { randomRange, randomPercent } from './utils.js';
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
} from './config.js';
import EnvironmentSystem from './environmentSystem.js';
import ObstacleSystem, { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from './obstacleSystem.js';
import OrganismSystem from './organismSystem.js';

export default class GridManager {
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
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
    let dr = 0;
    let dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0;
    let dc = 0;

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
    {
      eventManager,
      ctx = null,
      cellSize = 8,
      stats,
      maxTileEnergy,
      selectionManager,
      environmentSystem,
      obstacleSystem,
      organismSystem,
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.maxTileEnergy =
      typeof maxTileEnergy === 'number' ? maxTileEnergy : GridManager.maxTileEnergy;
    this.activeCells = new Set();
    this.eventManager = eventManager || window.eventManager;
    this.ctx = ctx || window.ctx;
    this.cellSize = cellSize || window.cellSize || 8;
    this.stats = stats || window.stats;
    this.selectionManager = selectionManager || null;
    this.lingerPenalty = 0;
    this.tickCount = 0;
    this.lastSnapshot = null;

    const environment =
      environmentSystem ||
      new EnvironmentSystem(rows, cols, {
        maxTileEnergy: this.maxTileEnergy,
        densityRadius: GridManager.DENSITY_RADIUS,
        isEventAffecting,
        getEventEffect,
      });

    if (
      (typeof environment.rows === 'number' && environment.rows !== rows) ||
      (typeof environment.cols === 'number' && environment.cols !== cols)
    ) {
      throw new Error('EnvironmentSystem dimensions must match the grid.');
    }

    this.environment = environment;
    this.environment.setCellGrid(this.grid);
    if (typeof this.environment.setMaxTileEnergy === 'function') {
      this.environment.setMaxTileEnergy(this.maxTileEnergy);
    }

    this.boundTryMove = (gridArr, sr, sc, dr, dc, rowsArg, colsArg) =>
      GridManager.tryMove(gridArr, sr, sc, dr, dc, rowsArg, colsArg, this.#movementOptions());
    this.boundMoveToTarget = (gridArr, row, col, targetRow, targetCol, rowsArg, colsArg) =>
      GridManager.moveToTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rowsArg,
        colsArg,
        this.#movementOptions()
      );
    this.boundMoveAwayFromTarget = (gridArr, row, col, targetRow, targetCol, rowsArg, colsArg) =>
      GridManager.moveAwayFromTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rowsArg,
        colsArg,
        this.#movementOptions()
      );
    this.boundMoveRandomly = (gridArr, row, col, cell, rowsArg, colsArg) =>
      GridManager.moveRandomly(gridArr, row, col, cell, rowsArg, colsArg, this.#movementOptions());

    const obstacleHandlers = {
      onTileBlocked: ({ row, col, evict }) => this.#handleObstaclePlaced(row, col, evict),
      onTileCleared: ({ row, col }) => this.environment.clearEnergyAt(row, col),
    };

    const obstacles =
      obstacleSystem ||
      new ObstacleSystem(rows, cols, {
        onTileBlocked: obstacleHandlers.onTileBlocked,
        onTileCleared: obstacleHandlers.onTileCleared,
      });

    if (
      (typeof obstacles.rows === 'number' && obstacles.rows !== rows) ||
      (typeof obstacles.cols === 'number' && obstacles.cols !== cols)
    ) {
      throw new Error('ObstacleSystem dimensions must match the grid.');
    }

    if (typeof obstacles.setCallbacks === 'function') {
      obstacles.setCallbacks(obstacleHandlers);
    } else {
      obstacles.onTileBlocked = obstacleHandlers.onTileBlocked;
      obstacles.onTileCleared = obstacleHandlers.onTileCleared;
    }

    this.obstacles = obstacles;

    const organisms = organismSystem || new OrganismSystem();

    this.organisms = organisms;
    this.organisms.configure({
      grid: this.grid,
      rows: this.rows,
      cols: this.cols,
      environment: this.environment,
      obstacles: this.obstacles,
      stats: this.stats,
      selectionManager: this.selectionManager,
      movement: {
        moveToTarget: this.boundMoveToTarget,
        moveAwayFromTarget: this.boundMoveAwayFromTarget,
        moveRandomly: this.boundMoveRandomly,
        tryMove: this.boundTryMove,
      },
      setCell: (row, col, cell) => this.setCell(row, col, cell),
      removeCell: (row, col) => this.removeCell(row, col),
      relocateCell: (fromRow, fromCol, toRow, toCol) =>
        this.relocateCell(fromRow, fromCol, toRow, toCol),
      maxTileEnergy: this.maxTileEnergy,
      findTargets: (row, col, cell, options) => this.findTargets(row, col, cell, options),
      consumeEnergy: (cell, row, col, densityGrid, densityEffectMultiplier) =>
        this.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier),
    });

    this.onMoveCallback = (payload) => this.#handleCellMoved(payload);

    this.init();
    this.environment.recalculateDensityCounts(this.grid);
    this.rebuildActiveCells();
  }

  get energyGrid() {
    return this.environment.energyGrid;
  }

  set energyGrid(value) {
    this.environment.energyGrid = value;
  }

  get energyNext() {
    return this.environment.energyNext;
  }

  set energyNext(value) {
    this.environment.energyNext = value;
  }

  get densityGrid() {
    return this.environment.densityGrid;
  }

  set densityGrid(value) {
    this.environment.densityGrid = value;
  }

  get densityCounts() {
    return this.environment.densityCounts;
  }

  get densityTotals() {
    return this.environment.densityTotals;
  }

  get densityLiveGrid() {
    return this.environment.densityLiveGrid;
  }

  get densityDirtyTiles() {
    return this.environment.densityDirtyTiles;
  }

  #movementOptions() {
    return {
      obstacles: this.obstacles.getGrid(),
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

  #handleObstaclePlaced(row, col, evict = true) {
    this.environment.clearEnergyAt(row, col);
    const occupant = this.grid[row]?.[col];

    if (occupant && evict) {
      const removed = this.removeCell(row, col);

      if (removed) {
        this.stats?.onDeath?.();
      }
    }
  }

  #handleCellMoved({ fromRow, fromCol, toRow, toCol }) {
    this.environment.applyDensityDelta(fromRow, fromCol, -1);
    this.environment.applyDensityDelta(toRow, toCol, 1);
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
    this.organisms.setSelectionManager(this.selectionManager);
  }

  setLingerPenalty(value = 0) {
    const numeric = Number(value);

    this.lingerPenalty = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  isObstacle(row, col) {
    return this.obstacles.isObstacle(row, col);
  }

  isTileBlocked(row, col) {
    return this.obstacles.isTileBlocked(row, col);
  }

  clearObstacles() {
    this.obstacles.clearObstacles();
  }

  setObstacle(row, col, blocked = true, options = {}) {
    return this.obstacles.setObstacle(row, col, blocked, options);
  }

  paintVerticalWall(col, options = {}) {
    this.obstacles.paintVerticalWall(col, options);
  }

  paintHorizontalWall(row, options = {}) {
    this.obstacles.paintHorizontalWall(row, options);
  }

  paintCheckerboard(options = {}) {
    this.obstacles.paintCheckerboard(options);
  }

  paintPerimeter(options = {}) {
    this.obstacles.paintPerimeter(options);
  }

  applyObstaclePreset(presetId, options = {}) {
    this.obstacles.applyPreset(presetId, options);
  }

  clearScheduledObstacles() {
    this.obstacles.clearScheduledObstacles();
  }

  scheduleObstaclePreset(options = {}) {
    this.obstacles.scheduleObstaclePreset(this.tickCount, options);
  }

  processScheduledObstacles() {
    this.obstacles.processScheduledObstacles(this.tickCount);
  }

  runObstacleScenario(scenarioId, { resetSchedule = true } = {}) {
    return this.obstacles.runScenario(scenarioId, this.tickCount, { resetSchedule });
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
    return this.environment.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);
  }

  regenerateEnergyGrid(
    events = [],
    eventStrengthMultiplier = 1,
    regenRate = GridManager.energyRegenRate,
    diffusionRate = GridManager.energyDiffusionRate,
    densityGrid = this.densityGrid,
    densityEffectMultiplier = 1
  ) {
    this.environment.regenerateEnergyGrid({
      events,
      eventStrengthMultiplier,
      regenRate,
      diffusionRate,
      densityGrid,
      densityEffectMultiplier,
      isObstacle: (row, col) => this.isObstacle(row, col),
    });
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
    this.environment.applyDensityDelta(row, col, 1);

    return cell;
  }

  removeCell(row, col) {
    const current = this.grid[row]?.[col];

    if (!current) return null;

    this.grid[row][col] = null;
    this.activeCells.delete(current);
    this.environment.applyDensityDelta(row, col, -1);

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
    this.environment.applyDensityDelta(fromRow, fromCol, -1);
    this.environment.applyDensityDelta(toRow, toCol, 1);

    return true;
  }

  recalculateDensityCounts(radius = this.environment.densityRadius) {
    this.environment.recalculateDensityCounts(this.grid, radius);
  }

  getDensityAt(row, col) {
    return this.environment.getDensityAt(row, col);
  }

  localDensity(row, col, radius = 1) {
    return this.environment.localDensity(row, col, radius);
  }

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    if (
      radius === this.environment.densityRadius &&
      this.environment.densityCounts &&
      this.environment.densityTotals &&
      this.environment.densityLiveGrid
    ) {
      this.environment.syncDensitySnapshot();

      return this.environment.densityGrid.map((row) => row.slice());
    }

    const out = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        out[row][col] = this.environment.localDensity(row, col, radius);
      }
    }

    return out;
  }

  draw() {
    const ctx = this.ctx;
    const cellSize = this.cellSize;

    if (!ctx) return;

    ctx.clearRect(0, 0, this.cols * cellSize, this.rows * cellSize);
    const obstacles = this.obstacles.getGrid();

    if (obstacles) {
      ctx.fillStyle = 'rgba(40,40,55,0.9)';
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (!obstacles[row][col]) continue;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
      ctx.strokeStyle = 'rgba(200,200,255,0.25)';
      ctx.lineWidth = Math.max(1, cellSize * 0.1);
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (!obstacles[row][col]) continue;
          ctx.strokeRect(col * cellSize + 0.5, row * cellSize + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.getCell(row, col);

        if (!cell) continue;
        ctx.fillStyle = cell.color;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
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
    this.environment.clearEnergyAt(row, col);

    if (recordBirth) this.stats?.onBirth?.(cell);

    return cell;
  }

  prepareTick({
    eventManager,
    eventStrengthMultiplier,
    energyRegenRate,
    energyDiffusionRate,
    densityEffectMultiplier = 1,
  }) {
    return this.environment.prepareForTick({
      events: eventManager.activeEvents || [],
      eventStrengthMultiplier,
      regenRate: energyRegenRate,
      diffusionRate: energyDiffusionRate,
      densityEffectMultiplier,
      isObstacle: (row, col) => this.isObstacle(row, col),
    });
  }

  processCell(row, col, context) {
    const cell = this.grid[row][col];

    return this.organisms.processCell(row, col, cell, context);
  }

  handleReproduction(...args) {
    return this.organisms.handleReproduction(...args);
  }

  handleCombat(...args) {
    return this.organisms.handleCombat(...args);
  }

  handleMovement(...args) {
    return this.organisms.handleMovement(...args);
  }

  findTargets(row, col, cell, options) {
    return this.organisms.findTargets(row, col, cell, options);
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

  burstRandomCells(opts = {}) {
    const r = (Math.random() * this.rows) | 0;
    const c = (Math.random() * this.cols) | 0;

    return this.burstAt(r, c, opts);
  }
}

GridManager.OBSTACLE_PRESETS = OBSTACLE_PRESETS;
GridManager.OBSTACLE_SCENARIOS = OBSTACLE_SCENARIOS;

export { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS };
