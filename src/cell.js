import DNA from './genome.js';
import Brain, { OUTPUT_GROUPS } from './brain.js';
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
    this.brain = Brain.fromDNA(this.dna);
    this.genes = this.dna.weights();
    this.color = this.dna.toColor();
    this.age = 0;
    this.lifespan = this.dna.lifespanDNA();
    this.sight = this.dna.sight();
    this.energy = energy;
    this.neurons = this.brain?.neuronCount || this.dna.neurons();
    this.strategy = this.dna.strategy();
    this.movementGenes = this.dna.movementGenes();
    this.interactionGenes = this.dna.interactionGenes();
    this.density = this.dna.densityResponses();
    this.fitnessScore = null;
    this.matePreferenceBias =
      typeof this.dna.mateSimilarityBias === 'function' ? this.dna.mateSimilarityBias() : 0;
    this.diversityAppetite =
      typeof this.dna.diversityAppetite === 'function' ? this.dna.diversityAppetite() : 0;
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

  static breed(parentA, parentB, mutationMultiplier = 1, options = {}) {
    const { maxTileEnergy } = options || {};
    const row = parentA.row;
    const col = parentA.col;
    const avgChance = (parentA.dna.mutationChance() + parentB.dna.mutationChance()) / 2;
    const avgRange = (parentA.dna.mutationRange() + parentB.dna.mutationRange()) / 2;
    const safeMultiplier = Number.isFinite(mutationMultiplier) ? mutationMultiplier : 1;
    const effectiveMultiplier = Math.max(0, safeMultiplier);
    const chance = Math.max(0, avgChance * effectiveMultiplier);
    const range = Math.max(0, Math.round(avgRange * effectiveMultiplier));
    const childDNA = parentA.dna.reproduceWith(parentB.dna, chance, range);
    const resolvedMaxTileEnergy =
      typeof maxTileEnergy === 'number'
        ? maxTileEnergy
        : typeof window !== 'undefined' && window.GridManager?.maxTileEnergy != null
          ? window.GridManager.maxTileEnergy
          : MAX_TILE_ENERGY;
    const calculateInvestment = (parent, starvation) => {
      const fracFn = parent.dna?.parentalInvestmentFrac;
      const investFrac = typeof fracFn === 'function' ? fracFn.call(parent.dna) : 0.4;
      const desired = Math.max(0, Math.min(parent.energy, parent.energy * investFrac));
      const maxSpend = Math.max(0, parent.energy - starvation);

      return Math.min(desired, maxSpend);
    };
    const starvationA = parentA.starvationThreshold(resolvedMaxTileEnergy);
    const starvationB = parentB.starvationThreshold(resolvedMaxTileEnergy);
    const investA = calculateInvestment(parentA, starvationA);
    const investB = calculateInvestment(parentB, starvationB);

    if (investA <= 0 || investB <= 0) return null;

    parentA.energy = Math.max(0, parentA.energy - investA);
    parentB.energy = Math.max(0, parentB.energy - investB);

    const offspringEnergy = investA + investB;
    const offspring = new Cell(row, col, childDNA, offspringEnergy);
    const strategy =
      (parentA.strategy + parentB.strategy) / 2 +
      (Math.random() * Cell.geneMutationRange - Cell.geneMutationRange / 2);

    offspring.strategy = Math.min(1, Math.max(0, strategy));
    parentA.offspring = (parentA.offspring || 0) + 1;
    parentB.offspring = (parentB.offspring || 0) + 1;

    return offspring;
  }

  similarityTo(other) {
    return this.dna.similarity(other.dna);
  }

  // Lifespan is fully DNA-dictated via genome.lifespanDNA()

  evaluateMateCandidate(mate = {}) {
    if (!mate?.target) return null;

    const similarity = this.similarityTo(mate.target);
    const diversity = 1 - similarity;
    const bias = this.matePreferenceBias ?? 0;
    const appetite = this.diversityAppetite ?? 0;
    const similarPull = similarity * (1 + Math.max(0, bias));
    const diversePull = diversity * (1 + Math.max(0, -bias) + appetite);
    const curiosityBonus = diversity * appetite * 0.5;
    const preferenceScore = similarPull + diversePull + curiosityBonus;

    return {
      ...mate,
      similarity,
      diversity,
      appetite,
      mateBias: bias,
      curiosityBonus,
      preferenceScore,
      selectionWeight: Math.max(0.0001, preferenceScore),
    };
  }

  scorePotentialMates(potentialMates = []) {
    const scored = [];

    for (let i = 0; i < potentialMates.length; i++) {
      const mate = potentialMates[i];

      if (!mate?.target) continue;
      if (
        typeof mate.preferenceScore === 'number' &&
        typeof mate.selectionWeight === 'number' &&
        typeof mate.similarity === 'number'
      ) {
        scored.push(mate);
        continue;
      }

      const evaluated = this.evaluateMateCandidate(mate);

      if (evaluated) scored.push(evaluated);
    }

    return scored;
  }

  selectMateWeighted(potentialMates = []) {
    const evaluated = this.scorePotentialMates(potentialMates).filter(
      (m) => m && m.selectionWeight > 0 && m.target
    );

    if (evaluated.length === 0) return { chosen: null, evaluated: [], mode: 'none' };

    const appetite = this.diversityAppetite ?? 0;
    let mode = 'preference';
    let chosen = null;

    const curiosityChance = Math.min(0.5, appetite * 0.25);

    if (evaluated.length > 1 && Math.random() < curiosityChance) {
      const sorted = [...evaluated].sort((a, b) => b.diversity - a.diversity);
      const tailSpan = Math.max(1, Math.ceil(sorted.length * (0.2 + appetite * 0.5)));
      const idx = Math.min(sorted.length - 1, Math.floor(Math.random() * tailSpan));

      chosen = sorted[idx];
      mode = 'curiosity';
    }

    if (!chosen) {
      const totalWeight = evaluated.reduce((sum, m) => sum + m.selectionWeight, 0);
      let roll = Math.random() * (totalWeight || 1);

      for (let i = 0; i < evaluated.length; i++) {
        const candidate = evaluated[i];

        roll -= candidate.selectionWeight;
        if (roll <= 0) {
          chosen = candidate;
          break;
        }
      }

      if (!chosen) chosen = evaluated[evaluated.length - 1];
    }

    return { chosen, evaluated, mode };
  }

  findBestMate(potentialMates) {
    if (!Array.isArray(potentialMates) || potentialMates.length === 0) return null;

    const scored = this.scorePotentialMates(potentialMates);

    if (scored.length === 0) {
      const pref = this.dna?.mateSimilarityPreference?.() ?? {};
      const target = clamp(pref.target ?? 0.75, 0, 1);
      const tolerance = Math.max(0.05, pref.tolerance ?? 0.25);
      const kinBias = clamp(pref.kinBias ?? 0.5, 0, 1);
      const dnaNoiseRng = this.dna?.prngFor ? this.dna.prngFor('mateChoice') : null;

      let fallbackMate = null;
      let bestScore = -Infinity;

      for (const mate of potentialMates) {
        const similarity = this.similarityTo(mate.target);
        const diff = Math.abs(similarity - target);
        const targetScore = Math.max(0, 1 - diff / tolerance);
        const kinScore = similarity;
        let score = (1 - kinBias) * targetScore + kinBias * kinScore;

        if (dnaNoiseRng) score += (dnaNoiseRng() - 0.5) * 0.05;
        score += (Math.random() - 0.5) * 0.05; // slight stochasticity keeps diversity

        if (score > bestScore) {
          bestScore = score;
          fallbackMate = mate;
        }
      }

      return fallbackMate;
    }

    let bestMate = null;
    let highestPreference = -Infinity;

    for (let i = 0; i < scored.length; i++) {
      const mate = scored[i];

      if (!mate) continue;
      if (mate.preferenceScore > highestPreference) {
        highestPreference = mate.preferenceScore;
        bestMate = mate;
      }
    }

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
    return Boolean(this.brain && this.brain.connectionCount > 0);
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

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      allyFraction: allyFrac,
      enemyFraction: enemyFrac,
      mateFraction: mateFrac,
      allySimilarity,
      enemySimilarity,
      mateSimilarity,
      ageFraction: ageFrac,
      eventPressure,
    };
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

    return {
      energy: energyFrac,
      effectiveDensity: effD,
      enemyFraction: enemyFrac,
      allyFraction: allyFrac,
      enemySimilarity,
      allySimilarity,
      ageFraction: ageFrac,
      riskTolerance,
      eventPressure,
    };
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

    return {
      energy: energyFrac,
      partnerEnergy,
      effectiveDensity: effD,
      partnerSimilarity: similarity,
      baseReproductionProbability: baseProbability,
      ageFraction: ageFrac,
      partnerAgeFraction: partnerAgeFrac,
      selfSenescence: senSelf,
      partnerSenescence: senPartner,
      eventPressure,
    };
  }

  #evaluateBrainGroup(group, sensors) {
    if (!this.#canUseNeuralPolicies()) return null;

    const result = this.brain.evaluateGroup(group, sensors);

    if (!result || !result.values) return null;

    const activationLoad = Math.max(0, result.activationCount || 0);

    this._neuralLoad += activationLoad;

    return result.values;
  }

  #mapLegacyStrategyToAction(strategy) {
    switch (strategy) {
      case 'pursuit':
        return 'pursue';
      case 'cautious':
        return 'avoid';
      default:
        return 'explore';
    }
  }

  #decideMovementAction(context = {}) {
    const sensors = this.#movementSensors(context);
    const values = this.#evaluateBrainGroup('movement', sensors);

    if (!values) {
      this._usedNeuralMovement = false;

      return { action: null, usedBrain: false };
    }

    const entries = OUTPUT_GROUPS.movement;
    const logits = entries.map(({ key }) => values[key] ?? 0);
    const labels = entries.map(({ key }) => key);
    const probs = softmax(logits);
    const action = sampleFromDistribution(probs, labels);

    if (!action) {
      this._usedNeuralMovement = false;

      return { action: null, usedBrain: false };
    }

    this._usedNeuralMovement = true;

    return { action, usedBrain: true };
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
    const baseLoss = this.dna.energyLossBase();
    const lossScale =
      this.dna.baseEnergyLossScale() * (1 + metabolism) * (1 + sen * ageFrac) * energyDensityMult;
    const energyLoss = baseLoss * lossScale;
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
    const decision = this.#decideMovementAction({
      localDensity,
      densityEffectMultiplier,
      mates,
      enemies,
      society,
      maxTileEnergy,
    });

    if (decision.usedBrain && decision.action) return decision.action;

    this._usedNeuralMovement = false;

    const legacy = this.#legacyChooseMovementStrategy(localDensity, densityEffectMultiplier);

    return this.#mapLegacyStrategyToAction(legacy);
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
      isTileBlocked,
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
        if (typeof isTileBlocked === 'function' && isTileBlocked(rr, cc)) continue;
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
      isTileBlocked,
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
    const decision = this.#decideMovementAction(strategyContext);

    if (!decision.usedBrain || !decision.action) {
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

    const chosen = decision.action;
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
        if (typeof isTileBlocked === 'function' && isTileBlocked(rr, cc)) continue;
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

    const sensors = this.#reproductionSensors(partner, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy,
      baseProbability,
    });
    const values = this.#evaluateBrainGroup('reproduction', sensors);

    if (!values) {
      return { probability: baseProbability, usedNetwork: false };
    }

    const entries = OUTPUT_GROUPS.reproduction;
    const logits = entries.map(({ key }) => values[key] ?? 0);
    const probs = softmax(logits);
    const acceptIndex = entries.findIndex((entry) => entry.key === 'accept');
    const yes = acceptIndex >= 0 ? clamp(probs[acceptIndex] ?? 0, 0, 1) : 0;
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
    const sensors = this.#interactionSensors({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies,
      maxTileEnergy,
    });
    const values = this.#evaluateBrainGroup('interaction', sensors);

    if (values) {
      const entries = OUTPUT_GROUPS.interaction;
      const logits = entries.map(({ key }) => values[key] ?? 0);
      const labels = entries.map(({ key }) => key);
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
      manager.clearCell(targetRow, targetCol);
      manager.clearCell(attackerRow, attackerCol);
      manager.setCell(targetRow, targetCol, attacker);
      manager.consumeEnergy(attacker, targetRow, targetCol);
      stats?.onFight?.();
      stats?.onDeath?.();
      attacker.fightsWon = (attacker.fightsWon || 0) + 1;
      defender.fightsLost = (defender.fightsLost || 0) + 1;
    } else {
      manager.clearCell(attackerRow, attackerCol);
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
