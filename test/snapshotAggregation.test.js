const { test } = require('uvu');
const assert = require('uvu/assert');

const gridManagerModulePromise = import('../src/gridManager.js');
const leaderboardModulePromise = import('../src/leaderboard.js');

function createStubCell(data) {
  return {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    lifespan: 10,
    color: '#000',
    ...data,
  };
}

test('buildSnapshot aggregates living cells for downstream consumers', async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const { computeLeaderboard } = await leaderboardModulePromise;
  const originalInit = GridManager.prototype.init;

  try {
    GridManager.prototype.init = function initStub() {};
    const gm = new GridManager(2, 2, {
      eventManager: { activeEvents: [] },
      ctx: { fillStyle: null, fillRect() {} },
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
    });

    gm.grid = [
      [createStubCell({ energy: 4, age: 2, fightsWon: 1, offspring: 1, color: '#111' }), null],
      [null, createStubCell({ energy: 2, age: 5, fightsLost: 1, color: '#222' })],
    ];

    const snapshot = gm.buildSnapshot(10);

    assert.is(snapshot.population, 2);
    assert.is(snapshot.totalEnergy, 6);
    assert.is(snapshot.totalAge, 7);
    assert.is(snapshot.cells.length, 2);
    assert.is(snapshot.entries.length, 2);
    assert.ok(snapshot.maxFitness > 0);
    assert.equal(snapshot.entries.map(({ row, col }) => `${row},${col}`).sort(), ['0,0', '1,1']);

    const leaderboard = computeLeaderboard(snapshot, 2);

    assert.is(leaderboard.length, 2);
    assert.ok(leaderboard[0].fitness >= leaderboard[1].fitness);
  } finally {
    GridManager.prototype.init = originalInit;
  }
});

test('computeLeaderboard sanitizes topN before slicing', async () => {
  const { computeLeaderboard } = await leaderboardModulePromise;
  const snapshot = {
    entries: [
      {
        fitness: 10,
        smoothedFitness: 10,
        cell: { offspring: 0, fightsWon: 0, age: 0, color: '#000', fitnessScore: 10 },
      },
      {
        fitness: 8,
        smoothedFitness: 8,
        cell: { offspring: 0, fightsWon: 0, age: 0, color: '#111', fitnessScore: 8 },
      },
      {
        fitness: 6,
        smoothedFitness: 6,
        cell: { offspring: 0, fightsWon: 0, age: 0, color: '#222', fitnessScore: 6 },
      },
    ],
  };

  assert.is(computeLeaderboard(snapshot, 0).length, 0);
  assert.is(computeLeaderboard(snapshot, -5).length, 0);
  assert.is(computeLeaderboard(snapshot, 1.8).length, 1);
  assert.is(computeLeaderboard(snapshot, '2').length, 2);
});

test('computeLeaderboard tolerates entries missing cell data', async () => {
  const { computeLeaderboard } = await leaderboardModulePromise;

  const snapshot = {
    entries: [{ fitness: 10 }, { cell: {}, fitness: 5 }],
  };

  const leaderboard = computeLeaderboard(snapshot, 5);

  assert.is(leaderboard.length, 1);
  assert.equal(leaderboard[0], {
    fitness: 5,
    smoothedFitness: 5,
    offspring: 0,
    fightsWon: 0,
    age: 0,
    color: undefined,
  });
});
test.run();
