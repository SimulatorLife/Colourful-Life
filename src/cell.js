import DNA from '../genome.js';
import { randomRange, clamp } from '../utils.js';
import { DENSITY_RADIUS, lerp, moveToTarget, moveAwayFromTarget, moveRandomly } from './helpers.js';

export default class Cell {
  static baseEnergyLoss = 0.05;
  static chanceToMutate = 0.15;
  static geneMutationRange = 0.2;
  static minAge = 100;

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

  decide(n, e, s, w) {
    const inputs = [1, n, e, s, w];
    const scores = this.genes.map((weights) =>
      weights.reduce((sum, weight, idx) => sum + weight * inputs[idx], 0)
    );
    let max = scores[0];
    let index = 0;

    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > max) {
        max = scores[i];
        index = i;
      }
    }

    return index;
  }

  decideMove() {
    const r = Math.floor(randomRange(0, 4));

    if (r === 0) return { dr: -1, dc: 0 };
    if (r === 1) return { dr: 1, dc: 0 };
    if (r === 2) return { dr: 0, dc: -1 };

    return { dr: 0, dc: 1 };
  }

  manageEnergy(row, col) {
    const grid = window.grid;
    const uiManager = window.uiManager;
    const density = grid.localDensity(row, col, DENSITY_RADIUS);
    const effD = clamp(density * uiManager.getDensityEffectMultiplier(), 0, 1);
    const geneRow = this.genes?.[5];
    const metabolism = Array.isArray(geneRow)
      ? geneRow.reduce((s, g) => s + Math.abs(g), 0) / (geneRow.length || 1)
      : Math.abs(Number(geneRow) || 0);
    const energyDensityMult = lerp(this.density.energyLoss.min, this.density.energyLoss.max, effD);
    const energyLoss =
      Cell.baseEnergyLoss * this.dna.baseEnergyLossScale() * (1 + metabolism) * energyDensityMult;

    this.energy -= energyLoss;

    return this.energy <= this.starvationThreshold();
  }

  starvationThreshold() {
    return this.dna.starvationThresholdFrac() * (window.GridManager?.maxTileEnergy ?? 5);
  }

  static randomMovementGenes() {
    return {
      wandering: randomRange(0, 1),
      pursuit: randomRange(0, 1),
      cautious: randomRange(0, 1),
    };
  }

  chooseMovementStrategy(localDensity = 0) {
    let { wandering, pursuit, cautious } = this.movementGenes;
    const uiManager = window.uiManager;
    const effD = clamp(localDensity * uiManager.getDensityEffectMultiplier(), 0, 1);
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

  executeMovementStrategy(gridArr, row, col, mates, enemies, society) {
    const grid = window.grid;
    const rows = window.rows;
    const cols = window.cols;
    const localDensity = grid.localDensity(row, col, DENSITY_RADIUS);
    const strategy = this.chooseMovementStrategy(localDensity);

    if (strategy === 'pursuit' && society.length > 0) {
      const target = society[Math.floor(randomRange(0, society.length))];

      moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);
    } else if (strategy === 'cautious' && society.length > 0) {
      const target = society[Math.floor(randomRange(0, society.length))];

      moveAwayFromTarget(gridArr, row, col, target.row, target.col, rows, cols);
    } else {
      moveRandomly(gridArr, row, col, this, rows, cols);
    }
  }
}
