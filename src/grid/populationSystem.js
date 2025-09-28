import { randomRange, randomPercent, clamp, lerp } from '../utils.js';
import Cell from '../cell.js';
import GridState from './gridState.js';

export default class PopulationSystem {
  constructor({ gridState, interactionSystem, selectionManager, stats, rng = Math.random } = {}) {
    this.gridState = gridState;
    this.interactionSystem = interactionSystem || null;
    this.selectionManager = selectionManager || null;
    this.stats = stats || null;
    this.rng = typeof rng === 'function' ? rng : Math.random;
    this.lingerPenalty = 0;
    this.matingDiversityThreshold = 0.45;
    this.lowDiversityReproMultiplier = 0.1;
  }

  setSelectionManager(selectionManager) {
    this.selectionManager = selectionManager || null;
  }

  setStats(stats) {
    this.stats = stats || null;
  }

  setLingerPenalty(value = 0) {
    const numeric = Number(value);

    this.lingerPenalty = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  }

  setMatingDiversityOptions({ threshold, lowDiversityMultiplier } = {}) {
    if (threshold !== undefined) {
      const numeric = Number(threshold);

      if (Number.isFinite(numeric)) {
        this.matingDiversityThreshold = clamp(numeric, 0, 1);
      }
    }

    if (lowDiversityMultiplier !== undefined) {
      const numeric = Number(lowDiversityMultiplier);

      if (Number.isFinite(numeric)) {
        this.lowDiversityReproMultiplier = clamp(numeric, 0, 1);
      }
    }
  }

  processCell(
    row,
    col,
    {
      stats = this.stats,
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
    const cell = this.gridState?.grid?.[row]?.[col];

    if (!cell || processed.has(cell)) return;
    processed.add(cell);
    cell.age++;
    if (cell.age >= cell.lifespan) {
      this.gridState.removeCell(row, col);
      stats?.onDeath?.();

      return;
    }

    const events = eventManager?.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, this.gridState.maxTileEnergy);
    }

