import { assert, test } from "#tests/harness";

const simulationModulePromise = import("../src/main.js");

test("simulation relies on lineage reproduction after initial seeding", async () => {
  const { createSimulation } = await simulationModulePromise;
  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    config: { rows: 24, cols: 24 },
  });

  simulation.stop();

  const { engine, grid, stats } = simulation;
  const updatesPerSecond = Math.max(
    1,
    engine.getStateSnapshot().updatesPerSecond ?? 60,
  );
  const delta = 1000 / updatesPerSecond;
  let timestamp = 0;

  assert.ok(
    engine.isPaused(),
    "auto-start controllers configured with autoStart=false should begin paused",
  );

  timestamp += delta;
  assert.ok(
    simulation.tick(timestamp),
    "manual ticks should advance even while the engine is paused but idle",
  );

  for (let i = 1; i < 420; i++) {
    timestamp += delta;
    simulation.tick(timestamp);
  }

  const snapshot = grid.getLastSnapshot();

  assert.ok(
    stats.totals.births > 0,
    "organisms should successfully reproduce during the stability window",
  );

  grid.resetWorld();
  const birthsBeforeCollapse = stats.totals.births;

  for (let i = 0; i < 180; i++) {
    timestamp += delta;
    simulation.tick(timestamp);
  }

  const postCollapseSnapshot = grid.getLastSnapshot();

  assert.is(
    postCollapseSnapshot.population,
    0,
    "empty worlds stay empty without reseeding",
  );
  assert.is(
    stats.totals.births,
    birthsBeforeCollapse,
    "no new births should occur without living parents",
  );

  simulation.destroy();
});
