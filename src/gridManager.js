import EnvironmentField from './environmentField.js';
import PopulationManager from './populationManager.js';
import ObstacleController, { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from './obstacleController.js';
import { computeFitness } from './fitness.js';
import BrainDebugger from './brainDebugger.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
} from './config.js';

export default class GridManager {
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
  static energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT;
  static DENSITY_RADIUS = DENSITY_RADIUS_DEFAULT;
  static maxTileEnergy = MAX_TILE_ENERGY;

  static tryMove(...args) {
    return PopulationManager.tryMove(...args);
  }

  static moveToTarget(...args) {
    return PopulationManager.moveToTarget(...args);
  }

  static moveAwayFromTarget(...args) {
    return PopulationManager.moveAwayFromTarget(...args);
  }

  static moveRandomly(...args) {
    return PopulationManager.moveRandomly(...args);
  }

  constructor(
    rows,
    cols,
    { eventManager, ctx = null, cellSize = 8, stats, maxTileEnergy, selectionManager } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.eventManager = eventManager || window.eventManager;
    this.ctx = ctx || window.ctx;
    this.cellSize = cellSize || window.cellSize || 8;
    this.stats = stats || window.stats;
    this.selectionManager = selectionManager || null;
    this.tickCount = 0;
    this.lastSnapshot = null;
    this.maxTileEnergy =
      typeof maxTileEnergy === 'number' ? maxTileEnergy : GridManager.maxTileEnergy;

    this.environment = new EnvironmentField(rows, cols, {
      maxTileEnergy: this.maxTileEnergy,
      regenRate: GridManager.energyRegenRate,
      diffusionRate: GridManager.energyDiffusionRate,
    });
    this.population = new PopulationManager(rows, cols, {
      environment: this.environment,
      stats: this.stats,
      selectionManager: this.selectionManager,
      densityRadius: GridManager.DENSITY_RADIUS,
      maxTileEnergy: this.maxTileEnergy,
    });
    this.obstacles = new ObstacleController(rows, cols, {
      onBlockTile: ({ row, col, evict }) => this.#handleObstacleBlock(row, col, evict),
      onClearTile: ({ row, col }) => this.#handleObstacleCleared(row, col),
    });

    this.environment.setObstacleChecker((row, col) => this.obstacles.isObstacle(row, col));
    this.population.setObstacleController(this.obstacles);

    this.boundTryMove = this.population.boundTryMove;
    this.boundMoveToTarget = this.population.boundMoveToTarget;
    this.boundMoveAwayFromTarget = this.population.boundMoveAwayFromTarget;
    this.boundMoveRandomly = this.population.boundMoveRandomly;

    this.init();
    this.population.recalculateDensityCounts();
    this.population.rebuildActiveCells();
  }

  get grid() {
    return this.population.gridData;
  }

  set grid(value) {
    this.population.grid = value;
  }

  get activeCells() {
    return this.population.activeCells;
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

  get densityCounts() {
    return this.population.densityCounts;
  }

  get densityDirtyTiles() {
    return this.population.densityDirtyTiles;
  }

  get densityGrid() {
    return this.population.densityGrid;
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
    this.population.setSelectionManager(this.selectionManager);
  }

  setLingerPenalty(value = 0) {
    this.population.setLingerPenalty(value);
  }

  #handleObstacleBlock(row, col, evict = true) {
    const occupant = this.population.getCell(row, col);

    if (occupant) {
      if (evict) {
        const removed = this.population.removeCell(row, col);

        if (removed) {
          this.stats?.onDeath?.();
        }
      }
    }

    this.environment.resetTile(row, col);
  }

