const { test } = require('uvu');
const assert = require('uvu/assert');

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {},
  ctx: {},
  cellSize: 1,
};

test('GridManager supports custom max tile energy for harvesting and regen', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGridManager extends GridManager {
    init() {}
  }

  const customMax = 12;
  const gm = new TestGridManager(1, 1, { ...baseOptions, maxTileEnergy: customMax });

  gm.energyGrid[0][0] = customMax;
  const harvester = {
    dna: {
      forageRate: () => 1,
      harvestCapMin: () => 0.1,
      harvestCapMax: () => 1,
    },
    energy: 5.5,
  };

  gm.consumeEnergy(harvester, 0, 0, [[0]]);
  assert.ok(
    harvester.energy > 5,
    'cell energy should exceed the default cap when custom max is larger'
  );
  assert.ok(harvester.energy <= customMax, 'cell energy should respect the configured max');

  gm.energyGrid[0][0] = customMax / 2;
  gm.regenerateEnergyGrid([], 1, customMax, 0, [[0]]);
  assert.ok(
    gm.energyGrid[0][0] > 5,
    'regeneration should allow tiles to climb above the default cap when permitted'
  );
  assert.is(gm.energyGrid[0][0], customMax, 'regeneration should still clamp to the custom max');
});

test('processCell forwards custom max tile energy to cell energy management', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class ContextGrid extends GridManager {
    init() {}
    findTargets() {
      return { mates: [], enemies: [], society: [] };
    }
  }

  const customMax = 11;
  const gm = new ContextGrid(1, 1, { ...baseOptions, maxTileEnergy: customMax });
  const managed = {
    row: 0,
    col: 0,
    age: 0,
    lifespan: 5,
    energy: customMax / 2,
    dna: {
      activityRate: () => 0,
      reproductionThresholdFrac: () => 0,
    },
    applyEventEffects(row, col, ev, eventStrengthMultiplier, maxTileEnergy) {
      assert.is(maxTileEnergy, customMax);
    },
    manageEnergy(row, col, context) {
      assert.is(context.maxTileEnergy, customMax);

      return false;
    },
  };

  gm.setCell(0, 0, managed);

  const stats = {
    onDeath() {},
    onBirth() {},
    recordMateChoice() {},
  };

  gm.processCell(0, 0, {
    stats,
    eventManager: { activeEvents: [] },
    densityGrid: [[0]],
    processed: new WeakSet(),
    densityEffectMultiplier: 1,
    societySimilarity: 1,
    enemySimilarity: 0,
    eventStrengthMultiplier: 1,
    mutationMultiplier: 1,
  });
});

test('GridManager passes custom max tile energy to combat and movement helpers', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class HooksGrid extends GridManager {
    init() {}
  }

  const customMax = 13;
  const gm = new HooksGrid(2, 2, { ...baseOptions, maxTileEnergy: customMax });
  const actionLog = [];
  const fighter = {
    chooseInteractionAction(context) {
      assert.is(context.maxTileEnergy, customMax);
      actionLog.push('choose');

      return 'avoid';
    },
  };

  gm.boundMoveAwayFromTarget = () => {
    actionLog.push('moveAway');

    return true;
  };

  gm.setCell(0, 0, fighter);
  gm.handleCombat(
    0,
    0,
    fighter,
    { enemies: [{ row: 0, col: 1 }], society: [] },
    {
      stats: {},
      densityEffectMultiplier: 1,
    }
  );
  assert.ok(actionLog.includes('choose'));

  let receivedContext = null;
  const mover = {
    executeMovementStrategy(grid, row, col, mates, enemies, society, context) {
      receivedContext = context;
    },
  };

  gm.setCell(0, 0, mover);
  gm.energyGrid = [
    [customMax, customMax],
    [customMax, customMax],
  ];
  gm.handleMovement(
    0,
    0,
    mover,
    { mates: [], enemies: [], society: [] },
    {
      densityGrid: [
        [0, 0],
        [0, 0],
      ],
      densityEffectMultiplier: 1,
    }
  );

  assert.ok(receivedContext, 'movement should call into the cell with a context');
  assert.is(receivedContext.maxTileEnergy, customMax);
  assert.is(receivedContext.getEnergyAt(0, 0), 1, 'energy accessor should normalize by the max');
});

