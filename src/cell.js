import DNA from './genome.js';
import { randomRange, clamp, lerp } from './utils.js';

export default class Cell {
  // TODO: The cells' colors should BE their genes. The RGB values should BE the DNA
  // Each value (0-255) represents genes that control behavior
  // Every one of the cell's preferences, inheritable traits, etc. is derived from these genes
  // This will make it easier to visualize evolution and relationships between cells: for any given cell,
  // its color is a direct representation of its genetic code
  static baseEnergyLoss = 0.05;
  static chanceToMutate = 0.15;
  static geneMutationRange = 0.2;
  static minAge = 100;
  static maxAge = 1200;

  constructor(row, col, dna, energy) {
    this.row = row;
    this.col = col;
    this.dna = dna || DNA.random();
    this.genes = this.dna.weights();
    this.color = this.dna.toColor();
    this.age = 0;
    this.lifespan = this.dna.lifespan(Cell.maxAge, Cell.minAge);
    this.sight = this.dna.sight();
    this.energy = energy ?? this.dna.initialEnergy(window.GridManager?.maxTileEnergy ?? 5);
    this.neurons = this.dna.neurons();
    this.strategy = this.dna.strategy();
    this.movementGenes = this.dna.movementGenes();
    this.interactionGenes = this.dna.interactionGenes();
    this.density = this.dna.densityResponses();
    this.offspring = 0;
    this.fightsWon = 0;
    this.fightsLost = 0;
  }

  static breed(parentA, parentB) {
    const row = parentA.row;
    const col = parentA.col;
    const chance = (parentA.dna.mutationChance() + parentB.dna.mutationChance()) / 2;
    const range = Math.round((parentA.dna.mutationRange() + parentB.dna.mutationRange()) / 2);
    const childDNA = parentA.dna.reproduceWith(parentB.dna, chance, range);
    const offspringEnergy = Math.max((parentA.energy + parentB.energy) / 2, 0.5);
    const offspring = new Cell(row, col, childDNA, offspringEnergy);
    const strategy =
      (parentA.strategy + parentB.strategy) / 2 +
      (Math.random() * Cell.geneMutationRange - Cell.geneMutationRange / 2);

    offspring.strategy = Math.min(1, Math.max(0, strategy));
    parentA.energy /= 2;
    parentB.energy /= 2;
    parentA.offspring = (parentA.offspring || 0) + 1;
    parentB.offspring = (parentB.offspring || 0) + 1;

    return offspring;
  }

  similarityTo(other) {
    return this.dna.similarity(other.dna);
  }

  static computeLifespan(genes) {
    const gene = genes?.[0]?.[0] ?? 0;
    const factor = Math.max(0, 1 + gene);

    return Math.round(600 * factor + randomRange(0, 600));
  }

  findBestMate(potentialMates) {
    let bestMate = null;
    let highestPreference = -Infinity;

    potentialMates.forEach((mate) => {
      const preference = this.similarityTo(mate.target);

      if (preference > highestPreference) {
        highestPreference = preference;
        bestMate = mate;
      }
    });

    return bestMate;
  }

  // Internal: nearest target utility
  #nearest(list, row, col) {
    if (!list || list.length === 0) return null;
    let best = null;
    let bestDist = Infinity;

    for (const t of list) {
      const d = Math.max(Math.abs(t.row - row), Math.abs(t.col - col));

      if (d < bestDist) {
        best = t;
        bestDist = d;
      }
    }

