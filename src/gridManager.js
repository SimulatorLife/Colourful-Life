import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';
import { computeFitness } from './fitness.js';
import { isEventAffecting } from './eventManager.js';
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
  REGEN_DENSITY_PENALTY,
  CONSUMPTION_DENSITY_PENALTY,
} from './config.js';

export default class GridManager {
  static maxTileEnergy = MAX_TILE_ENERGY;
  // Base per-tick regen before modifiers; logistic to max, density-aware
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
  // Fraction to diffuse toward neighbors each tick
  static energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT;
  static DENSITY_RADIUS = DENSITY_RADIUS_DEFAULT;

  static tryMove(gridArr, sr, sc, dr, dc, rows, cols) {
    const nr = (sr + dr + rows) % rows;
    const nc = (sc + dc + cols) % cols;
    const dcell = gridArr[nr][nc];

    if (!dcell) {
      const moving = gridArr[sr][sc];

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

      return true;
    }

    return false;
  }

  static moveToTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = Math.sign(dRow);
    else dc = Math.sign(dCol);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  static moveAwayFromTarget(gridArr, row, col, targetRow, targetCol, rows, cols) {
    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let dr = 0,
      dc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) dr = -Math.sign(dRow);
    else dc = -Math.sign(dCol);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  static moveRandomly(gridArr, row, col, cell, rows, cols) {
    const { dr, dc } = cell.decideRandomMove();

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols);
  }

  constructor(rows, cols, { eventManager, ctx = null, cellSize = 8, stats } = {}) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => GridManager.maxTileEnergy / 2)
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.eventManager = eventManager || window.eventManager;
    this.ctx = ctx || window.ctx;
    this.cellSize = cellSize || window.cellSize || 8;
    this.stats = stats || window.stats;
    this.densityGrid = null;
    this.lastSnapshot = null;
    this.init();
  }

  init() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (randomPercent(0.05)) {
          const dna = DNA.random();

          this.grid[row][col] = new Cell(row, col, dna);
        }
      }
    }
  }

  seed(currentPopulation, minPopulation) {
    if (currentPopulation >= minPopulation) return;
    const empty = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.getCell(r, c)) empty.push({ r, c });
      }
    }
    const toSeed = Math.min(minPopulation - currentPopulation, empty.length);

    for (let i = 0; i < toSeed; i++) {
      const idx = Math.floor(randomRange(0, empty.length));
      const { r, c } = empty.splice(idx, 1)[0];
      const dna = DNA.random();
      const newCell = new Cell(r, c, dna);

      this.setCell(r, c, newCell);
    }
  }

  consumeEnergy(cell, row, col) {
    const available = this.energyGrid[row][col];
    // DNA-driven harvest with density penalty
    const base = typeof cell.dna.forageRate === 'function' ? cell.dna.forageRate() : 0.4;
    const density =
      this.densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const crowdPenalty = Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * density);
    const minCap = typeof cell.dna.harvestCapMin === 'function' ? cell.dna.harvestCapMin() : 0.1;
    const maxCap = typeof cell.dna.harvestCapMax === 'function' ? cell.dna.harvestCapMax() : 0.5;
    const cap = Math.max(minCap, Math.min(maxCap, base * crowdPenalty));
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(GridManager.maxTileEnergy, cell.energy + take);
  }

  regenerateEnergyGrid(
    events = null,
    eventStrengthMultiplier = 1,
    R = GridManager.energyRegenRate,
    D = GridManager.energyDiffusionRate,
    densityGrid = null
  ) {
    const maxE = GridManager.maxTileEnergy;
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
          if (isEventAffecting(ev, r, c)) {
            const s = (ev.strength || 0) * (eventStrengthMultiplier || 1);

            switch (ev.eventType) {
              case 'flood':
                regen += 0.25 * s;
                break;
              case 'drought':
                regen *= Math.max(0, 1 - 0.7 * s);
                drain += 0.1 * s;
                break;
              case 'heatwave':
                regen *= Math.max(0, 1 - 0.45 * s);
                drain += 0.08 * s;
                break;
              case 'coldwave':
                regen *= Math.max(0, 1 - 0.25 * s);
                break;
            }
          }
        }

        // Diffusion toward 4-neighbor mean
        const up = this.energyGrid[(r - 1 + this.rows) % this.rows][c];
        const down = this.energyGrid[(r + 1) % this.rows][c];
        const left = this.energyGrid[r][(c - 1 + this.cols) % this.cols];
        const right = this.energyGrid[r][(c + 1) % this.cols];
        const neighAvg = (up + down + left + right) * 0.25;
        const diff = D * (neighAvg - e);

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

  getDensityAt(row, col) {
    return (
      this.densityGrid?.[row]?.[col] ?? this.localDensity(row, col, GridManager.DENSITY_RADIUS)
    );
  }

  // Precompute density for all tiles (fraction of occupied neighbors)
  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    const out = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        let count = 0,
          total = 0;

        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            if (dx === 0 && dy === 0) continue;
            const rr = (row + dy + this.rows) % this.rows;
            const cc = (col + dx + this.cols) % this.cols;

            total++;
            if (this.grid[rr][cc]) count++;
          }
        }
        out[row][col] = total > 0 ? count / total : 0;
      }
    }

    return out;
  }

  localDensity(row, col, radius = 1) {
    let count = 0;
    let total = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = (row + dy + this.rows) % this.rows;
        const cc = (col + dx + this.cols) % this.cols;

        total++;
        if (this.grid[rr][cc]) count++;
      }
    }

    return total > 0 ? count / total : 0;
  }

  draw() {
    const ctx = this.ctx;
    const cellSize = this.cellSize;
    const eventManager = this.eventManager;

    // Clear full canvas once
    ctx.clearRect(0, 0, this.cols * cellSize, this.rows * cellSize);
    // Draw cells only
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.getCell(row, col);

        if (!cell) continue;
        ctx.fillStyle = cell.color;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
    // Draw active events overlays
    if (eventManager.activeEvents && eventManager.activeEvents.length > 0) {
      for (const ev of eventManager.activeEvents) {
        ctx.fillStyle =
          typeof eventManager.getColor === 'function'
            ? eventManager.getColor(ev)
            : 'rgba(255,255,255,0.15)';
        ctx.fillRect(
          ev.affectedArea.x * cellSize,
          ev.affectedArea.y * cellSize,
          ev.affectedArea.width * cellSize,
          ev.affectedArea.height * cellSize
        );
      }
    }
  }

  update({
    densityEffectMultiplier = 1,
    societySimilarity = 1,
    enemySimilarity = 0,
    eventStrengthMultiplier = 1,
    energyRegenRate = GridManager.energyRegenRate,
    energyDiffusionRate = GridManager.energyDiffusionRate,
  } = {}) {
    const stats = this.stats;
    const eventManager = this.eventManager;

    this.lastSnapshot = null;

    // Precompute density grid for this tick
    this.densityGrid = this.computeDensityGrid(GridManager.DENSITY_RADIUS);

    this.regenerateEnergyGrid(
      eventManager.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      this.densityGrid
    );
    const processed = new WeakSet();

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.grid[row][col];

        if (!cell || processed.has(cell)) continue;
        processed.add(cell);
        cell.age++;
        if (cell.age >= cell.lifespan) {
          this.grid[row][col] = null;
          stats.onDeath();
          continue;
        }
        const evs = eventManager.activeEvents || [];

        for (const ev of evs) {
          cell.applyEventEffects(row, col, ev, eventStrengthMultiplier, GridManager.maxTileEnergy);
        }
        this.consumeEnergy(cell, row, col);
        const localDensity = this.densityGrid[row][col];

        const starved = cell.manageEnergy(row, col, {
          localDensity,
          densityEffectMultiplier,
          maxTileEnergy: GridManager.maxTileEnergy,
        });

        if (starved || cell.energy <= 0) {
          this.grid[row][col] = null;
          stats.onDeath();
          continue;
        }
        // Activity gate: some genomes idle more/less per tick
        const act = typeof cell.dna.activityRate === 'function' ? cell.dna.activityRate() : 1;

        if (Math.random() > act) {
          continue;
        }
        const { mates, enemies, society } = this.findTargets(row, col, cell, {
          densityEffectMultiplier,
          societySimilarity,
          enemySimilarity,
        });

        // Prefer mates; if none, allow allies (society) as fallback
        const matePool = mates.length > 0 ? mates : society;

        if (matePool.length > 0) {
          const bestMate = cell.findBestMate(matePool);

          if (bestMate) {
            GridManager.moveToTarget(
              this.grid,
              row,
              col,
              bestMate.row,
              bestMate.col,
              this.rows,
              this.cols
            );
            const localDensity = this.densityGrid[row][col];
            const reproProb = cell.computeReproductionProbability(bestMate.target, {
              localDensity,
              densityEffectMultiplier,
            });

            const thrFracA =
              typeof cell.dna.reproductionThresholdFrac === 'function'
                ? cell.dna.reproductionThresholdFrac()
                : 0.4;
            const thrFracB =
              typeof bestMate.target.dna.reproductionThresholdFrac === 'function'
                ? bestMate.target.dna.reproductionThresholdFrac()
                : 0.4;
            const thrA = thrFracA * GridManager.maxTileEnergy;
            const thrB = thrFracB * GridManager.maxTileEnergy;

            if (randomPercent(reproProb) && cell.energy >= thrA && bestMate.target.energy >= thrB) {
              const offspring = Cell.breed(cell, bestMate.target);

              this.grid[row][col] = offspring;
              stats.onBirth();
            }
          }
        } else if (enemies.length > 0) {
          const targetEnemy = enemies[Math.floor(randomRange(0, enemies.length))];
          const localDensity = this.localDensity(row, col, GridManager.DENSITY_RADIUS);
          const action = cell.chooseInteractionAction({
            localDensity,
            densityEffectMultiplier,
          });

          if (action === 'avoid') {
            GridManager.moveAwayFromTarget(
              this.grid,
              row,
              col,
              targetEnemy.row,
              targetEnemy.col,
              this.rows,
              this.cols
            );
          } else if (action === 'fight') {
            const dist = Math.max(Math.abs(targetEnemy.row - row), Math.abs(targetEnemy.col - col));

            if (dist <= 1) cell.fightEnemy(this, row, col, targetEnemy.row, targetEnemy.col, stats);
            else
              GridManager.moveToTarget(
                this.grid,
                row,
                col,
                targetEnemy.row,
                targetEnemy.col,
                this.rows,
                this.cols
              );
          } else {
            const dist = Math.max(Math.abs(targetEnemy.row - row), Math.abs(targetEnemy.col - col));

            if (dist <= 1)
              cell.cooperateWithEnemy(
                this,
                row,
                col,
                targetEnemy.row,
                targetEnemy.col,
                GridManager.maxTileEnergy,
                stats
              );
            else
              GridManager.moveToTarget(
                this.grid,
                row,
                col,
                targetEnemy.row,
                targetEnemy.col,
                this.rows,
                this.cols
              );
          }
        } else {
          const localDensity2 = this.densityGrid[row][col];

          cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || [], {
            localDensity: localDensity2,
            densityEffectMultiplier,
            rows: this.rows,
            cols: this.cols,
            moveToTarget: GridManager.moveToTarget,
            moveAwayFromTarget: GridManager.moveAwayFromTarget,
            moveRandomly: GridManager.moveRandomly,
            tryMove: GridManager.tryMove,
            getEnergyAt: (rr, cc) => this.energyGrid[rr][cc] / GridManager.maxTileEnergy,
          });
        }
      }
    }

    this.lastSnapshot = this.buildSnapshot();

    return this.lastSnapshot;
  }

  buildSnapshot(maxTileEnergy = GridManager.maxTileEnergy) {
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

        const fitness = computeFitness(cell, maxTileEnergy);
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
        const newRow = (row + y + this.rows) % this.rows;
        const newCol = (col + x + this.cols) % this.cols;
        const target = this.grid[newRow][newCol];

        if (target) {
          const similarity = cell.similarityTo(target);

          if (similarity >= allyT) {
            society.push({ row: newRow, col: newCol, target });
          } else if (similarity <= enemyT || randomPercent(enemyBias)) {
            enemies.push({ row: newRow, col: newCol, target });
          } else {
            mates.push({ row: newRow, col: newCol, target });
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
        const rr = (centerRow + dy + this.rows) % this.rows;
        const cc = (centerCol + dx + this.cols) % this.cols;

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

      if (!this.grid[rr][cc]) {
        const dna = DNA.random();

        this.grid[rr][cc] = new Cell(rr, cc, dna);
        this.stats?.onBirth?.();
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
