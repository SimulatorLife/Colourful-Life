import DNA from './genome.js';
import { randomRange, clamp, lerp } from './utils.js';
import { isEventAffecting } from './eventManager.js';
import { getEventEffect } from './eventEffects.js';
import { MAX_TILE_ENERGY } from './config.js';

const EPSILON = 1e-9;

function softmax(logits = []) {
  if (!Array.isArray(logits) || logits.length === 0) return [];
  const maxLogit = Math.max(...logits);
  const expValues = logits.map((l) => Math.exp(l - maxLogit));
  const sum = expValues.reduce((acc, v) => acc + v, 0) || 1;

  return expValues.map((v) => v / sum);
}

function sampleFromDistribution(probabilities = [], labels = []) {
  if (!Array.isArray(probabilities) || probabilities.length === 0) return null;
  const total = probabilities.reduce((acc, v) => acc + v, 0);

  if (!Number.isFinite(total) || total <= EPSILON) return null;
  const r = Math.random() * total;
  let acc = 0;

  for (let i = 0; i < probabilities.length; i++) {
    acc += probabilities[i];

    if (r <= acc + EPSILON) return labels[i] ?? i;
  }

  return labels[labels.length - 1] ?? probabilities.length - 1;
}

export default class Cell {
  static chanceToMutate = 0.15;
  static geneMutationRange = 0.2;

  constructor(row, col, dna, energy) {
    this.row = row;
    this.col = col;
    this.dna = dna || DNA.random();
    this.genes = this.dna.weights();
    this.color = this.dna.toColor();
    this.age = 0;
    this.lifespan = this.dna.lifespanDNA();
    this.sight = this.dna.sight();
    this.energy = energy;
    this.neurons = this.dna.neurons();
    this.strategy = this.dna.strategy();
    this.movementGenes = this.dna.movementGenes();
    this.interactionGenes = this.dna.interactionGenes();
    this.density = this.dna.densityResponses();
    this.fitnessScore = null;
    this._policyCache = Object.create(null);
    this._neuralLoad = 0;
    this.lastEventPressure = 0;
    this._usedNeuralMovement = false;
    // Cache metabolism from gene row 5 to avoid per-tick recompute
    const geneRow = this.genes?.[5];

    this.metabolism = Array.isArray(geneRow)
      ? geneRow.reduce((s, g) => s + Math.abs(g), 0) / (geneRow.length || 1)
      : Math.abs(Number(geneRow) || 0);
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
    const investA = Math.min(
      parentA.energy,
      parentA.energy * (parentA.dna.parentalInvestmentFrac?.() ?? 0.4)
    );
    const investB = Math.min(
      parentB.energy,
      parentB.energy * (parentB.dna.parentalInvestmentFrac?.() ?? 0.4)
    );
    const offspringEnergy = investA + investB;
    const offspring = new Cell(row, col, childDNA, offspringEnergy);
    const strategy =
      (parentA.strategy + parentB.strategy) / 2 +
      (Math.random() * Cell.geneMutationRange - Cell.geneMutationRange / 2);

    offspring.strategy = Math.min(1, Math.max(0, strategy));
    parentA.energy = Math.max(0, parentA.energy - investA);
    parentB.energy = Math.max(0, parentB.energy - investB);
    parentA.offspring = (parentA.offspring || 0) + 1;
    parentB.offspring = (parentB.offspring || 0) + 1;

    return offspring;
  }

  similarityTo(other) {
    return this.dna.similarity(other.dna);
  }

  // Lifespan is fully DNA-dictated via genome.lifespanDNA()

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