    return best;
  }

  decideRandomMove() {
    // 50% chance to stay still; otherwise pick one of 4 directions uniformly
    if (Math.random() < 0.5) return { dr: 0, dc: 0 };
    switch ((Math.random() * 4) | 0) {
      case 0:
        return { dr: -1, dc: 0 }; // up
      case 1:
        return { dr: 1, dc: 0 }; // down
      case 2:
        return { dr: 0, dc: -1 }; // left
      default:
        return { dr: 0, dc: 1 }; // right
    }
  }

  manageEnergy(row, col, { localDensity, densityEffectMultiplier, maxTileEnergy }) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const geneRow = this.genes?.[5];
    const metabolism = Array.isArray(geneRow)
      ? geneRow.reduce((s, g) => s + Math.abs(g), 0) / (geneRow.length || 1)
      : Math.abs(Number(geneRow) || 0);
    const energyDensityMult = lerp(this.density.energyLoss.min, this.density.energyLoss.max, effD);
    const energyLoss =
      Cell.baseEnergyLoss * this.dna.baseEnergyLossScale() * (1 + metabolism) * energyDensityMult;

    this.energy -= energyLoss;

    return this.energy <= this.starvationThreshold(maxTileEnergy);
  }

  starvationThreshold(maxTileEnergy = 5) {
    return this.dna.starvationThresholdFrac() * maxTileEnergy;
  }

  static randomMovementGenes() {
    return {
      wandering: randomRange(0, 1),
      pursuit: randomRange(0, 1),
      cautious: randomRange(0, 1),
    };
  }

  chooseMovementStrategy(localDensity = 0, densityEffectMultiplier = 1) {
    let { wandering, pursuit, cautious } = this.movementGenes;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const cautiousMul = lerp(this.density.cautious.min, this.density.cautious.max, effD);
    const pursuitMul = lerp(this.density.pursuit.max, this.density.pursuit.min, effD);
    const cautiousScaled = Math.max(0, cautious * cautiousMul);
    const pursuitScaled = Math.max(0, pursuit * pursuitMul);
    const wanderingScaled = Math.max(0, wandering);
    const total = wanderingScaled + pursuitScaled + cautiousScaled || 1;
    const r = randomRange(0, total);

    if (r < wanderingScaled) return 'wandering';
    if (r < wanderingScaled + pursuitScaled) return 'pursuit';

    return 'cautious';
  }

  executeMovementStrategy(
    gridArr,
    row,
    col,
    mates,
    enemies,
    society,
    {
      localDensity,
      densityEffectMultiplier,
      rows,
      cols,
      moveToTarget,
      moveAwayFromTarget,
      moveRandomly,
      getEnergyAt,
    }
  ) {
    const strategy = this.chooseMovementStrategy(localDensity, densityEffectMultiplier);

    if (strategy === 'pursuit') {
      const target =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (target) return moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

      return moveRandomly(gridArr, row, col, this, rows, cols);
    }
    if (strategy === 'cautious') {
      const threat =
        this.#nearest(enemies, row, col) ||
        this.#nearest(mates, row, col) ||
        this.#nearest(society, row, col);

      if (threat) return moveAwayFromTarget(gridArr, row, col, threat.row, threat.col, rows, cols);

      return moveRandomly(gridArr, row, col, this, rows, cols);
    }
    // wandering: bias toward best energy neighbor if provided
    if (typeof getEnergyAt === 'function') {
      const dirs = [
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 },
      ];
      let best = null;
      let bestE = -Infinity;

      for (const d of dirs) {
        const rr = (row + d.dr + rows) % rows;
        const cc = (col + d.dc + cols) % cols;
        const occPenalty = gridArr[rr][cc] ? -1 : 0;
        const e = (getEnergyAt(rr, cc) ?? 0) + occPenalty;

        if (e > bestE) {
          bestE = e;
          best = d;
        }
      }
      const g = this.movementGenes || { wandering: 1, pursuit: 1, cautious: 1 };
      const total =
        Math.max(0, g.wandering) + Math.max(0, g.pursuit) + Math.max(0, g.cautious) || 1;
      const pExploit = 0.5 + 0.4 * (Math.max(0, g.wandering) / total);

      if (best && Math.random() < pExploit) {
        // Prefer direct move if helper provided; fallback to random
        return typeof moveRandomly === 'function'
          ? gridArr[(row + best.dr + rows) % rows][(col + best.dc + cols) % cols] == null
            ? ((gridArr[(row + best.dr + rows) % rows][(col + best.dc + cols) % cols] =
                gridArr[row][col]),
              (gridArr[row][col] = null),
              true)
            : moveRandomly(gridArr, row, col, this, rows, cols)
          : false;
      }
    }

    return moveRandomly(gridArr, row, col, this, rows, cols);
  }

  computeReproductionProbability(partner, { localDensity, densityEffectMultiplier }) {
    const baseReproProb = (this.dna.reproductionProb() + partner.dna.reproductionProb()) / 2;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const reproMul = lerp(this.density.reproduction.max, this.density.reproduction.min, effD);

    return Math.min(0.95, Math.max(0.01, baseReproProb * reproMul));
  }

  chooseInteractionAction({ localDensity, densityEffectMultiplier }) {
    const { avoid, fight, cooperate } = this.interactionGenes;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const fightMul = lerp(this.density.fight.min, this.density.fight.max, effD);
    const coopMul = lerp(this.density.cooperate.max, this.density.cooperate.min, effD);
    const fightW = Math.max(0.0001, fight * fightMul);
    const coopW = Math.max(0.0001, cooperate * coopMul);
    const avoidW = Math.max(0.0001, avoid);
    const total = avoidW + fightW + coopW;
    const roll = randomRange(0, total);

    if (roll < avoidW) return 'avoid';
    if (roll < avoidW + fightW) return 'fight';

    return 'cooperate';
  }

  applyEventEffects(row, col, currentEvent, eventStrengthMultiplier = 1, maxTileEnergy = 5) {
    if (
      currentEvent &&
      row >= currentEvent.affectedArea.y &&
      row < currentEvent.affectedArea.y + currentEvent.affectedArea.height &&
      col >= currentEvent.affectedArea.x &&
      col < currentEvent.affectedArea.x + currentEvent.affectedArea.width
    ) {
      const s = currentEvent.strength * eventStrengthMultiplier;

      switch (currentEvent.eventType) {
        case 'flood':
          this.energy -= 0.3 * s * (1 - this.dna.floodResist());
          break;
        case 'drought':
          this.energy -= 0.25 * s * (1 - this.dna.droughtResist());
          break;
        case 'heatwave':
          this.energy -= 0.35 * s * (1 - this.dna.heatResist());
          break;
        case 'coldwave':
          this.energy -= 0.2 * s * (1 - this.dna.coldResist());
          break;
      }
      this.energy = Math.max(0, Math.min(maxTileEnergy, this.energy));
    }
  }

  fightEnemy(manager, attackerRow, attackerCol, targetRow, targetCol, stats) {
    const attacker = this; // should be manager.grid[attackerRow][attackerCol]
    const defender = manager.grid[targetRow][targetCol];

    if (!defender) return;
    if (attacker.energy >= defender.energy) {
      manager.grid[targetRow][targetCol] = attacker;
      manager.grid[attackerRow][attackerCol] = null;
      manager.consumeEnergy(attacker, targetRow, targetCol);
      stats?.onFight?.();
      stats?.onDeath?.();
      attacker.fightsWon = (attacker.fightsWon || 0) + 1;
      defender.fightsLost = (defender.fightsLost || 0) + 1;
    } else {
      manager.grid[attackerRow][attackerCol] = null;
      stats?.onFight?.();
      stats?.onDeath?.();
      defender.fightsWon = (defender.fightsWon || 0) + 1;
      attacker.fightsLost = (attacker.fightsLost || 0) + 1;
    }
  }

  cooperateWithEnemy(manager, row, col, targetRow, targetCol, maxTileEnergy = 5, stats) {
    const cell = this; // same as manager.grid[row][col]
    const partner = manager.grid[targetRow][targetCol];

    if (!partner) return;
    const share = Math.min(1, cell.energy / 2);

    cell.energy -= share;
    partner.energy = Math.min(maxTileEnergy, partner.energy + share);
    stats?.onCooperate?.();
  }
}
