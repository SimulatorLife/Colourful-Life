import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';
import { MAX_TILE_ENERGY, DENSITY_RADIUS_DEFAULT, CONSUMPTION_DENSITY_PENALTY } from './config.js';

export default class PopulationManager {
  static tryMove(gridArr, sr, sc, dr, dc, rows, cols, options = {}) {
    const {
      isBlocked: providedIsBlocked,
      obstacles = null,
      lingerPenalty = 0,
      penalizeOnBounds = true,
      onBlocked = null,
      onMove = null,
      activeCells = null,
      onCellMoved = null,
    } = options;
    const isBlocked =
      typeof providedIsBlocked === 'function'
        ? providedIsBlocked
        : obstacles && typeof obstacles.isObstacle === 'function'
          ? (row, col) => obstacles.isObstacle(row, col)
          : Array.isArray(obstacles)
            ? (row, col) => Boolean(obstacles[row]?.[col])
            : () => false;
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

    if (isBlocked(nr, nc)) {
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
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return PopulationManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols, options = {}) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
    else dc = -Math.sign(dCol);

    return PopulationManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  static moveRandomly(gridArr, row, col, cell, rows, cols, options = {}) {
    const { dr, dc } = cell.decideRandomMove();

    return PopulationManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  constructor(
    rows,
    cols,
    {
      environment,
      stats = null,
      selectionManager = null,
      densityRadius = DENSITY_RADIUS_DEFAULT,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = {}
  ) {
    this.rows = rows;
    this.cols = cols;
    this.environment = environment;
    this.stats = stats;
    this.selectionManager = selectionManager;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.activeCells = new Set();
    this.densityRadius = densityRadius;
    this.densityCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    this.densityLiveGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityDirtyTiles = new Set();
    this.maxTileEnergy = maxTileEnergy;
    this.lingerPenalty = 0;
    this.obstacleController = null;

    this.onMoveCallback = (payload) => this.#handleCellMoved(payload);
    this.boundTryMove = (gridArr, sr, sc, dr, dc, rows, cols) =>
      PopulationManager.tryMove(gridArr, sr, sc, dr, dc, rows, cols, this.#movementOptions());
    this.boundMoveToTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      PopulationManager.moveToTarget(
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
      PopulationManager.moveAwayFromTarget(
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
      PopulationManager.moveRandomly(gridArr, row, col, cell, rows, cols, this.#movementOptions());
  }

  setObstacleController(controller) {
    this.obstacleController = controller;
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
  }

  setLingerPenalty(value = 0) {
    const numeric = Number(value);

    this.lingerPenalty = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  get gridData() {
    return this.grid;
  }

  #movementOptions() {
    return {
      isBlocked: (row, col) => this.isTileBlocked(row, col),
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

  isTileBlocked(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;

    return this.obstacleController ? this.obstacleController.isObstacle(row, col) : false;
  }

  init() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.isTileBlocked(row, col)) continue;
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
        if (!this.getCell(r, c) && !this.isTileBlocked(r, c)) empty.push({ r, c });
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

  getCell(row, col) {
    return this.grid[row]?.[col] ?? null;
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

  spawnCell(row, col, { dna = DNA.random(), spawnEnergy, recordBirth = false } = {}) {
    if (this.isTileBlocked(row, col)) return null;
    const available = this.environment ? this.environment.getEnergy(row, col) : 0;
    const energy = Math.min(this.maxTileEnergy, spawnEnergy ?? available);
    const cell = new Cell(row, col, dna, energy);

    this.setCell(row, col, cell);
    if (this.environment) {
      this.environment.takeEnergy(row, col, energy);
    }

    if (recordBirth) this.stats?.onBirth?.(cell);

    return cell;
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

  recalculateDensityCounts() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.densityCounts[r][c] = 0;
      }
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) this.#applyDensityDelta(r, c, 1);
      }
    }

    this.#syncDensitySnapshot(true);
  }

  #handleCellMoved({ fromRow, fromCol, toRow, toCol }) {
    this.#applyDensityDelta(fromRow, fromCol, -1);
    this.#applyDensityDelta(toRow, toCol, 1);
  }

  #applyDensityDelta(row, col, delta, radius = this.densityRadius) {
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
          this.#markDensityDirty(rr, cc);
        }
      }
    }
  }

  #markDensityDirty(row, col) {
    if (!this.densityDirtyTiles) this.densityDirtyTiles = new Set();