  #canUseNeuralPolicies() {
    return (
      typeof this.dna?.prngFor === 'function' && Number.isFinite(this.neurons) && this.neurons > 0
    );
  }

  #averageSimilarity(list = []) {
    if (!Array.isArray(list) || list.length === 0) return 0;
    let total = 0;
    let count = 0;

    for (const entry of list) {
      if (!entry?.target) continue;
      total += this.similarityTo(entry.target);
      count++;
    }

    return count > 0 ? total / count : 0;
  }

  #movementSensors({
    localDensity = 0,
    densityEffectMultiplier = 1,
    mates = [],
    enemies = [],
    society = [],
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const totalNeighbors = Math.max(1, mates.length + enemies.length + society.length);
    const allyFrac = society.length / totalNeighbors;
    const enemyFrac = enemies.length / totalNeighbors;
    const mateFrac = mates.length / totalNeighbors;
    const energyFrac = clamp((this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY), 0, 1);
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const allySimilarity = this.#averageSimilarity(society);
    const enemySimilarity = this.#averageSimilarity(enemies);
    const mateSimilarity = this.#averageSimilarity(mates);
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);

    return [
      energyFrac,
      effD,
      allyFrac,
      enemyFrac,
      mateFrac,
      allySimilarity,
      enemySimilarity,
      mateSimilarity,
      ageFrac,
      eventPressure,
    ];
  }

  #interactionSensors({
    localDensity = 0,
    densityEffectMultiplier = 1,
    enemies = [],
    allies = [],
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const totalNeighbors = Math.max(1, enemies.length + allies.length);
    const enemyFrac = enemies.length / totalNeighbors;
    const allyFrac = allies.length / totalNeighbors;
    const energyFrac = clamp((this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY), 0, 1);
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const enemySimilarity = this.#averageSimilarity(enemies);
    const allySimilarity = this.#averageSimilarity(allies);
    const riskTolerance =
      typeof this.dna?.riskTolerance === 'function' ? this.dna.riskTolerance() : 0.5;
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);

    return [
      energyFrac,
      effD,
      enemyFrac,
      allyFrac,
      enemySimilarity,
      allySimilarity,
      ageFrac,
      riskTolerance,
      eventPressure,
    ];
  }

  #reproductionSensors(
    partner,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      maxTileEnergy = MAX_TILE_ENERGY,
      baseProbability = 0.5,
    } = {}
  ) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const energyFrac = clamp((this.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY), 0, 1);
    const partnerEnergy = clamp((partner?.energy || 0) / (maxTileEnergy || MAX_TILE_ENERGY), 0, 1);
    const similarity = partner ? this.similarityTo(partner) : 0;
    const ageFrac = this.lifespan > 0 ? clamp(this.age / this.lifespan, 0, 1) : 0;
    const partnerAgeFrac = partner?.lifespan > 0 ? clamp(partner.age / partner.lifespan, 0, 1) : 0;
    const senSelf = typeof this.dna?.senescenceRate === 'function' ? this.dna.senescenceRate() : 0;
    const senPartner =
      partner && typeof partner.dna?.senescenceRate === 'function'
        ? partner.dna.senescenceRate()
        : 0;
    const eventPressure = clamp(this.lastEventPressure || 0, 0, 1);

    return [
      energyFrac,
      partnerEnergy,
      effD,
      similarity,
      baseProbability,
      ageFrac,
      partnerAgeFrac,
      senSelf,
      senPartner,
      eventPressure,
    ];
  }

  evaluatePolicy(tag, inputs = [], outputSize = 1) {
    if (!this.#canUseNeuralPolicies()) return null;
    const inputSize = Array.isArray(inputs) ? inputs.length : 0;

    if (inputSize === 0 || !Number.isFinite(outputSize) || outputSize <= 0) return null;
    const hiddenSize = Math.max(1, Math.floor(this.neurons));
    const cacheKey = `${tag}:${inputSize}:${outputSize}:${hiddenSize}`;
    let policy = this._policyCache[cacheKey];

    if (!policy) {
      const rng = this.dna.prngFor(`policy:${tag}`);
      const hiddenWeights = [];

      for (let h = 0; h < hiddenSize; h++) {
        const weights = [];

        for (let i = 0; i < inputSize; i++) weights.push(rng() * 2 - 1);
        const bias = rng() * 2 - 1;

        hiddenWeights.push({ weights, bias });
      }

      const outputWeights = [];

      for (let o = 0; o < outputSize; o++) {
        const weights = [];

        for (let h = 0; h < hiddenSize; h++) weights.push(rng() * 2 - 1);
        const bias = rng() * 2 - 1;

        outputWeights.push({ weights, bias });
      }

      policy = { inputSize, outputSize, hiddenSize, hiddenWeights, outputWeights };
      this._policyCache[cacheKey] = policy;
    }

    if (policy.inputSize !== inputSize || policy.outputSize !== outputSize) return null;

    const hiddenActivations = policy.hiddenWeights.map(({ weights, bias }) => {
      let sum = bias;

      for (let i = 0; i < weights.length; i++) {
        sum += weights[i] * (inputs[i] ?? 0);
      }

      return Math.tanh(sum);
    });

    const logits = policy.outputWeights.map(({ weights, bias }) => {
      let sum = bias;

      for (let i = 0; i < weights.length; i++) {
        sum += weights[i] * (hiddenActivations[i] ?? 0);
      }

      return sum;
    });

    this._neuralLoad += policy.hiddenSize + policy.outputSize;

    return logits;
  }

  decideRandomMove() {
    // DNA-driven rest probability: more cautious genomes rest more
    const g = this.movementGenes || { wandering: 0.33, pursuit: 0.33, cautious: 0.34 };
    const w = Math.max(0, g.wandering);
    const p = Math.max(0, g.pursuit);
    const c = Math.max(0, g.cautious);
    const total = w + p + c || 1;
    const pStay = Math.max(0, Math.min(0.9, 0.15 + 0.7 * (c / total)));

    if (Math.random() < pStay) return { dr: 0, dc: 0 };
    // Otherwise pick one of 4 directions uniformly
    switch ((Math.random() * 4) | 0) {
      case 0:
        return { dr: -1, dc: 0 };
      case 1:
        return { dr: 1, dc: 0 };
      case 2:
        return { dr: 0, dc: -1 };
      default:
        return { dr: 0, dc: 1 };
    }
  }

  manageEnergy(row, col, { localDensity, densityEffectMultiplier, maxTileEnergy }) {
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const metabolism = this.metabolism;
    const energyDensityMult = lerp(this.density.energyLoss.min, this.density.energyLoss.max, effD);
    const ageFrac = this.lifespan > 0 ? this.age / this.lifespan : 0;
    const sen = typeof this.dna.senescenceRate === 'function' ? this.dna.senescenceRate() : 0;
    const energyLoss =
      this.dna.energyLossBase() *
      this.dna.baseEnergyLossScale() *
      (1 + metabolism) *
      (1 + sen * ageFrac) *
      energyDensityMult;
    // cognitive/perception overhead derived from DNA and recent neural evaluations
    const dynamicLoad = Math.max(0, this._neuralLoad || 0);

    this._neuralLoad = 0;
    const totalNeuralLoad = Math.max(0, (this.neurons || 0) + dynamicLoad);
    const cognitiveLoss = this.dna.cognitiveCost(totalNeuralLoad, this.sight, effD);

    this.energy -= energyLoss + cognitiveLoss;
    this.lastEventPressure = Math.max(0, (this.lastEventPressure || 0) * 0.9);

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

  #legacyChooseMovementStrategy(localDensity = 0, densityEffectMultiplier = 1) {
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

  chooseMovementStrategy({
    localDensity = 0,
    densityEffectMultiplier = 1,
    mates = [],
    enemies = [],
    society = [],
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const fallback = () =>
      this.#legacyChooseMovementStrategy(localDensity, densityEffectMultiplier);
    const inputs = this.#movementSensors({
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
    });
    const logits = this.evaluatePolicy('movement-strategy', inputs, 3);
    const labels = ['wandering', 'pursuit', 'cautious'];

    if (Array.isArray(logits) && logits.length === labels.length) {
      const probs = softmax(logits);
      const choice = sampleFromDistribution(probs, labels);

      if (choice) {
        this._usedNeuralMovement = true;

        return choice;
      }
    }

    this._usedNeuralMovement = false;

    return fallback();
  }

  #legacyExecuteMovementStrategy(
    gridArr,
    row,
    col,
    mates,
    enemies,
    society,
    {
      localDensity = 0,
      densityEffectMultiplier = 1,
      rows,
      cols,
      moveToTarget,
      moveAwayFromTarget,
      moveRandomly,
      getEnergyAt,
      tryMove,
    } = {}
  ) {
    const strategy = this.#legacyChooseMovementStrategy(localDensity, densityEffectMultiplier);

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
    // wandering: try cohesion toward allies first
    if (Array.isArray(society) && society.length > 0) {
      const coh = typeof this.dna.cohesion === 'function' ? this.dna.cohesion() : 0;

      if (Math.random() < coh) {
        const target = this.#nearest(society, row, col);

        if (target) return moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);
      }
    }
    // then bias toward best energy neighbor if provided
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
        const rr = row + d.dr;
        const cc = col + d.dc;

        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
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
      const dnaExploit =
        typeof this.dna.exploitationBias === 'function' ? this.dna.exploitationBias() : 0.5;
      const pExploit = Math.max(
        0.05,
        Math.min(0.95, 0.3 + 0.4 * (Math.max(0, g.wandering) / total) + 0.3 * dnaExploit)
      );

      if (best && Math.random() < pExploit) {
        if (typeof tryMove === 'function')
          return tryMove(gridArr, row, col, best.dr, best.dc, rows, cols);

        return moveRandomly(gridArr, row, col, this, rows, cols);
      }
    }

    return moveRandomly(gridArr, row, col, this, rows, cols);
  }

  executeMovementStrategy(gridArr, row, col, mates, enemies, society, context = {}) {
    const {
      localDensity = 0,
      densityEffectMultiplier = 1,
      rows,
      cols,
      moveToTarget,
      moveAwayFromTarget,
      moveRandomly,
      getEnergyAt,
      tryMove,
      maxTileEnergy = MAX_TILE_ENERGY,
    } = context;
    const strategyContext = {
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
    };
    const strategy = this.chooseMovementStrategy(strategyContext);

    if (!this._usedNeuralMovement) {
      return this.#legacyExecuteMovementStrategy(
        gridArr,
        row,
        col,
        mates,
        enemies,
        society,
        context
      );
    }

    const inputs = this.#movementSensors(strategyContext);
    const strategyEncoding = [
      strategy === 'wandering' ? 1 : 0,
      strategy === 'pursuit' ? 1 : 0,
      strategy === 'cautious' ? 1 : 0,
    ];
    const logits = this.evaluatePolicy('movement-act', [...inputs, ...strategyEncoding], 5);

    if (!Array.isArray(logits) || logits.length !== 5) {
      this._usedNeuralMovement = false;

      return this.#legacyExecuteMovementStrategy(
        gridArr,
        row,
        col,
        mates,
        enemies,
        society,
        context
      );
    }

    const probs = softmax(logits);
    const actions = ['rest', 'pursue', 'avoid', 'cohere', 'explore'];
    const chosen = sampleFromDistribution(probs, actions) || 'explore';
    const nearestEnemy = this.#nearest(enemies, row, col);
    const nearestMate = this.#nearest(mates, row, col);
    const nearestAlly = this.#nearest(society, row, col);

    const attemptEnergyExploit = () => {
      if (typeof getEnergyAt !== 'function') return false;
      const dirs = [
        { dr: -1, dc: 0 },
        { dr: 1, dc: 0 },
        { dr: 0, dc: -1 },
        { dr: 0, dc: 1 },
      ];
      let bestDir = null;
      let bestValue = -Infinity;

      for (const d of dirs) {
        const rr = row + d.dr;
        const cc = col + d.dc;

        if (rr < 0 || rr >= (rows ?? 0) || cc < 0 || cc >= (cols ?? 0)) continue;
        const occupancyPenalty = gridArr?.[rr]?.[cc] ? -1 : 0;
        const energy = (getEnergyAt(rr, cc) ?? 0) + occupancyPenalty;

        if (energy > bestValue) {
          bestValue = energy;
          bestDir = d;
        }
      }

      if (!bestDir) return false;

      if (typeof tryMove === 'function') {
        const moved = tryMove(gridArr, row, col, bestDir.dr, bestDir.dc, rows, cols);

        if (moved) return true;
      }

      if (typeof moveRandomly === 'function') {
        moveRandomly(gridArr, row, col, this, rows, cols);
      }

      return true;
    };

    switch (chosen) {
      case 'rest':
        return;
      case 'pursue': {
        const target = nearestEnemy || nearestMate || nearestAlly;

        if (target && typeof moveToTarget === 'function') {
          moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

          return;
        }

        break;
      }
      case 'avoid': {
        const threat = nearestEnemy || nearestMate || nearestAlly;

        if (threat && typeof moveAwayFromTarget === 'function') {
          moveAwayFromTarget(gridArr, row, col, threat.row, threat.col, rows, cols);

          return;
        }

        break;
      }
      case 'cohere': {
        const target = nearestAlly || nearestMate;

        if (target && typeof moveToTarget === 'function') {
          moveToTarget(gridArr, row, col, target.row, target.col, rows, cols);

          return;
        }

        break;
      }
      default:
        break;
    }

    if (chosen === 'explore' && attemptEnergyExploit()) return;

    if (typeof moveRandomly === 'function') {
      moveRandomly(gridArr, row, col, this, rows, cols);
    }
  }

  computeReproductionProbability(partner, { localDensity, densityEffectMultiplier }) {
    const baseReproProb = (this.dna.reproductionProb() + partner.dna.reproductionProb()) / 2;
    const effD = clamp(localDensity * densityEffectMultiplier, 0, 1);
    const reproMul = lerp(this.density.reproduction.max, this.density.reproduction.min, effD);
    const sA = typeof this.dna.senescenceRate === 'function' ? this.dna.senescenceRate() : 0;
    const sB = typeof partner.dna.senescenceRate === 'function' ? partner.dna.senescenceRate() : 0;
    const aA = this.lifespan > 0 ? this.age / this.lifespan : 0;
    const aB = partner.lifespan > 0 ? partner.age / partner.lifespan : 0;
    const senPenalty = 1 - 0.5 * (sA * aA + sB * aB);

    return Math.min(0.95, Math.max(0.01, baseReproProb * reproMul * Math.max(0.2, senPenalty)));
  }

  decideReproduction(partner, context = {}) {
    const {
      localDensity = 0,
      densityEffectMultiplier = 1,
      maxTileEnergy = MAX_TILE_ENERGY,
      baseProbability = 0.5,
    } = context;

    if (!this.#canUseNeuralPolicies()) {
      return { probability: baseProbability, usedNetwork: false };
    }

    const inputs = this.#reproductionSensors(partner, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy,
      baseProbability,
    });
    const logits = this.evaluatePolicy('reproduction', inputs, 2);

    if (!Array.isArray(logits) || logits.length !== 2) {
      return { probability: baseProbability, usedNetwork: false };
    }

    const probs = softmax(logits);
    const yes = clamp(probs[1], 0, 1);
    const probability = clamp((baseProbability + yes) / 2, 0, 1);

    return { probability, usedNetwork: true };
  }

  #legacyChooseInteractionAction(localDensity = 0, densityEffectMultiplier = 1) {
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

  chooseInteractionAction({
    localDensity = 0,
    densityEffectMultiplier = 1,
    enemies = [],
    allies = [],
    maxTileEnergy = MAX_TILE_ENERGY,
  } = {}) {
    const fallback = () =>
      this.#legacyChooseInteractionAction(localDensity, densityEffectMultiplier);
    const inputs = this.#interactionSensors({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies,
      maxTileEnergy,
    });
    const logits = this.evaluatePolicy('interaction', inputs, 3);
    const labels = ['avoid', 'fight', 'cooperate'];

    if (Array.isArray(logits) && logits.length === labels.length) {
      const probs = softmax(logits);
      const choice = sampleFromDistribution(probs, labels);

      if (choice) return choice;
    }

    return fallback();
  }

  applyEventEffects(row, col, currentEvent, eventStrengthMultiplier = 1, maxTileEnergy = 5) {
    if (isEventAffecting(currentEvent, row, col)) {
      const effect = getEventEffect(currentEvent?.eventType);

      if (effect?.cell) {
        const s =
          (currentEvent.strength || 0) *
          (eventStrengthMultiplier || 1) *
          (1 - 0.5 * (this.dna.recoveryRate?.() ?? 0));

        this.lastEventPressure = Math.max(this.lastEventPressure || 0, clamp(s, 0, 1));
        const { energyLoss = 0, resistanceGene } = effect.cell;
        const resistance = clamp(
          typeof resistanceGene === 'string' && typeof this.dna?.[resistanceGene] === 'function'
            ? this.dna[resistanceGene]()
            : 0,
          0,
          1
        );

        this.energy -= energyLoss * s * (1 - resistance);
      }

      this.energy = Math.max(0, Math.min(maxTileEnergy, this.energy));
    }
  }

  fightEnemy(manager, attackerRow, attackerCol, targetRow, targetCol, stats) {
    const attacker = this; // should be manager.grid[attackerRow][attackerCol]
    const defender = manager.grid[targetRow][targetCol];

    if (!defender) return;
    // Apply fight energy cost to both participants (DNA-driven)
    attacker.energy = Math.max(0, attacker.energy - attacker.dna.fightCost());
    defender.energy = Math.max(0, defender.energy - defender.dna.fightCost());
    // Resolve by DNA-based combat power
    const atkPower = attacker.energy * (attacker.dna.combatPower?.() ?? 1);
    const defPower = defender.energy * (defender.dna.combatPower?.() ?? 1);

    if (atkPower >= defPower) {
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
    const share = Math.min(maxTileEnergy, cell.energy * cell.dna.cooperateShareFrac());

    cell.energy -= share;
    partner.energy = Math.min(maxTileEnergy, partner.energy + share);
    stats?.onCooperate?.();
  }
}