    this.gridState.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);
    const localDensity = densityGrid?.[row]?.[col];

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.gridState.maxTileEnergy,
    });

    if (starved || cell.energy <= 0) {
      this.gridState.removeCell(row, col);
      stats?.onDeath?.();

      return;
    }

    const act = typeof cell.dna?.activityRate === 'function' ? cell.dna.activityRate() : 1;

    if (this.#random() > act) {
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
    { stats = this.stats, densityGrid, densityEffectMultiplier, mutationMultiplier }
  ) {
    const gridState = this.gridState;
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

    const similarity =
      typeof bestMate.similarity === 'number'
        ? bestMate.similarity
        : cell.similarityTo(bestMate.target);
    const diversity = typeof bestMate.diversity === 'number' ? bestMate.diversity : 1 - similarity;
    const diversityThreshold =
      typeof this.matingDiversityThreshold === 'number' ? this.matingDiversityThreshold : 0;
    const penaltyBase =
      typeof this.lowDiversityReproMultiplier === 'number'
        ? clamp(this.lowDiversityReproMultiplier, 0, 1)
        : 0;
    let penaltyMultiplier = 1;
    let penalizedForSimilarity = false;

    const originalParentRow = cell.row;
    const originalParentCol = cell.col;
    const moveSucceeded = this.moveToTarget(
      gridState.grid,
      row,
      col,
      bestMate.row,
      bestMate.col,
      gridState.rows,
      gridState.cols
    );
    const parentRow = cell.row;
    const parentCol = cell.col;
    const mateRow = bestMate.target.row;
    const mateCol = bestMate.target.col;

    const densitySourceRow = moveSucceeded ? parentRow : originalParentRow;
    const densitySourceCol = moveSucceeded ? parentCol : originalParentCol;
    let localDensity = densityGrid?.[densitySourceRow]?.[densitySourceCol];

    if (localDensity == null) {
      localDensity = gridState.getDensityAt(densitySourceRow, densitySourceCol);
    }
    const baseProb = cell.computeReproductionProbability(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
    });
    const { probability: reproProb } = cell.decideReproduction(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: gridState.maxTileEnergy,
      baseProbability: baseProb,
    });

    let effectiveReproProb = clamp(reproProb ?? 0, 0, 1);

    if (diversity < diversityThreshold) {
      penalizedForSimilarity = true;
      penaltyMultiplier = penaltyBase;

      if (penaltyMultiplier <= 0) effectiveReproProb = 0;
      else effectiveReproProb = clamp(effectiveReproProb * penaltyMultiplier, 0, 1);
    }

    const thrFracA =
      typeof cell.dna?.reproductionThresholdFrac === 'function'
        ? cell.dna.reproductionThresholdFrac()
        : 0.4;
    const thrFracB =
      typeof bestMate.target.dna?.reproductionThresholdFrac === 'function'
        ? bestMate.target.dna.reproductionThresholdFrac()
        : 0.4;
    const thrA = thrFracA * gridState.maxTileEnergy;
    const thrB = thrFracB * gridState.maxTileEnergy;
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
      randomPercent(effectiveReproProb) &&
      cell.energy >= thrA &&
      bestMate.target.energy >= thrB
    ) {
      const candidates = [];
      const candidateSet = new Set();
      const addCandidate = (r, c) => {
        if (r < 0 || r >= gridState.rows || c < 0 || c >= gridState.cols) return;

        const key = `${r},${c}`;

        if (!candidateSet.has(key) && !gridState.isObstacle(r, c)) {
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
      if (moveSucceeded) addNeighbors(originalParentRow, originalParentCol);
      addCandidate(parentRow, parentCol);
      addCandidate(mateRow, mateCol);
      addNeighbors(parentRow, parentCol);
      addNeighbors(mateRow, mateCol);

      const freeSlots = candidates.filter(
        ({ r, c }) => !gridState.grid[r][c] && !gridState.isObstacle(r, c)
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
            maxTileEnergy: gridState.maxTileEnergy,
          });

          if (offspring) {
            offspring.row = spawn.r;
            offspring.col = spawn.c;
            gridState.setCell(spawn.r, spawn.c, offspring);
            stats?.onBirth?.();
            reproduced = true;
          }
        }
      }
    }

    if (blockedInfo && stats?.recordReproductionBlocked) {
      stats.recordReproductionBlocked(blockedInfo);
    }

    if (stats?.recordMateChoice) {
      stats.recordMateChoice({
        similarity,
        diversity,
        appetite,
        bias,
        selectionMode: selectionKind,
        poolSize: selectionListSize,
        success: reproduced,
        penalized: penalizedForSimilarity,
        penaltyMultiplier,
      });
    }

    return reproduced;
  }

  handleCombat(
    row,
    col,
    cell,
    { enemies, society = [] },
    { stats = this.stats, densityEffectMultiplier, densityGrid }
  ) {
    if (!Array.isArray(enemies) || enemies.length === 0) return false;

    const gridState = this.gridState;
    const targetEnemy = enemies[Math.floor(randomRange(0, enemies.length))];
    const localDensity = densityGrid?.[row]?.[col] ?? gridState.getDensityAt(row, col);
    const action = cell.chooseInteractionAction({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies: society,
      maxTileEnergy: gridState.maxTileEnergy,
    });

    if (action === 'avoid') {
      this.moveAwayFromTarget(
        gridState.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        gridState.rows,
        gridState.cols
      );

      return true;
    }

    const dist = Math.max(Math.abs(targetEnemy.row - row), Math.abs(targetEnemy.col - col));

    if (action === 'fight') {
      if (dist <= 1) {
        const intent = cell.createFightIntent({
          attackerRow: row,
          attackerCol: col,
          targetRow: targetEnemy.row,
          targetCol: targetEnemy.col,
        });

        if (intent)
          this.interactionSystem?.resolveIntent(intent, {
            stats,
            densityGrid,
            densityEffectMultiplier,
          });
      } else {
        this.moveToTarget(
          gridState.grid,
          row,
          col,
          targetEnemy.row,
          targetEnemy.col,
          gridState.rows,
          gridState.cols
        );
      }

      return true;
    }

    if (dist <= 1) {
      const intent = cell.createCooperationIntent({
        row,
        col,
        targetRow: targetEnemy.row,
        targetCol: targetEnemy.col,
      });

      if (intent)
        this.interactionSystem?.resolveIntent(intent, {
          stats,
        });
    } else {
      this.moveToTarget(
        gridState.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        gridState.rows,
        gridState.cols
      );
    }

    return true;
  }

  handleMovement(
    row,
    col,
    cell,
    { mates, enemies, society },
    { densityGrid, densityEffectMultiplier }
  ) {
    const gridState = this.gridState;
    const localDensity = densityGrid?.[row]?.[col] ?? gridState.getDensityAt(row, col);

    cell.executeMovementStrategy(gridState.grid, row, col, mates, enemies, society || [], {
      localDensity,
      densityEffectMultiplier,
      rows: gridState.rows,
      cols: gridState.cols,
      moveToTarget: (gridArr, r, c, targetRow, targetCol, rows, cols) =>
        this.moveToTarget(gridArr, r, c, targetRow, targetCol, rows, cols),
      moveAwayFromTarget: (gridArr, r, c, targetRow, targetCol, rows, cols) =>
        this.moveAwayFromTarget(gridArr, r, c, targetRow, targetCol, rows, cols),
      moveRandomly: (gridArr, r, c, movingCell, rows, cols) =>
        this.moveRandomly(gridArr, r, c, movingCell, rows, cols),
      tryMove: (gridArr, sr, sc, dr, dc, rows, cols) =>
        this.tryMove(gridArr, sr, sc, dr, dc, rows, cols),
      getEnergyAt: (rr, cc) => gridState.getEnergyFraction(rr, cc),
      maxTileEnergy: gridState.maxTileEnergy,
      isTileBlocked: (rr, cc) => gridState.isTileBlocked(rr, cc),
    });
  }

  findTargets(
    row,
    col,
    cell,
    { densityEffectMultiplier = 1, societySimilarity = 1, enemySimilarity = 0 } = {}
  ) {
    const gridState = this.gridState;
    const mates = [];
    const enemies = [];
    const society = [];
    const d =
      gridState.densityGrid?.[row]?.[col] ??
      gridState.localDensity(row, col, GridState.DENSITY_RADIUS);
    const effD = clamp(d * densityEffectMultiplier, 0, 1);
    let enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);
    const risk = typeof cell.dna?.riskTolerance === 'function' ? cell.dna.riskTolerance() : 0.5;

    enemyBias = Math.max(0, enemyBias * (0.4 + 0.8 * risk));
    const allyT =
      typeof cell.dna?.allyThreshold === 'function' ? cell.dna.allyThreshold() : societySimilarity;
    const enemyT =
      typeof cell.dna?.enemyThreshold === 'function' ? cell.dna.enemyThreshold() : enemySimilarity;

    for (let x = -cell.sight; x <= cell.sight; x++) {
      for (let y = -cell.sight; y <= cell.sight; y++) {
        if (x === 0 && y === 0) continue;
        const newRow = row + y;
        const newCol = col + x;

        if (newRow < 0 || newRow >= gridState.rows || newCol < 0 || newCol >= gridState.cols)
          continue;
        const target = gridState.grid[newRow][newCol];

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

  moveRandomly(gridArr, row, col, cell, rows, cols) {
    const { dr, dc } = cell.decideRandomMove();

    return this.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0;
    let dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return this.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0;
    let dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
    else dc = -Math.sign(dCol);

    return this.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  tryMove(gridArr, sr, sc, dr, dc, rows, cols, options = {}) {
    const {
      penalizeOnBounds = true,
      onBlocked = null,
      onMove = null,
      onCellMoved = null,
      activeCells = null,
    } = options;
    const gridState = this.gridState;
    const nr = sr + dr;
    const nc = sc + dc;
    const moving = gridArr?.[sr]?.[sc] ?? null;

    if (!moving) {
      return false;
    }

    const applyWallPenalty = (reason) => {
      if (!moving || typeof moving !== 'object' || moving.energy == null) return;
      const base = this.lingerPenalty;
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

    if (gridState.isObstacle(nr, nc)) {
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

    const dcell = gridState.grid[nr][nc];

    if (!dcell) {
      const moved = gridState.relocateCell(sr, sc, nr, nc);

      if (!moved) return false;

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

      gridState.activeCells.add(moving);
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

  #random() {
    return typeof this.rng === 'function' ? this.rng() : Math.random();
  }
}