  #handleObstacleCleared(row, col) {
    this.environment.resetTile(row, col);
  }

  isObstacle(row, col) {
    return this.obstacles.isObstacle(row, col);
  }

  isTileBlocked(row, col) {
    return this.population.isTileBlocked(row, col);
  }

  clearObstacles() {
    this.obstacles.clearObstacles();
  }

  setObstacle(row, col, blocked = true, options = {}) {
    return this.obstacles.setObstacle(row, col, blocked, options);
  }

  applyObstaclePreset(presetId, options = {}) {
    this.obstacles.applyObstaclePreset(presetId, options);
  }

  clearScheduledObstacles() {
    this.obstacles.clearScheduledObstacles();
  }

  scheduleObstaclePreset(config, baseTick = this.tickCount) {
    this.obstacles.scheduleObstaclePreset(config, baseTick);
  }

  processScheduledObstacles() {
    this.obstacles.processSchedules(this.tickCount);
  }

  runObstacleScenario(scenarioId, { resetSchedule = true } = {}) {
    this.obstacles.setCurrentTick(this.tickCount);

    return this.obstacles.runObstacleScenario(scenarioId, { resetSchedule });
  }

  init() {
    this.population.init();
  }

  seed(currentPopulation, minPopulation) {
    this.population.seed(currentPopulation, minPopulation);
  }

  getCell(row, col) {
    return this.population.getCell(row, col);
  }

  setCell(row, col, cell) {
    return this.population.setCell(row, col, cell);
  }

  clearCell(row, col) {
    this.population.clearCell(row, col);
  }

  placeCell(row, col, cell) {
    return this.population.placeCell(row, col, cell);
  }

  removeCell(row, col) {
    return this.population.removeCell(row, col);
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    return this.population.relocateCell(fromRow, fromCol, toRow, toCol);
  }

  spawnCell(row, col, options = {}) {
    return this.population.spawnCell(row, col, options);
  }

  rebuildActiveCells() {
    this.population.rebuildActiveCells();
  }

  recalculateDensityCounts() {
    this.population.recalculateDensityCounts();
  }

  getDensityAt(row, col) {
    return this.population.getDensityAt(row, col);
  }

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    return this.population.computeDensityGrid(radius);
  }

  localDensity(row, col, radius = 1) {
    return this.population.localDensity(row, col, radius);
  }

  consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier) {
    this.population.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);
  }

  regenerateEnergyGrid(
    events = [],
    eventStrengthMultiplier = 1,
    regenRate = GridManager.energyRegenRate,
    diffusionRate = GridManager.energyDiffusionRate,
    densityGrid = null,
    densityEffectMultiplier = 1
  ) {
    this.environment.tick({
      events,
      eventStrengthMultiplier,
      densityGrid,
      densityEffectMultiplier,
      regenRate,
      diffusionRate,
    });
  }

  draw(options = {}) {
    let showObstacles = true;

    if (typeof options === 'boolean') {
      showObstacles = options;
    } else if (options && typeof options === 'object') {
      if ('showObstacles' in options) {
        showObstacles = options.showObstacles !== false;
      }
    }

    const ctx = this.ctx;
    const cellSize = this.cellSize;

    ctx.clearRect(0, 0, this.cols * cellSize, this.rows * cellSize);

    if (showObstacles && this.obstacles?.draw) {
      this.obstacles.draw(ctx, cellSize);
    }

    const grid = this.population.gridData;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = grid[row][col];

        if (!cell) continue;
        ctx.fillStyle = cell.color;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }

  prepareTick({
    eventStrengthMultiplier,
    energyRegenRate,
    energyDiffusionRate,
    densityEffectMultiplier = 1,
  }) {
    const densityGrid = this.population.prepareForTick();

    this.environment.tick({
      events: this.eventManager?.activeEvents || [],
      eventStrengthMultiplier,
      densityGrid,
      densityEffectMultiplier,
      regenRate: energyRegenRate,
      diffusionRate: energyDiffusionRate,
    });

    return { densityGrid };
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
    this.lastSnapshot = null;
    this.tickCount += 1;
    this.processScheduledObstacles();

    const { densityGrid } = this.prepareTick({
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityEffectMultiplier,
    });

    const processed = new WeakSet();
    const activeSnapshot = this.population.getActiveCellsSnapshot();

    for (const cell of activeSnapshot) {
      this.population.updateCell(cell, {
        processed,
        stats: this.stats,
        eventManager: this.eventManager,
        densityGrid,
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

  processCell(row, col, context) {
    const cell = this.population.getCell(row, col);

    if (!cell) return;

    const processed = context.processed || new WeakSet();

    this.population.updateCell(cell, { ...context, processed });
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
    const grid = this.population.gridData;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = grid[row][col];

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
    const grid = this.population.gridData;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (grid[row][col]) {
          population++;
        }
      }
    }

    return population / (this.rows * this.cols);
  }

  findTargets(row, col, cell, options) {
    return this.population.findTargets(row, col, cell, options);
  }

  handleReproduction(row, col, cell, targets, context) {
    return this.population.handleReproduction(row, col, cell, targets, context);
  }

  handleCombat(row, col, cell, targets, context) {
    return this.population.handleCombat(row, col, cell, targets, context);
  }

  handleMovement(row, col, cell, targets, context) {
    return this.population.handleMovement(row, col, cell, targets, context);
  }

  burstAt(centerRow, centerCol, options = {}) {
    return this.population.burstAt(centerRow, centerCol, options);
  }

  burstRandomCells(options = {}) {
    return this.population.burstRandomCells(options);
  }
}

GridManager.OBSTACLE_PRESETS = OBSTACLE_PRESETS;
GridManager.OBSTACLE_SCENARIOS = OBSTACLE_SCENARIOS;
