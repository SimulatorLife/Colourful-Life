import { test } from "uvu";
import * as assert from "uvu/assert";

const gridManagerModulePromise = import("../src/gridManager.js");
const leaderboardModulePromise = import("../src/leaderboard.js");

function createStubCell(data) {
  return {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    lifespan: 10,
    color: "#000",
    ...data,
  };
}

test("buildSnapshot aggregates living cells for downstream consumers", async () => {
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
      [
        createStubCell({
          energy: 4,
          age: 2,
          fightsWon: 1,
          offspring: 1,
          color: "#111",
        }),
        null,
      ],
      [null, createStubCell({ energy: 2, age: 5, fightsLost: 1, color: "#222" })],
    ];
    gm.rebuildActiveCells();

    const snapshot = gm.buildSnapshot(10);

    assert.is(snapshot.population, 2);
    assert.is(snapshot.totalEnergy, 6);
    assert.is(snapshot.totalAge, 7);
    assert.is(snapshot.cells.length, 2);
    assert.is(snapshot.entries.length, 2);
    assert.ok(snapshot.maxFitness > 0);
    assert.equal(snapshot.entries.map(({ row, col }) => `${row},${col}`).sort(), [
      "0,0",
      "1,1",
    ]);

    const leaderboard = computeLeaderboard(snapshot, 2);

    assert.is(leaderboard.length, 2);
    assert.ok(leaderboard[0].fitness >= leaderboard[1].fitness);
  } finally {
    GridManager.prototype.init = originalInit;
  }
});

test("buildSnapshot feeds sorted top entries to the brain snapshot collector", async () => {
  const { default: GridManager } = await gridManagerModulePromise;
  const originalInit = GridManager.prototype.init;

  try {
    let capturedEntries = null;
    let captureOptions = null;

    const collector = (entries, options) => {
      capturedEntries = Array.isArray(entries)
        ? entries.map((entry) => ({ ...entry }))
        : entries;
      captureOptions = options;

      return [];
    };

    GridManager.prototype.init = function initStub() {};
    const gm = new GridManager(3, 2, {
      eventManager: { activeEvents: [] },
      ctx: { fillStyle: null, fillRect() {} },
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
      brainSnapshotCollector: collector,
    });

    const energies = [10, 60, 20, 40, 50, 30];
    let index = 0;

    for (let row = 0; row < gm.rows; row += 1) {
      for (let col = 0; col < gm.cols; col += 1) {
        const energy = energies[index] ?? 0;

        gm.grid[row][col] = createStubCell({
          energy,
          age: 0,
          lifespan: 0,
          fightsWon: 0,
          fightsLost: 0,
          offspring: 0,
          brain: {
            snapshot() {
              return {};
            },
            neuronCount: 1,
            connectionCount: 1,
          },
        });
        index += 1;
      }
    }

    gm.rebuildActiveCells();

    const snapshot = gm.buildSnapshot(100);

    assert.ok(Array.isArray(capturedEntries));
    assert.is(captureOptions?.limit, 5);
    assert.is(capturedEntries.length, 5);
    assert.ok(snapshot.entries.length > capturedEntries.length);
    const fitnesses = capturedEntries.map((entry) => entry.fitness);
    const sorted = [...fitnesses].sort((a, b) => b - a);

    assert.equal(fitnesses, sorted);
    assert.ok(fitnesses[0] >= fitnesses[fitnesses.length - 1]);
  } finally {
    GridManager.prototype.init = originalInit;
  }
});

test("computeLeaderboard returns top entries in descending fitness order", async () => {
  const { computeLeaderboard } = await leaderboardModulePromise;

  const snapshot = {
    entries: [
      {
        fitness: 10,
        smoothedFitness: 12,
        cell: createStubCell({
          fitnessScore: 9,
          offspring: 5,
          fightsWon: 3,
          age: 7,
          color: "#aa0",
        }),
      },
      {
        fitness: 8,
        smoothedFitness: 11,
        cell: createStubCell({
          fitnessScore: 8,
          offspring: 4,
          fightsWon: 1,
          age: 6,
          color: "#bb1",
        }),
      },
      {
        fitness: 15,
        smoothedFitness: 11,
        cell: createStubCell({
          fitnessScore: 8,
          offspring: 2,
          fightsWon: 4,
          age: 4,
          color: "#cc2",
        }),
      },
      {
        fitness: 9,
        cell: createStubCell({
          fitnessScore: 13,
          offspring: 6,
          fightsWon: 5,
          age: 8,
          color: "#dd3",
        }),
      },
      {
        fitness: 7,
        cell: createStubCell({
          offspring: 1,
          fightsWon: 0,
          age: 5,
          color: "#ee4",
        }),
      },
      {
        fitness: 5,
        cell: createStubCell({
          offspring: 0,
          fightsWon: 0,
          age: 3,
          color: "#ff5",
        }),
      },
    ],
  };

  const leaderboard = computeLeaderboard(snapshot, 3);

  assert.is(leaderboard.length, 3);
  assert.equal(
    leaderboard.map(({ color }) => color),
    ["#dd3", "#aa0", "#cc2"],
  );
  assert.equal(leaderboard[0], {
    fitness: 9,
    smoothedFitness: 13,
    offspring: 6,
    fightsWon: 5,
    age: 8,
    color: "#dd3",
  });
  assert.equal(leaderboard[1], {
    fitness: 10,
    smoothedFitness: 12,
    offspring: 5,
    fightsWon: 3,
    age: 7,
    color: "#aa0",
  });
  assert.equal(leaderboard[2], {
    fitness: 15,
    smoothedFitness: 11,
    offspring: 2,
    fightsWon: 4,
    age: 4,
    color: "#cc2",
  });
});

test("computeLeaderboard sanitizes topN before slicing", async () => {
  const { computeLeaderboard } = await leaderboardModulePromise;
  const snapshot = {
    entries: [
      {
        fitness: 10,
        smoothedFitness: 10,
        cell: createStubCell({ fitnessScore: 10, color: "#000" }),
      },
      {
        fitness: 8,
        smoothedFitness: 8,
        cell: createStubCell({ fitnessScore: 8, color: "#111" }),
      },
      {
        fitness: 6,
        smoothedFitness: 6,
        cell: createStubCell({ fitnessScore: 6, color: "#222" }),
      },
    ],
  };

  assert.is(computeLeaderboard(snapshot, 0).length, 0);
  assert.is(computeLeaderboard(snapshot, -5).length, 0);
  assert.is(computeLeaderboard(snapshot, 1.8).length, 1);
  assert.is(computeLeaderboard(snapshot, "2").length, 2);
});

test("computeLeaderboard tolerates entries missing cell data", async () => {
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

test("computeLeaderboard skips entries with non-finite fitness", async () => {
  const { computeLeaderboard } = await leaderboardModulePromise;

  const snapshot = {
    entries: [
      { cell: { offspring: 2, fightsWon: 3, age: 4 }, fitness: Number.NaN },
      {
        cell: { offspring: 1, fightsWon: 1, age: 1 },
        fitness: Number.POSITIVE_INFINITY,
      },
      { cell: { offspring: 0, fightsWon: 0, age: 2 }, fitness: 7, smoothedFitness: 6 },
    ],
  };

  const leaderboard = computeLeaderboard(snapshot, 5);

  assert.is(leaderboard.length, 1);
  assert.equal(leaderboard[0], {
    fitness: 7,
    smoothedFitness: 6,
    offspring: 0,
    fightsWon: 0,
    age: 2,
    color: undefined,
  });
});

test.run();
