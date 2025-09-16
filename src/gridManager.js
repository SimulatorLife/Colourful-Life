import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';
import EventManager from './eventManager.js';

export default class GridManager {
  static maxTileEnergy = 5;
  // Base per-tick regen before modifiers; logistic to max, density-aware
  static energyRegenRate = 0.06;
  // Fraction to diffuse toward neighbors each tick
  static energyDiffusionRate = 0.1;
  static DENSITY_RADIUS = 1;

  static tryMove(gridArr, sr, sc, dr, dc, rows, cols) {
    const nr = (sr + dr + rows) % rows;
    const nc = (sc + dc + cols) % cols;
    const dcell = gridArr[nr][nc];

    if (!dcell) {
      gridArr[nr][nc] = gridArr[sr][sc];
      gridArr[sr][sc] = null;

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
    this.eventManager = eventManager || window.eventManager;
    this.ctx = ctx || window.ctx;
    this.cellSize = cellSize || window.cellSize || 8;
    this.stats = stats || window.stats;
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
    const density = this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const crowdPenalty = Math.max(0, 1 - 0.5 * density);
    const cap = clamp(base * crowdPenalty, 0.15, 0.5);
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(GridManager.maxTileEnergy, cell.energy + take);
  }

  regenerateEnergyGrid(
    events = null,
    eventStrengthMultiplier = 1,
    R = GridManager.energyRegenRate,
    D = GridManager.energyDiffusionRate
  ) {
    const maxE = GridManager.maxTileEnergy;
    const next = Array.from({ length: this.rows }, () => Array(this.cols));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const e = this.energyGrid[r][c];
        // Logistic toward max
        let regen = R * (1 - e / maxE);
        let drain = 0;

        // Density reduces local regen (overgrazing effect)
        const density = this.localDensity(r, c, GridManager.DENSITY_RADIUS);

        regen *= Math.max(0, 1 - 0.5 * density);

        // Events modulate regen/drain (handle multiple)
        const evs = Array.isArray(events) ? events : events ? [events] : [];

        for (const ev of evs) {
          if (
            r >= ev.affectedArea.y &&
            r < ev.affectedArea.y + ev.affectedArea.height &&
            c >= ev.affectedArea.x &&
            c < ev.affectedArea.x + ev.affectedArea.width
          ) {
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
    this.energyGrid = next;
  }

  getCell(row, col) {
    return this.grid[row][col];
  }

  setCell(row, col, cell) {
    this.grid[row][col] = cell;
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

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.getCell(row, col);

        if (cell) {
          ctx.fillStyle = cell.color;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        } else {
          ctx.clearRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }
    if (eventManager.activeEvents && eventManager.activeEvents.length > 0) {
      for (const ev of eventManager.activeEvents) {
        ctx.fillStyle = EventManager.EVENT_COLORS?.[ev.eventType] || 'rgba(255,255,255,0.15)';
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

    this.regenerateEnergyGrid(
      eventManager.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate
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
        const localDensity = this.localDensity(row, col, GridManager.DENSITY_RADIUS);

        cell.manageEnergy(row, col, {
          localDensity,
          densityEffectMultiplier,
          maxTileEnergy: GridManager.maxTileEnergy,
        });
        if (cell.energy <= 0) {
          this.grid[row][col] = null;
          stats.onDeath();
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
            const localDensity = this.localDensity(row, col, GridManager.DENSITY_RADIUS);
            const reproProb = cell.computeReproductionProbability(bestMate.target, {
              localDensity,
              densityEffectMultiplier,
            });

            if (randomPercent(reproProb) && cell.energy >= 0.5 && bestMate.target.energy >= 0.5) {
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
          const localDensity2 = this.localDensity(row, col, GridManager.DENSITY_RADIUS);

          cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || [], {
            localDensity: localDensity2,
            densityEffectMultiplier,
            rows: this.rows,
            cols: this.cols,
            moveToTarget: GridManager.moveToTarget,
            moveAwayFromTarget: GridManager.moveAwayFromTarget,
            moveRandomly: GridManager.moveRandomly,
            getEnergyAt: (rr, cc) => this.energyGrid[rr][cc] / GridManager.maxTileEnergy,
          });
        }
      }
    }
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
    const d = this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const effD = clamp(d * densityEffectMultiplier, 0, 1);
    let enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);

    enemyBias = Math.max(0, enemyBias * 0.7); // reduce incidental fights ~30%

    for (let x = -cell.sight; x <= cell.sight; x++) {
      for (let y = -cell.sight; y <= cell.sight; y++) {
        if (x === 0 && y === 0) continue;
        const newRow = (row + y + this.rows) % this.rows;
        const newCol = (col + x + this.cols) % this.cols;
        const target = this.grid[newRow][newCol];

        if (target) {
          const similarity = cell.similarityTo(target);

          if (similarity >= societySimilarity) {
            society.push({ row: newRow, col: newCol, target });
          } else if (similarity <= enemySimilarity || randomPercent(enemyBias)) {
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
