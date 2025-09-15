import { randomRange, randomPercent, clamp } from '../utils.js';
import DNA from '../genome.js';
import Cell from './cell.js';
import { DENSITY_RADIUS, lerp, moveToTarget, moveAwayFromTarget } from './helpers.js';

function fightEnemy(manager, attackerRow, attackerCol, targetRow, targetCol) {
  const stats = window.stats;
  const attacker = manager.grid[attackerRow][attackerCol];
  const defender = manager.grid[targetRow][targetCol];

  if (!defender) return;
  if (attacker.energy >= defender.energy) {
    manager.grid[targetRow][targetCol] = attacker;
    manager.grid[attackerRow][attackerCol] = null;
    manager.consumeEnergy(attacker, targetRow, targetCol);
    stats.onFight();
    stats.onDeath();
    attacker.fightsWon = (attacker.fightsWon || 0) + 1;
    defender.fightsLost = (defender.fightsLost || 0) + 1;
  } else {
    manager.grid[attackerRow][attackerCol] = null;
    stats.onFight();
    stats.onDeath();
    defender.fightsWon = (defender.fightsWon || 0) + 1;
    attacker.fightsLost = (attacker.fightsLost || 0) + 1;
  }
}

function cooperateWithEnemy(manager, row, col, targetRow, targetCol) {
  const stats = window.stats;
  const cell = manager.grid[row][col];
  const partner = manager.grid[targetRow][targetCol];

  if (!partner) return;
  const share = Math.min(1, cell.energy / 2);

  cell.energy -= share;
  partner.energy = Math.min(GridManager.maxTileEnergy, partner.energy + share);
  stats.onCooperate();
}

function applyEventEffects(cell, row, col, currentEvent) {
  const uiManager = window.uiManager;

  if (
    currentEvent &&
    row >= currentEvent.affectedArea.y &&
    row < currentEvent.affectedArea.y + currentEvent.affectedArea.height &&
    col >= currentEvent.affectedArea.x &&
    col < currentEvent.affectedArea.x + currentEvent.affectedArea.width
  ) {
    const s = currentEvent.strength * uiManager.getEventStrengthMultiplier();

    switch (currentEvent.eventType) {
      case 'flood': {
        const resist = cell.dna.floodResist();

        cell.energy -= 0.3 * s * (1 - resist);
        break;
      }
      case 'drought': {
        const resist = cell.dna.droughtResist();

        cell.energy -= 0.25 * s * (1 - resist);
        break;
      }
      case 'heatwave': {
        const resist = cell.dna.heatResist();

        cell.energy -= 0.35 * s * (1 - resist);
        break;
      }
      case 'coldwave': {
        const resist = cell.dna.coldResist();

        cell.energy -= 0.2 * s * (1 - resist);
        break;
      }
    }
    cell.energy = Math.max(0, Math.min(GridManager.maxTileEnergy, cell.energy));
  }
}

export default class GridManager {
  static maxTileEnergy = 5;
  static energyRegenRate = 0.25;

  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => GridManager.maxTileEnergy / 2)
    );
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

  regenerateEnergyGrid() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.energyGrid[r][c] = Math.min(
          GridManager.maxTileEnergy,
          this.energyGrid[r][c] + GridManager.energyRegenRate
        );
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
    const ctx = window.ctx;
    const cellSize = window.cellSize;
    const eventManager = window.eventManager;

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

  update() {
    const uiManager = window.uiManager;
    const stats = window.stats;
    const eventManager = window.eventManager;
    const populationDensity = this.calculatePopulationDensity();
    const minPopulation = Math.floor(this.rows * this.cols * 0.05);
    const currentPopulation = Math.floor(populationDensity * this.rows * this.cols);

    this.seed(currentPopulation, minPopulation);

    this.regenerateEnergyGrid();
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
        applyEventEffects(cell, row, col, eventManager.currentEvent);
        this.consumeEnergy(cell, row, col);
        cell.manageEnergy(row, col);
        if (cell.energy <= 0) {
          this.grid[row][col] = null;
          stats.onDeath();
          continue;
        }
        const { mates, enemies, society } = this.findTargets(row, col, cell);

        if (mates.length > 0) {
          const bestMate = cell.findBestMate(mates);

          if (bestMate) {
            moveToTarget(this.grid, row, col, bestMate.row, bestMate.col, this.rows, this.cols);
            const baseReproProb =
              (cell.dna.reproductionProb() + bestMate.target.dna.reproductionProb()) / 2;
            const localDensity = this.localDensity(row, col, DENSITY_RADIUS);
            const effD = clamp(localDensity * uiManager.getDensityEffectMultiplier(), 0, 1);
            const reproMul = lerp(
              cell.density.reproduction.max,
              cell.density.reproduction.min,
              effD
            );
            const reproProb = clamp(baseReproProb * reproMul, 0.01, 0.95);

            if (randomPercent(reproProb) && cell.energy >= 0.5 && bestMate.target.energy >= 0.5) {
              const offspring = Cell.breed(cell, bestMate.target);

              this.grid[row][col] = offspring;
              stats.onBirth();
            }
          }
        } else if (enemies.length > 0) {
          const targetEnemy = enemies[Math.floor(randomRange(0, enemies.length))];
          const { avoid, fight, cooperate } = cell.interactionGenes;
          const localDensity = this.localDensity(row, col, DENSITY_RADIUS);
          const effD = clamp(localDensity * uiManager.getDensityEffectMultiplier(), 0, 1);
          const fightMul = lerp(cell.density.fight.min, cell.density.fight.max, effD);
          const coopMul = lerp(cell.density.cooperate.max, cell.density.cooperate.min, effD);
          const fightW = Math.max(0.0001, fight * fightMul);
          const coopW = Math.max(0.0001, cooperate * coopMul);
          const avoidW = Math.max(0.0001, avoid);
          const total = avoidW + fightW + coopW;
          const roll = randomRange(0, total);

          if (roll < avoidW) {
            moveAwayFromTarget(
              this.grid,
              row,
              col,
              targetEnemy.row,
              targetEnemy.col,
              this.rows,
              this.cols
            );
          } else if (roll < avoidW + fightW) {
            const dist = Math.max(Math.abs(targetEnemy.row - row), Math.abs(targetEnemy.col - col));

            if (dist <= 1) fightEnemy(this, row, col, targetEnemy.row, targetEnemy.col);
            else
              moveToTarget(
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

            if (dist <= 1) cooperateWithEnemy(this, row, col, targetEnemy.row, targetEnemy.col);
            else
              moveToTarget(
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
          cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society || []);
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

  findTargets(row, col, cell) {
    const uiManager = window.uiManager;
    const mates = [];
    const enemies = [];
    const society = [];
    const d = this.localDensity(row, col, DENSITY_RADIUS);
    const effD = clamp(d * uiManager.getDensityEffectMultiplier(), 0, 1);
    const enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);

    for (let x = -cell.sight; x <= cell.sight; x++) {
      for (let y = -cell.sight; y <= cell.sight; y++) {
        if (x === 0 && y === 0) continue;
        const newRow = (row + y + this.rows) % this.rows;
        const newCol = (col + x + this.cols) % this.cols;
        const target = this.grid[newRow][newCol];

        if (target) {
          const similarity = cell.similarityTo(target);

          if (similarity >= uiManager.getSocietySimilarity()) {
            society.push({ row: newRow, col: newCol, target });
          } else if (similarity <= uiManager.getEnemySimilarity() || randomPercent(enemyBias)) {
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

window.GridManager = GridManager;