test('density effect multiplier scales harvesting and regeneration penalties', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class DensityGrid extends GridManager {
    init() {}
  }

  const gm = new DensityGrid(1, 1, baseOptions);
  const harvester = {
    dna: {
      forageRate: () => 1,
      harvestCapMin: () => 0,
      harvestCapMax: () => 1,
    },
    energy: 0,
  };

  gm.energyGrid[0][0] = 1;
  gm.consumeEnergy(harvester, 0, 0, [[0.5]], 1);
  const gainNormal = harvester.energy;

  gm.energyGrid[0][0] = 1;
  harvester.energy = 0;
  gm.consumeEnergy(harvester, 0, 0, [[0.5]], 2);
  const gainHigh = harvester.energy;

  assert.ok(gainHigh < gainNormal, 'higher density scaling should reduce harvesting gains');

  gm.energyGrid[0][0] = 0;
  gm.regenerateEnergyGrid([], 1, 1, 0, [[0.5]], 1);
  const regenNormal = gm.energyGrid[0][0];

  gm.energyGrid[0][0] = 0;
  gm.regenerateEnergyGrid([], 1, 1, 0, [[0.5]], 2);
  const regenHigh = gm.energyGrid[0][0];

  assert.ok(regenHigh < regenNormal, 'higher density scaling should dampen regeneration');
});

test('handleReproduction threads custom max tile energy through cell decisions', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: Cell } = await import('../src/cell.js');

  class ReproGrid extends GridManager {
    init() {}
  }

  const customMax = 14;
  const gm = new ReproGrid(3, 3, { ...baseOptions, maxTileEnergy: customMax });

  gm.energyGrid = Array.from({ length: 3 }, () => Array(3).fill(customMax));

  const mate = {
    row: 1,
    col: 2,
    dna: {
      reproductionThresholdFrac: () => 0,
    },
    age: 0,
    lifespan: 10,
    energy: customMax,
  };

  let capturedDecisionContext = null;
  const parent = {
    row: 1,
    col: 1,
    dna: {
      reproductionThresholdFrac: () => 0,
    },
    age: 0,
    lifespan: 10,
    energy: customMax,
    diversityAppetite: 0,
    matePreferenceBias: 0,
    applyEventEffects() {},
    manageEnergy() {
      return false;
    },
    computeReproductionProbability() {
      return 1;
    },
    decideReproduction(partner, context) {
      capturedDecisionContext = context;

      return { probability: 1, usedNetwork: false };
    },
    selectMateWeighted() {
      return {
        chosen: { target: mate, row: mate.row, col: mate.col },
        evaluated: [],
        mode: 'weighted',
      };
    },
    findBestMate() {
      return null;
    },
    similarityTo() {
      return 1;
    },
    evaluateMateCandidate(candidate) {
      return candidate;
    },
  };

  gm.setCell(1, 1, parent);
  gm.setCell(1, 2, mate);
  gm.boundMoveToTarget = () => false;

  const stats = {
    onBirth() {},
    recordMateChoice() {},
  };

  const densityGrid = Array.from({ length: 3 }, () => Array(3).fill(0));
  const originalBreed = Cell.breed;
  const originalRandom = Math.random;
  let capturedBreedOptions = null;

  Cell.breed = (a, b, mutationMultiplier, options) => {
    capturedBreedOptions = options;

    return { energy: customMax / 2 };
  };
  Math.random = () => 0;

  try {
    const reproduced = gm.handleReproduction(
      1,
      1,
      parent,
      { mates: [{ target: mate, row: mate.row, col: mate.col }], society: [] },
      {
        stats,
        densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 1,
      }
    );

    assert.ok(reproduced, 'reproduction should succeed under deterministic conditions');
    assert.ok(capturedDecisionContext, 'decideReproduction should receive context');
    assert.is(capturedDecisionContext.maxTileEnergy, customMax);
    assert.ok(capturedBreedOptions, 'Cell.breed should be called with options');
    assert.is(capturedBreedOptions.maxTileEnergy, customMax);
  } finally {
    Cell.breed = originalBreed;
    Math.random = originalRandom;
  }
});

test.run();