    this.densityDirtyTiles.add(row * this.cols + col);
  }

  #buildDensityTotals(radius = this.densityRadius) {
    return Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => this.#computeNeighborTotal(r, c, radius))
    );
  }

  #computeNeighborTotal(row, col, radius = this.densityRadius) {
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

  prepareForTick() {
    this.#syncDensitySnapshot();

    return this.densityGrid;
  }

  getDensityGrid() {
    return this.densityGrid;
  }

  getDensityAt(row, col) {
    if (this.densityGrid?.[row]?.[col] != null) {
      return this.densityGrid[row][col];
    }

    return this.localDensity(row, col, this.densityRadius);
  }

  computeDensityGrid(radius = DENSITY_RADIUS_DEFAULT) {
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

  #countNeighbors(row, col, radius = DENSITY_RADIUS_DEFAULT) {
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

  getActiveCellsSnapshot() {
    return Array.from(this.activeCells);
  }

  updateCell(
    cell,
    {
      processed,
      stats,
      eventManager,
      densityGrid,
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
      eventStrengthMultiplier,
      mutationMultiplier,
    }
  ) {
    if (!cell || processed.has(cell)) return;
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
      return;
    }

    processed.add(cell);
    cell.age++;
    if (cell.age >= cell.lifespan) {
      this.removeCell(row, col);
      stats?.onDeath?.();

      return;
    }

    const events = eventManager?.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, this.maxTileEnergy);
    }

    this.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);
    const localDensity = densityGrid?.[row]?.[col] ?? 0;

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (starved || cell.energy <= 0) {
      this.removeCell(row, col);
      stats?.onDeath?.();

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

  consumeEnergy(cell, row, col, densityGrid = this.densityGrid, densityEffectMultiplier = 1) {
    const available = this.environment ? this.environment.getEnergy(row, col) : 0;
    const dna = cell?.dna || {};
    const baseRate = typeof dna.forageRate === 'function' ? dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density = densityGrid?.[row]?.[col] ?? this.localDensity(row, col, this.densityRadius);
    const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
    const crowdPenalty = Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * effDensity);
    const minCap = typeof dna.harvestCapMin === 'function' ? dna.harvestCapMin() : 0.1;
    const maxCapRaw = typeof dna.harvestCapMax === 'function' ? dna.harvestCapMax() : 0.5;
    const maxCap = Math.max(minCap, clamp(maxCapRaw, minCap, 1));
    const cap = clamp(base * crowdPenalty, minCap, maxCap);
    const take = Math.min(cap, available);

    if (this.environment) {
      this.environment.takeEnergy(row, col, take);
    }

    cell.energy = Math.min(this.maxTileEnergy, cell.energy + take);
  }

  handleReproduction(
    row,
    col,
    cell,
    { mates, society },
    { stats, densityGrid, densityEffectMultiplier, mutationMultiplier }
  ) {
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

        if (!candidateSet.has(key) && !this.isTileBlocked(r, c)) {
          candidateSet.add(key);
          candidates.push({ r, c });
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

      addNeighbors(parentRow, parentCol);
      addNeighbors(mateRow, mateCol);

      if (moveSucceeded) {
        addCandidate(originalParentRow, originalParentCol);
      }

      for (let i = 0; i < candidates.length; i++) {
        const idx = Math.floor(Math.random() * candidates.length);
        const t = candidates[i];

        candidates[i] = candidates[idx];
        candidates[idx] = t;
      }

      for (let i = 0; i < candidates.length; i++) {
        const { r, c } = candidates[i];

        if (!this.grid[r][c]) {
          const child = Cell.breed(cell, bestMate.target, mutationMultiplier, {
            maxTileEnergy: this.maxTileEnergy,
          });

          if (child) {
            child.row = r;
            child.col = c;
            this.setCell(r, c, child);
            if (this.environment) this.environment.takeEnergy(r, c, child.energy);
            stats?.onBirth?.(child, {
              appetite,
              bias,
              selectionMode: selectionKind,
              selectionListSize,
            });
            reproduced = true;
            break;
          }
        }
      }

      if (!reproduced) {
        blockedInfo = { reason: 'no_space', parentA: { row: parentRow, col: parentCol } };
      }
    }

    stats?.recordMateChoice?.({
      appetite,
      bias,
      selectionListSize,
      selectionMode: selectionKind,
      blocked: reproduced ? null : blockedInfo,
      success: reproduced,
    });

    return reproduced;
  }

  handleCombat(
    row,
    col,
    cell,
    { enemies, society },
    { stats, densityEffectMultiplier, densityGrid }
  ) {
    if (!enemies.length) return false;

    const action = cell.chooseInteractionAction({
      enemies,
      allies: society,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (action === 'avoid') {
      if (enemies.length === 0) return false;
      const target = enemies[Math.floor(Math.random() * enemies.length)];

      if (!target) return false;

      const moved = this.boundMoveAwayFromTarget(
        this.grid,
        row,
        col,
        target.row,
        target.col,
        this.rows,
        this.cols
      );

      return moved;
    }

    const target = cell.selectCombatTarget(enemies);

    if (!target) return false;

    const result = cell.engage(target.target, {
      densityEffectMultiplier,
      densityGrid,
      environment: this.environment,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (result?.killedTarget) {
      this.removeCell(target.row, target.col);
      stats?.onKill?.(cell, target.target);
      stats?.onDeath?.();
    }

    if (result?.killedSelf) {
      this.removeCell(row, col);
      stats?.onDeath?.();

      return true;
    }

    return Boolean(result);
  }

  handleMovement(
    row,
    col,
    cell,
    { mates, enemies, society },
    { densityGrid, densityEffectMultiplier }
  ) {
    const localDensity = densityGrid?.[row]?.[col] ?? this.getDensityAt(row, col);

    cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || [], {
      localDensity,
      densityEffectMultiplier,
      rows: this.rows,
      cols: this.cols,
      moveToTarget: this.boundMoveToTarget,
      moveAwayFromTarget: this.boundMoveAwayFromTarget,
      moveRandomly: this.boundMoveRandomly,
      tryMove: this.boundTryMove,
      getEnergyAt: (rr, cc) => this.environment?.getNormalizedEnergy(rr, cc) ?? 0,
      maxTileEnergy: this.maxTileEnergy,
      isTileBlocked: (rr, cc) => this.isTileBlocked(rr, cc),
    });
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
    const d = this.densityGrid?.[row]?.[col] ?? this.localDensity(row, col, this.densityRadius);
    const effD = clamp(d * densityEffectMultiplier, 0, 1);
    let enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);
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

      if (!this.grid[rr][cc] && !this.isTileBlocked(rr, cc)) {
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
