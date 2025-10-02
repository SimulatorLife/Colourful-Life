import { assert, test } from "#tests/harness";

const simulationModulePromise = import("../src/main.js");

test("updated survival tuning maintains a living population", async () => {
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

  for (let i = 0; i < 420; i++) {
    timestamp += delta;
    simulation.tick(timestamp);
  }

  const snapshot = grid.getLastSnapshot();

  assert.ok(
    snapshot.population > 12,
    `population should remain above the extinction floor (actual: ${snapshot.population})`,
  );
  assert.ok(
    stats.totals.births > 0,
    "organisms should successfully reproduce during the stability window",
  );

  const starvationSeries = stats.getHistorySeries("starvationRate");
  const recentStarvation =
    starvationSeries.length > 0 ? starvationSeries[starvationSeries.length - 1] : 0;

  assert.ok(
    recentStarvation < 0.7,
    `starvation rate should stay below collapse territory (actual: ${recentStarvation})`,
  );

  simulation.destroy();
});
