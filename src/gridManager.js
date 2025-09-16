import { randomRange, randomPercent, clamp, lerp } from './utils.js';
import DNA from './genome.js';
import Cell from './cell.js';

export default class GridManager {
  static maxTileEnergy = 5;
  static energyRegenRate = 0.25;
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
    const { dr, dc } = cell.decideMove();

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
    const take = Math.min(1, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(GridManager.maxTileEnergy, cell.energy + take);
  }

  regenerateEnergyGrid(currentEvent = null, eventStrengthMultiplier = 1) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        let regen = GridManager.energyRegenRate;
        let drain = 0;

        if (
          currentEvent &&
          r >= currentEvent.affectedArea.y &&
          r < currentEvent.affectedArea.y + currentEvent.affectedArea.height &&
          c >= currentEvent.affectedArea.x &&
          c < currentEvent.affectedArea.x + currentEvent.affectedArea.width
        ) {
          const s = (currentEvent.strength || 0) * (eventStrengthMultiplier || 1);

          switch (currentEvent.eventType) {
            case 'flood':
              regen += 0.5 * s;
              break;
            case 'drought':
              regen *= Math.max(0, 1 - 0.8 * s);
              drain += 0.12 * s;
              break;
            case 'heatwave':
              regen *= Math.max(0, 1 - 0.5 * s);
              drain += 0.08 * s;
              break;
            case 'coldwave':
              regen *= Math.max(0, 1 - 0.3 * s);
              break;
          }
        }
        const next = Math.min(
          GridManager.maxTileEnergy,
          Math.max(0, this.energyGrid[r][c] + regen - drain)
        );

        this.energyGrid[r][c] = next;
      }
    }
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
    if (eventManager.currentEvent) {
      ctx.fillStyle = eventManager.getEventColor();
      ctx.fillRect(
        eventManager.currentEvent.affectedArea.x * cellSize,
        eventManager.currentEvent.affectedArea.y * cellSize,
        eventManager.currentEvent.affectedArea.width * cellSize,
        eventManager.currentEvent.affectedArea.height * cellSize
      );
    }
  }

  update({
    densityEffectMultiplier = 1,
    societySimilarity = 1,
    enemySimilarity = 0,
    eventStrengthMultiplier = 1,
  } = {}) {
    const stats = this.stats;
    const eventManager = this.eventManager;
    const populationDensity = this.calculatePopulationDensity();
    const minPopulation = Math.floor(this.rows * this.cols * 0.05);
    const currentPopulation = Math.floor(populationDensity * this.rows * this.cols);

    this.seed(currentPopulation, minPopulation);

    this.regenerateEnergyGrid(eventManager.currentEvent, eventStrengthMultiplier);
    eventManager.updateEvent();
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
        cell.applyEventEffects(
          row,
          col,
          eventManager.currentEvent,
          eventStrengthMultiplier,
          GridManager.maxTileEnergy
        );
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

        if (mates.length > 0) {
          const bestMate = cell.findBestMate(mates);

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
    const enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);

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
}
