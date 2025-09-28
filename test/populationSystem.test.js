import { test } from 'uvu';
import * as assert from 'uvu/assert';
import PopulationSystem from '../src/grid/populationSystem.js';
import GridState from '../src/grid/gridState.js';
import InteractionSystem from '../src/interactionSystem.js';
import Cell from '../src/cell.js';

function createStubCell({ row, col, energy, dnaOverrides = {} }) {
  const dna = {
    reproductionThresholdFrac: () => 0,
    moveCost: () => 0,
    forageRate: () => 0.4,
    harvestCapMin: () => 0.1,
    harvestCapMax: () => 0.5,
    riskTolerance: () => 0,
    allyThreshold: () => 1,
    enemyThreshold: () => 0,
    fightCost: () => 0,
    combatPower: () => 1,
    ...dnaOverrides,
  };

  return {
    row,
    col,
    energy,
    dna,
    lifespan: Infinity,
    age: 0,
    offspring: 0,
    fightsWon: 0,
    fightsLost: 0,
    color: '#fff',
    applyEventEffects: () => {},
    manageEnergy: () => false,
    similarityTo: () => 1,
    selectMateWeighted: () => ({ chosen: null, evaluated: [], mode: 'preference' }),
    findBestMate: (mates) => mates[0],
    computeReproductionProbability: () => 1,
    decideReproduction: () => ({ probability: 1 }),
    diversityAppetite: 0,
    matePreferenceBias: 0,
    ageEnergyMultiplier: () => 1,
    decideRandomMove: () => ({ dr: 0, dc: 0 }),
    executeMovementStrategy: () => {},
    chooseInteractionAction: () => 'fight',
    createFightIntent({ attackerRow, attackerCol, targetRow, targetCol }) {
      return {
        type: 'fight',
        initiator: { cell: this, row: attackerRow, col: attackerCol },
        target: { row: targetRow, col: targetCol },
      };
    },
    createCooperationIntent: () => null,
  };
}

test('PopulationSystem handleReproduction spawns offspring and records birth', () => {
  const gridState = new GridState(2, 2, { maxTileEnergy: 10 });
  let births = 0;
  const stats = { onBirth: () => births++ };
  const interactionSystem = new InteractionSystem({ gridState });
  const system = new PopulationSystem({ gridState, interactionSystem, stats, rng: () => 0 });

  const parent = createStubCell({ row: 0, col: 0, energy: 6 });
  const mate = createStubCell({ row: 0, col: 1, energy: 6 });

  gridState.setCell(0, 0, parent);
  gridState.setCell(0, 1, mate);
  gridState.syncDensitySnapshot(true);

  const originalRandom = Math.random;
  const originalBreed = Cell.breed;
  let offspring = null;

  Math.random = () => 0;
  Cell.breed = () => {
    offspring = createStubCell({ row: null, col: null, energy: 2 });

    return offspring;
  };

  const reproduced = system.handleReproduction(
    0,
    0,
    parent,
    { mates: [{ row: 0, col: 1, target: mate, similarity: 1, diversity: 0 }], society: [] },
    {
      stats,
      densityGrid: gridState.densityGrid,
      densityEffectMultiplier: 1,
      mutationMultiplier: 1,
    }
  );

  Cell.breed = originalBreed;
  Math.random = originalRandom;

  assert.ok(reproduced, 'reproduction succeeds');
  assert.is(births, 1, 'birth recorded');
  assert.ok(offspring, 'offspring returned from breeder');
  assert.ok(offspring.row !== null && offspring.col !== null, 'offspring assigned spawn location');
  assert.is(gridState.getCell(offspring.row, offspring.col), offspring, 'offspring placed in grid');
});

test('PopulationSystem handleCombat resolves interaction with stats update', () => {
  const gridState = new GridState(3, 3, { maxTileEnergy: 10 });
  const stats = {
    onFight: () => fights++,
    onDeath: () => deaths++,
  };
  let fights = 0;
  let deaths = 0;
  const interactionSystem = new InteractionSystem({ gridState });
  const system = new PopulationSystem({ gridState, interactionSystem, stats, rng: () => 0 });

  const attacker = createStubCell({ row: 1, col: 1, energy: 5 });
  const defender = createStubCell({ row: 1, col: 2, energy: 1 });

  gridState.setCell(1, 1, attacker);
  gridState.setCell(1, 2, defender);
  gridState.syncDensitySnapshot(true);

  const handled = system.handleCombat(
    1,
    1,
    attacker,
    { enemies: [{ row: 1, col: 2, target: defender }], society: [] },
    {
      stats,
      densityGrid: gridState.densityGrid,
      densityEffectMultiplier: 1,
    }
  );

  assert.ok(handled, 'combat handled');
  assert.is(fights, 1, 'fight recorded');
  assert.is(deaths, 1, 'death recorded');
  assert.is(gridState.getCell(1, 2), attacker, 'attacker occupies defender tile after combat');
  assert.is(gridState.getCell(1, 1), null, 'original attacker tile cleared');
});

test.run();
