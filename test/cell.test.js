import { test } from 'uvu';
import * as assert from 'uvu/assert';

let Cell;
let DNA;
let GENE_LOCI;
let clamp;
let lerp;
let randomRange;
let createRNG;
let InteractionSystem;

function investmentFor(energy, investFrac, starvation) {
  const desired = Math.max(0, Math.min(energy, energy * investFrac));
  const maxSpend = Math.max(0, energy - starvation);

  return Math.min(desired, maxSpend);
}

function withMockedRandom(sequence, fn) {
  const original = Math.random;
  let index = 0;

  Math.random = () => {
    if (index >= sequence.length) {
      throw new Error(`Mocked Math.random exhausted after ${index} calls`);
    }

    return sequence[index++];
  };

  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function expectClose(actual, expected, tolerance = 1e-12, message = 'values differ') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} !== ${expected}`);
}

test.before(async () => {
  ({ default: Cell } = await import('../src/cell.js'));
  ({ DNA, GENE_LOCI } = await import('../src/genome.js'));
  ({ clamp, lerp, randomRange, createRNG } = await import('../src/utils.js'));
  ({ default: InteractionSystem } = await import('../src/interactionSystem.js'));
  if (typeof global.window === 'undefined') global.window = globalThis;
  if (!window.GridManager) window.GridManager = {};
  if (typeof window.GridManager.maxTileEnergy !== 'number') {
    window.GridManager.maxTileEnergy = 12;
  }
});

function predictDeterministicOffspring(dnaA, dnaB, mutationChance, mutationRange, entropyRoll = 0) {
  const parentSeed = (dnaA.seed() ^ dnaB.seed()) >>> 0;
  const entropy = Math.floor(entropyRoll * 0xffffffff) >>> 0;
  const rng = createRNG((parentSeed ^ entropy) >>> 0);
  const blendA = typeof dnaA.crossoverMix === 'function' ? dnaA.crossoverMix() : 0.5;
  const blendB = typeof dnaB.crossoverMix === 'function' ? dnaB.crossoverMix() : 0.5;
  const blendProbability = clamp((blendA + blendB) / 2, 0, 1);
  const range = Math.max(0, mutationRange | 0);
  const geneCount = Math.max(dnaA.length ?? 0, dnaB.length ?? 0);

  const mixGene = (a, b) => {
    let value;

    if (rng() < blendProbability) {
      const weight = rng();

      value = Math.round(a * weight + b * (1 - weight));
    } else {
      value = rng() < 0.5 ? a : b;
    }

    if (rng() < mutationChance) {
      value += Math.floor(randomRange(-1, 1, rng) * range);
    }

    return Math.max(0, Math.min(255, value));
  };

  const genes = new Uint8Array(geneCount);

  for (let i = 0; i < geneCount; i++) {
    genes[i] = mixGene(dnaA.geneAt(i), dnaB.geneAt(i));
  }

  return genes;
}

test('manageEnergy applies DNA-driven metabolism and starvation rules', () => {
  const dna = new DNA(30, 200, 100);
  const initialEnergy = 5;
  const maxTileEnergy = 12;
  const cell = new Cell(2, 3, dna, initialEnergy);
  const context = { localDensity: 0.3, densityEffectMultiplier: 2, maxTileEnergy: 12 };
  const effDensity = clamp(context.localDensity * context.densityEffectMultiplier, 0, 1);
  const densityResponse = dna.densityResponses().energyLoss;
  const energyDensityMult = lerp(densityResponse.min, densityResponse.max, effDensity);
  const metabolism = cell.metabolism;
  const sen = typeof dna.senescenceRate === 'function' ? dna.senescenceRate() : 0;
  const baseLoss = dna.energyLossBase();
  const ageFrac = cell.lifespan > 0 ? cell.age / cell.lifespan : 0;
  const lossScale =
    dna.baseEnergyLossScale() * (1 + metabolism) * (1 + sen * ageFrac) * energyDensityMult;
  const energyLoss = clamp(baseLoss * lossScale, 0.004, 0.35);
  const cognitiveLoss = dna.cognitiveCost(cell.neurons, cell.sight, effDensity);

  const starving = cell.manageEnergy(cell.row, cell.col, context);
  const expectedEnergy = initialEnergy - (energyLoss + cognitiveLoss);
  const starvationThreshold = dna.starvationThresholdFrac() * context.maxTileEnergy;

  expectClose(cell.energy, expectedEnergy, 1e-12, 'energy after management');
  assert.ok(cell.energy < initialEnergy, 'energy should decrease');
  assert.is(starving, expectedEnergy <= starvationThreshold);
});

test('movement sensors update DNA-tuned resource trend signal', () => {
  const dna = new DNA(120, 160, 200);

  dna.genes[GENE_LOCI.SENSE] = 200;
  dna.genes[GENE_LOCI.EXPLORATION] = 0;
  dna.genes[GENE_LOCI.RECOVERY] = 25;
  const initialEnergy = 2;
  const cell = new Cell(1, 1, dna, initialEnergy);
  const adaptation = dna.resourceTrendAdaptation();
  const baselineRate = clamp(adaptation * 0.25, 0.01, 0.6);
  const tileEnergy = 0.1;
  const tileEnergyDelta = -0.3;
  const priorBaseline = cell._resourceBaseline;
  const priorDelta = cell._resourceDelta;
  const expectedDelta = lerp(priorDelta, tileEnergyDelta, adaptation);
  const expectedBaseline = lerp(priorBaseline, tileEnergy, baselineRate);
  const expectedDivergence = clamp(tileEnergy - expectedBaseline, -1, 1);
  const expectedSignal = clamp(expectedDelta * 0.7 + expectedDivergence * 0.6, -1, 1);

  cell.chooseMovementStrategy({
    localDensity: 0.2,
    densityEffectMultiplier: 1,
    mates: [],
    enemies: [],
    society: [],
    maxTileEnergy: window.GridManager.maxTileEnergy,
    tileEnergy,
    tileEnergyDelta,
  });

  expectClose(cell._resourceDelta, expectedDelta, 1e-12, 'resource delta smoothing');
  expectClose(cell._resourceBaseline, expectedBaseline, 1e-12, 'resource baseline smoothing');
  expectClose(cell._resourceSignal, expectedSignal, 1e-12, 'resource trend signal');
});

test('breed spends parental investment energy without creating extra energy', () => {
  const dnaA = new DNA(10, 120, 200);
  const dnaB = new DNA(200, 80, 40);
  const parentA = new Cell(4, 5, dnaA, 8);
  const parentB = new Cell(4, 5, dnaB, 9);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const investFracA = dnaA.parentalInvestmentFrac();
  const investFracB = dnaB.parentalInvestmentFrac();
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const investA = investmentFor(energyBeforeA, investFracA, starvationA);
  const investB = investmentFor(energyBeforeB, investFracB, starvationB);
  const totalInvestment = investA + investB;

  const child = withMockedRandom([0.9, 0.9, 0.9, 0.5], () => Cell.breed(parentA, parentB));

  const expectedEnergy = totalInvestment;

  assert.ok(child instanceof Cell, 'breed should return a Cell');
  assert.is(child.row, parentA.row);
  assert.is(child.col, parentA.col);
  expectClose(child.energy, expectedEnergy, 1e-12, 'offspring energy');
  expectClose(parentA.energy, energyBeforeA - investA, 1e-12, 'parent A energy');
  expectClose(parentB.energy, energyBeforeB - investB, 1e-12, 'parent B energy');
  expectClose(
    totalInvestment,
    energyBeforeA - parentA.energy + (energyBeforeB - parentB.energy),
    1e-12,
    'investments match energy spent'
  );
  assert.is(parentA.offspring, 1);
  assert.is(parentB.offspring, 1);
  assert.ok(parentA.energy >= starvationA, 'parent A respects starvation floor');
  assert.ok(parentB.energy >= starvationB, 'parent B respects starvation floor');
});

test('breed returns null when either parent lacks investable energy', () => {
  const dnaA = new DNA(240, 10, 10);
  const dnaB = new DNA(240, 10, 10);
  const parentA = new Cell(3, 4, dnaA, 0);
  const parentB = new Cell(3, 4, dnaB, 2);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const starvationA = parentA.starvationThreshold(window.GridManager.maxTileEnergy);
  const starvationB = parentB.starvationThreshold(window.GridManager.maxTileEnergy);

  const offspring = Cell.breed(parentA, parentB);

  assert.is(offspring, null, 'offspring should be null when investments are zero');
  expectClose(parentA.energy, energyBeforeA, 1e-12, 'parent A energy unchanged');
  expectClose(parentB.energy, energyBeforeB, 1e-12, 'parent B energy unchanged');
  assert.is(parentA.offspring, 0);
  assert.is(parentB.offspring, 0);
  assert.ok(
    parentA.energy <= starvationA,
    'parent A stays at or below starvation floor when energy is insufficient'
  );
  assert.ok(
    parentB.energy <= starvationB,
    'parent B stays at or below starvation floor when energy is insufficient'
  );
});

test('breed clamps investment so parents stop at starvation threshold', () => {
  const dnaA = new DNA(30, 240, 220);
  const dnaB = new DNA(200, 220, 60);
  const parentA = new Cell(5, 6, dnaA, 6);
  const parentB = new Cell(5, 6, dnaB, 6);
  const maxTileEnergy = window.GridManager.maxTileEnergy;
  const starvationA = parentA.starvationThreshold(maxTileEnergy);
  const starvationB = parentB.starvationThreshold(maxTileEnergy);
  const energyBeforeA = parentA.energy;
  const energyBeforeB = parentB.energy;
  const expectedInvestA = investmentFor(energyBeforeA, dnaA.parentalInvestmentFrac(), starvationA);
  const expectedInvestB = investmentFor(energyBeforeB, dnaB.parentalInvestmentFrac(), starvationB);

  assert.ok(starvationA > 0, 'starvation threshold should be positive');
  assert.ok(starvationB > 0, 'starvation threshold should be positive');

  const child = withMockedRandom([0.6, 0.6, 0.6, 0.5], () => Cell.breed(parentA, parentB));

  assert.ok(child instanceof Cell, 'offspring should be produced when both can invest');
  assert.ok(parentA.energy >= starvationA, 'parent A energy stays above starvation floor');
  assert.ok(parentB.energy >= starvationB, 'parent B energy stays above starvation floor');
  expectClose(
    parentA.energy,
    energyBeforeA - expectedInvestA,
    1e-12,
    'parent A investment matches clamp'
  );
  expectClose(
    parentB.energy,
    energyBeforeB - expectedInvestB,
    1e-12,
    'parent B investment matches clamp'
  );
  expectClose(
    child.energy,
    expectedInvestA + expectedInvestB,
    1e-12,
    'child energy equals combined investments'
  );
});

test('breed applies deterministic crossover and honors forced mutation', () => {
  const dnaA = new DNA(100, 150, 200);
  const dnaB = new DNA(140, 160, 210);
  const parentA = new Cell(7, 8, dnaA, 6);
  const parentB = new Cell(7, 8, dnaB, 6);
  const avgStrategy = (parentA.strategy + parentB.strategy) / 2;

  // Force mutation to trigger and make expectations deterministic
  dnaA.mutationChance = () => 1;
  dnaB.mutationChance = () => 1;
  dnaA.mutationRange = () => 12;
  dnaB.mutationRange = () => 12;

  const chance = 1;
  const range = 12;
  const entropyRoll = 0.25;
  const expectedGenes = predictDeterministicOffspring(dnaA, dnaB, chance, range, entropyRoll);
  const child = withMockedRandom([entropyRoll, 0.5], () => Cell.breed(parentA, parentB));

  assert.is(child.dna.length, expectedGenes.length);
  for (let i = 0; i < expectedGenes.length; i++) {
    assert.is(child.dna.geneAt(i), expectedGenes[i]);
  }
  expectClose(child.strategy, avgStrategy, 1e-12, 'strategy averages when mutation delta is zero');
});

test('interaction intents resolve fights via interaction system', () => {
  const attackerDNA = new DNA(10, 20, 30);
  const defenderDNA = new DNA(15, 25, 35);

  attackerDNA.fightCost = () => 0;
  defenderDNA.fightCost = () => 0;
  attackerDNA.combatPower = () => 1;
  defenderDNA.combatPower = () => 1;

  const attacker = new Cell(0, 0, attackerDNA, 8);
  const defender = new Cell(0, 1, defenderDNA, 4);

  const grid = [
    [attacker, defender],
    [null, null],
  ];
  const consumeCalls = [];
  const manager = {
    grid,
    densityGrid: [
      [0, 0],
      [0, 0],
    ],
    maxTileEnergy: 12,
    consumeEnergy: (cell, row, col) => {
      consumeCalls.push({ cell, row, col });
    },
    removeCell(row, col) {
      const current = this.grid[row]?.[col] ?? null;

      if (!current) return null;

      this.grid[row][col] = null;

      return current;
    },
    relocateCell(fromRow, fromCol, toRow, toCol) {
      const moving = this.grid[fromRow]?.[fromCol] ?? null;

      if (!moving || this.grid[toRow]?.[toCol]) return false;

      this.grid[toRow][toCol] = moving;
      this.grid[fromRow][fromCol] = null;
      moving.row = toRow;
      moving.col = toCol;

      return true;
    },
  };
  const adapter = {
    getCell: (row, col) => manager.grid[row]?.[col] ?? null,
    setCell: (row, col, cell) => {
      manager.grid[row][col] = cell;

      if (cell) {
        cell.row = row;
        cell.col = col;
      }

      return cell;
    },
    removeCell: (row, col) => manager.removeCell(row, col),
    relocateCell: (fromRow, fromCol, toRow, toCol) =>
      manager.relocateCell(fromRow, fromCol, toRow, toCol),
    consumeTileEnergy: ({ cell, row, col }) => manager.consumeEnergy(cell, row, col),
    maxTileEnergy: () => manager.maxTileEnergy,
    transferEnergy: ({ from, to, amount }) => {
      const donor = from ?? null;
      const recipient = to ?? null;
      const requested = Math.max(0, amount ?? 0);

      if (!donor || requested <= 0) return 0;

      const available = Math.min(requested, donor.energy ?? 0);
      const maxEnergy = manager.maxTileEnergy;
      let accepted = available;

      if (recipient) {
        const current = recipient.energy ?? 0;
        const capacity = Math.max(0, maxEnergy - current);

        accepted = Math.max(0, Math.min(available, capacity));
        recipient.energy = current + accepted;
      }

      donor.energy = Math.max(0, (donor.energy ?? 0) - accepted);

      return accepted;
    },
  };
  let fights = 0;
  let deaths = 0;
  const stats = {
    onFight: () => fights++,
    onDeath: () => deaths++,
  };

  const interactionSystem = new InteractionSystem({ adapter });
  const intent = attacker.createFightIntent({ targetRow: 0, targetCol: 1 });

  interactionSystem.resolveIntent(intent, { stats });

  assert.is(manager.grid[0][1], attacker, 'attacker occupies the target tile after winning');
  assert.is(manager.grid[0][0], null, 'original attacker tile is emptied');
  assert.is(attacker.row, 0, 'attacker row updates to target row');
  assert.is(attacker.col, 1, 'attacker col updates to target col');
  assert.is(attacker.fightsWon, 1, 'attacker records win');
  assert.is(defender.fightsLost, 1, 'defender records loss');
  assert.is(consumeCalls.length, 1, 'energy consumption triggered once');
  assert.equal(consumeCalls[0], { cell: attacker, row: 0, col: 1 });
  assert.is(fights, 1, 'fight stat increments once');
  assert.is(deaths, 1, 'death stat increments once');
});

test('movement and interaction genes reflect DNA-coded tendencies', () => {
  const fastDNA = new DNA(120, 80, 40);
  fastDNA.genes[GENE_LOCI.MOVEMENT] = 240;
  fastDNA.genes[GENE_LOCI.EXPLORATION] = 40;
  fastDNA.genes[GENE_LOCI.RISK] = 210;
  fastDNA.genes[GENE_LOCI.COHESION] = 40;
  fastDNA.genes[GENE_LOCI.STRATEGY] = 200;

  const cautiousDNA = new DNA(60, 200, 180);
  cautiousDNA.genes[GENE_LOCI.MOVEMENT] = 30;
  cautiousDNA.genes[GENE_LOCI.EXPLORATION] = 220;
  cautiousDNA.genes[GENE_LOCI.RISK] = 20;
  cautiousDNA.genes[GENE_LOCI.COHESION] = 210;
  cautiousDNA.genes[GENE_LOCI.STRATEGY] = 40;

  const fastMovement = fastDNA.movementGenes();
  const cautiousMovement = cautiousDNA.movementGenes();

  assert.ok(fastMovement.pursuit > cautiousMovement.pursuit, 'fast genome pursues more');
  assert.ok(cautiousMovement.cautious > fastMovement.cautious, 'cautious genome rests more');
  assert.ok(cautiousMovement.wandering > fastMovement.wandering, 'explorers wander more');

  const aggressiveDNA = new DNA(220, 40, 40);
  aggressiveDNA.genes[GENE_LOCI.RISK] = 240;
  aggressiveDNA.genes[GENE_LOCI.COMBAT] = 240;
  aggressiveDNA.genes[GENE_LOCI.COOPERATION] = 10;
  aggressiveDNA.genes[GENE_LOCI.RECOVERY] = 20;

  const altruistDNA = new DNA(40, 220, 120);
  altruistDNA.genes[GENE_LOCI.RISK] = 20;
  altruistDNA.genes[GENE_LOCI.COMBAT] = 20;
  altruistDNA.genes[GENE_LOCI.COOPERATION] = 230;
  altruistDNA.genes[GENE_LOCI.PARENTAL] = 220;
  altruistDNA.genes[GENE_LOCI.RECOVERY] = 200;

  const aggressiveInteraction = aggressiveDNA.interactionGenes();
  const altruistInteraction = altruistDNA.interactionGenes();

  assert.ok(aggressiveInteraction.fight > altruistInteraction.fight, 'aggressive genome fights');
  assert.ok(altruistInteraction.cooperate > aggressiveInteraction.cooperate, 'helpers cooperate');
  assert.ok(altruistInteraction.avoid > aggressiveInteraction.avoid, 'cautious genomes avoid');
});

test('chooseEnemyTarget uses conflict focus derived from DNA', () => {
  const cautiousDNA = new DNA(80, 180, 200);
  cautiousDNA.genes[GENE_LOCI.RISK] = 20;
  cautiousDNA.genes[GENE_LOCI.COMBAT] = 30;
  cautiousDNA.genes[GENE_LOCI.STRATEGY] = 220;
  cautiousDNA.genes[GENE_LOCI.MOVEMENT] = 80;

  const boldDNA = new DNA(220, 60, 60);
  boldDNA.genes[GENE_LOCI.RISK] = 230;
  boldDNA.genes[GENE_LOCI.COMBAT] = 220;
  boldDNA.genes[GENE_LOCI.STRATEGY] = 30;
  boldDNA.genes[GENE_LOCI.MOVEMENT] = 200;

  const cautiousCell = new Cell(5, 5, cautiousDNA, 6);
  const boldCell = new Cell(5, 5, boldDNA, 6);

  const weakEnemy = new Cell(6, 5, new DNA(120, 120, 120), 2);
  weakEnemy.age = 5;
  weakEnemy.lifespan = 100;
  const strongEnemy = new Cell(1, 5, new DNA(120, 120, 120), 8);
  strongEnemy.age = 20;
  strongEnemy.lifespan = 100;

  const enemies = [
    { row: weakEnemy.row, col: weakEnemy.col, target: weakEnemy },
    { row: strongEnemy.row, col: strongEnemy.col, target: strongEnemy },
  ];

  const cautiousTarget = cautiousCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });
  const boldTarget = boldCell.chooseEnemyTarget(enemies, { maxTileEnergy: 12 });

  assert.is(cautiousTarget.target, weakEnemy, 'cautious genome prefers weaker enemy');
  assert.is(boldTarget.target, strongEnemy, 'bold genome prefers strong enemy');
});

test('cooperateShareFrac adapts to ally deficits and kinship', () => {
  const dna = new DNA(80, 200, 140);
  dna.genes[GENE_LOCI.COOPERATION] = 230;
  dna.genes[GENE_LOCI.PARENTAL] = 210;
  dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 60;
  dna.genes[GENE_LOCI.COHESION] = 220;

  const baseline = dna.cooperateShareFrac();
  const assistWeakKin = dna.cooperateShareFrac({ energyDelta: -0.6, kinship: 0.9 });
  const holdBack = dna.cooperateShareFrac({ energyDelta: 0.6, kinship: 0.1 });

  assert.ok(assistWeakKin > baseline, 'shares more with weaker kin');
  assert.ok(holdBack < baseline, 'shares less with stronger partners');
  assert.ok(assistWeakKin > holdBack, 'overall preference favors helping the weak');
});

test.run();
