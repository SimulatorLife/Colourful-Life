import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import Cell from './cell.js';

export default class OrganismSystem {
  constructor(dependencies = {}) {
    this.grid = null;
    this.rows = 0;
    this.cols = 0;
    this.environment = null;
    this.obstacles = null;
    this.stats = null;
    this.selectionManager = null;
    this.movement = null;
    this._setCell = () => null;
    this._removeCell = () => null;
    this._relocateCell = () => false;
    this.maxTileEnergy = Infinity;
    this.lastDensityGrid = null;
    this.lastDensityEffectMultiplier = 1;
    this._defaultGetTargets = (row, col, cell, options) =>
      this.findTargets(row, col, cell, options);
    this._defaultConsumeEnergy = (cell, row, col, densityGrid, multiplier) =>
      this.environment?.consumeEnergy(cell, row, col, densityGrid, multiplier);
    this.getTargets = this._defaultGetTargets;
    this.consumeEnergyFn = this._defaultConsumeEnergy;

    this.configure(dependencies);
  }

  configure({
    grid,
    rows,
    cols,
    environment,
    obstacles,
    stats,
    selectionManager,
    movement,
    setCell,
    removeCell,
    relocateCell,
    maxTileEnergy,
    findTargets,
    consumeEnergy,
  } = {}) {
    if (grid) this.grid = grid;
    if (typeof rows === 'number' && Number.isFinite(rows)) this.rows = rows;
    if (typeof cols === 'number' && Number.isFinite(cols)) this.cols = cols;
    if (environment !== undefined) this.environment = environment || null;
    if (obstacles !== undefined) this.obstacles = obstacles || null;
    if (stats !== undefined) this.stats = stats;
    if (selectionManager !== undefined) this.selectionManager = selectionManager || null;
    if (movement) this.movement = movement;
    if (typeof setCell === 'function') this._setCell = setCell;
    if (typeof removeCell === 'function') this._removeCell = removeCell;
    if (typeof relocateCell === 'function') this._relocateCell = relocateCell;
    if (typeof maxTileEnergy === 'number' && Number.isFinite(maxTileEnergy)) {
      this.maxTileEnergy = maxTileEnergy;
    }

    if (typeof findTargets === 'function') this.getTargets = findTargets;
    else if (findTargets !== undefined) this.getTargets = this._defaultGetTargets;

    if (typeof consumeEnergy === 'function') this.consumeEnergyFn = consumeEnergy;
    else if (consumeEnergy !== undefined) this.consumeEnergyFn = this._defaultConsumeEnergy;

    if (this.environment?.densityGrid) {
      this.lastDensityGrid = this.environment.densityGrid;
    }

    return this;
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
  }

  setStats(stats) {
    this.stats = stats;
  }

  setMaxTileEnergy(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      this.maxTileEnergy = value;
    }
  }

  processCell(
    row,
    col,
    cell,
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
    if (!cell || processed.has(cell)) return;
    processed.add(cell);
    cell.age++;
    const activeStats = stats || this.stats;

    if (cell.age >= cell.lifespan) {
      this.removeCell(row, col);
      activeStats?.onDeath?.();

      return;
    }

    const events = eventManager?.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, this.maxTileEnergy);
    }

    this.lastDensityGrid = densityGrid;
    this.lastDensityEffectMultiplier = densityEffectMultiplier;
    this.consumeEnergyFn(cell, row, col, densityGrid, densityEffectMultiplier);
    const localDensity = densityGrid?.[row]?.[col];

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (starved || cell.energy <= 0) {
      this.removeCell(row, col);
      activeStats?.onDeath?.();

      return;
    }

    const act = typeof cell.dna.activityRate === 'function' ? cell.dna.activityRate() : 1;

    if (Math.random() > act) {
      return;
    }

    const targets = this.getTargets(row, col, cell, {
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
    });

    if (
      this.handleReproduction(row, col, cell, targets, {
        stats: activeStats,
        densityGrid,
        densityEffectMultiplier,
        mutationMultiplier,
      })
    ) {
      return;
    }

    if (
      this.handleCombat(row, col, cell, targets, {
        stats: activeStats,
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
    const moved = this.movement?.moveToTarget?.(
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

    const densitySourceRow = moved ? parentRow : originalParentRow;
    const densitySourceCol = moved ? parentCol : originalParentCol;
    let localDensity = densityGrid?.[densitySourceRow]?.[densitySourceCol];

    if (localDensity == null) {
      localDensity = this.environment?.getDensityAt(densitySourceRow, densitySourceCol);
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

        if (!candidateSet.has(key) && !this.obstacles?.isObstacle(r, c)) {
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

      addCandidate(originalParentRow, originalParentCol);
      if (moved) addNeighbors(originalParentRow, originalParentCol);
      addCandidate(parentRow, parentCol);
      addCandidate(mateRow, mateCol);
      addNeighbors(parentRow, parentCol);
      addNeighbors(mateRow, mateCol);

      const freeSlots = candidates.filter(
        ({ r, c }) => !this.grid[r][c] && !this.obstacles?.isObstacle(r, c)
      );
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
            stats?.onBirth?.(offspring);
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
    const localDensity = densityGrid?.[row]?.[col] ?? this.environment?.getDensityAt(row, col);
    const action = cell.chooseInteractionAction({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies: society,
      maxTileEnergy: this.maxTileEnergy,
    });

    if (action === 'avoid') {
      this.movement?.moveAwayFromTarget?.(
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
        this.movement?.moveToTarget?.(
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
      this.movement?.moveToTarget?.(
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
    const localDensity = densityGrid?.[row]?.[col] ?? this.environment?.getDensityAt(row, col);

    cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || [], {
      localDensity,
      densityEffectMultiplier,
      rows: this.rows,
      cols: this.cols,
      moveToTarget: this.movement?.moveToTarget,
      moveAwayFromTarget: this.movement?.moveAwayFromTarget,
      moveRandomly: this.movement?.moveRandomly,
      tryMove: this.movement?.tryMove,
      getEnergyAt: (rr, cc) => this.environment?.getEnergyAt(rr, cc) / this.maxTileEnergy,
      maxTileEnergy: this.maxTileEnergy,
      isTileBlocked: (rr, cc) => this.obstacles?.isTileBlocked(rr, cc),
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
    const density = this.environment?.getDensityAt(row, col) ?? 0;
    const effD = clamp(density * densityEffectMultiplier, 0, 1);
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

  setCell(row, col, cell) {
    return this._setCell ? this._setCell(row, col, cell) : null;
  }

  removeCell(row, col) {
    return this._removeCell ? this._removeCell(row, col) : null;
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    return this._relocateCell ? this._relocateCell(fromRow, fromCol, toRow, toCol) : false;
  }

  consumeEnergy(cell, row, col) {
    return this.consumeEnergyFn(
      cell,
      row,
      col,
      this.lastDensityGrid,
      this.lastDensityEffectMultiplier
    );
  }
}
