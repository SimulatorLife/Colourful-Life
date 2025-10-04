import { assert, test } from "#tests/harness";

let GridManager;
let DECAY_RETURN_FRACTION;
let clamp;

const EVENT_STUB = { activeEvents: [] };

function runDecayTick(manager) {
  manager.prepareTick({
    eventManager: EVENT_STUB,
    eventStrengthMultiplier: 1,
    energyRegenRate: 0,
    energyDiffusionRate: 0,
    densityEffectMultiplier: 1,
  });
}

test.before(async () => {
  ({ default: GridManager } = await import("../src/grid/gridManager.js"));
  ({ DECAY_RETURN_FRACTION } = await import("../src/config.js"));
  ({ clamp } = await import("../src/utils.js"));
});

test("GridManager queues DNA-tuned decay reserves and release", () => {
  const manager = new GridManager(1, 1, { maxTileEnergy: 10 });

  manager.energyGrid[0][0] = 0;

  const profile = {
    immediateShare: 0.6,
    releaseBase: 0.3,
    releaseRate: 0.25,
    persistence: 1.5,
  };
  const cell = {
    energy: 4,
    dna: { decayRecyclingProfile: () => profile },
    row: 0,
    col: 0,
  };

  manager.registerDeath(cell, { row: 0, col: 0 });

  const returned = cell.energy * DECAY_RETURN_FRACTION;
  const immediateShare = clamp(profile.immediateShare, 0.05, 0.95);
  const releaseBase = clamp(profile.releaseBase, 0.01, 1);
  const releaseRate = clamp(profile.releaseRate, 0, 1);
  const expectedImmediate = returned * immediateShare;
  const expectedReserve = returned - expectedImmediate;

  assert.ok(Math.abs(manager.energyGrid[0][0] - expectedImmediate) < 1e-6);
  assert.ok(Math.abs(manager.decayAmount[0][0] - expectedReserve) < 1e-6);
  assert.ok(Math.abs(manager.decayReleaseBaseGrid[0][0] - releaseBase) < 1e-6);
  assert.ok(Math.abs(manager.decayReleaseRateGrid[0][0] - releaseRate) < 1e-6);
  assert.ok(Math.abs(manager.decayPersistenceGrid[0][0] - profile.persistence) < 1e-6);

  runDecayTick(manager);

  const expectedRelease = Math.min(
    expectedReserve,
    releaseBase + expectedReserve * releaseRate,
  );
  const expectedRemaining = expectedReserve - expectedRelease;

  assert.ok(
    Math.abs(manager.energyGrid[0][0] - (expectedImmediate + expectedRelease)) < 1e-6,
  );
  assert.ok(Math.abs(manager.decayAmount[0][0] - expectedRemaining) < 1e-6);
});

test("decay persistence controls when lingering reserves clear", () => {
  const defaultsProbe = new GridManager(1, 1, { maxTileEnergy: 10 });
  const defaultBase = defaultsProbe.decayReleaseBaseGrid[0][0];
  const defaultRate = defaultsProbe.decayReleaseRateGrid[0][0];
  const defaultPersistence = defaultsProbe.decayPersistenceGrid[0][0];

  const manager = new GridManager(1, 1, { maxTileEnergy: 10 });

  manager.energyGrid[0][0] = 0;

  const persistence = 0.1;
  const cell = {
    energy: 4,
    dna: {
      decayRecyclingProfile: () => ({
        immediateShare: 0,
        releaseBase: 0,
        releaseRate: 0,
        persistence,
      }),
    },
    row: 0,
    col: 0,
  };

  manager.registerDeath(cell, { row: 0, col: 0 });

  const returned = cell.energy * DECAY_RETURN_FRACTION;
  const immediateShare = clamp(0, 0.05, 0.95);
  const persistenceClamped = clamp(persistence, 0.25, 3);
  const expectedImmediate = returned * immediateShare;
  const expectedReserve = returned - expectedImmediate;

  assert.ok(Math.abs(manager.decayAmount[0][0] - expectedReserve) < 1e-6);
  assert.ok(Math.abs(manager.energyGrid[0][0] - expectedImmediate) < 1e-6);

  manager.decayReleaseBaseGrid[0][0] = 0;
  manager.decayReleaseRateGrid[0][0] = 0;

  const expectedAge = Math.max(1, Math.round(240 * persistenceClamped));

  for (let tick = 1; tick < expectedAge; tick++) {
    runDecayTick(manager);
    assert.ok(
      manager.decayAmount[0][0] > 0,
      `reserve should persist until reaching age ${expectedAge}`,
    );
  }

  runDecayTick(manager);

  assert.ok(
    manager.decayAmount[0][0] <= 1e-6,
    "reserve cleared after persistence-adjusted age",
  );
  assert.is(manager.decayReleaseBaseGrid[0][0], defaultBase);
  assert.is(manager.decayReleaseRateGrid[0][0], defaultRate);
  assert.is(manager.decayPersistenceGrid[0][0], defaultPersistence);
});
