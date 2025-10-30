import { assert, test } from "#tests/harness";
import Stats from "../src/stats/index.js";
import TelemetryController from "../src/engine/telemetryController.js";
import { createSimulationRuntimeServices } from "../src/engine/simulationRuntimeServices.js";

test("attachTo defines non-enumerable telemetry accessors that proxy controller state", () => {
  const services = createSimulationRuntimeServices();

  services.attachTo(null);
  services.attachTo(42);

  const host = { id: "ui" };

  services.attachTo(host);

  const { telemetry } = services;

  const propertyNames = [
    "pendingSlowUiUpdate",
    "lastSnapshot",
    "lastMetrics",
    "lastSlowUiRender",
    "lastRenderStats",
  ];

  propertyNames.forEach((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(host, key);

    assert.type(descriptor, "object", `${key} should define a property descriptor`);
    assert.is(descriptor.enumerable, false, `${key} should be non-enumerable`);
    assert.is(descriptor.configurable, true, `${key} should remain configurable`);
  });

  assert.not.ok(Object.keys(host).includes("pendingSlowUiUpdate"));
  assert.is(host.pendingSlowUiUpdate, false);

  telemetry.markPending();
  assert.is(host.pendingSlowUiUpdate, true);

  host.pendingSlowUiUpdate = false;
  assert.is(telemetry.hasPending(), false);

  assert.is(host.lastSlowUiRender, Number.NEGATIVE_INFINITY);

  host.lastSlowUiRender = 512;
  assert.is(telemetry.getLastEmissionTimestamp(), 512);

  telemetry.resetThrottle(256);
  assert.is(host.lastSlowUiRender, 256);

  telemetry.setInitialSnapshot({
    entries: [
      {
        id: "alpha",
        offspring: undefined,
        fightsWon: Number.POSITIVE_INFINITY,
        age: Number.NaN,
        color: null,
        cell: { offspring: 4, fightsWon: 5, age: 6, color: "#abc123" },
      },
    ],
    populationCells: [{}, {}],
  });

  const retainedSnapshot = host.lastSnapshot;

  assert.equal(retainedSnapshot.entries, [
    { id: "alpha", offspring: 4, fightsWon: 5, age: 6, color: "#abc123" },
  ]);
  assert.is(Object.hasOwn(retainedSnapshot.entries[0], "cell"), false);
  assert.is("populationCells" in retainedSnapshot, false);

  telemetry.ingestSnapshot({
    population: 0,
    entries: [],
    totalEnergy: 0,
    totalAge: 0,
  });

  telemetry.includeRenderStats({ fps: 60 });

  assert.is(host.lastMetrics, telemetry.metrics);
  assert.equal(host.lastMetrics.rendering, { fps: 60 });
  assert.equal(host.lastRenderStats, { fps: 60 });
});

test("createSimulationRuntimeServices respects overrides and publishes leaderboard data", () => {
  const computeCalls = [];
  const computeLeaderboard = (snapshot, size) => {
    computeCalls.push({ snapshot, size });

    return [{ id: "winner" }];
  };
  let nowCalls = 0;
  const now = () => 1000 + nowCalls++;

  const services = createSimulationRuntimeServices({
    rng: () => 0.125,
    computeLeaderboard,
    leaderboardSize: "8",
    now,
    statsOptions: {
      historySize: 12,
      traitResampleInterval: 5,
    },
  });

  const { stats, telemetry } = services;

  assert.instance(stats, Stats);
  assert.instance(telemetry, TelemetryController);
  assert.is(telemetry.stats, stats);
  assert.is(stats.historySize, 12);
  assert.is(stats.traitResampleInterval, 5);

  telemetry.setInitialSnapshot({ entries: [], population: 0 });

  let leaderboardPayload = null;

  telemetry.publishNow({
    emitMetrics: () => {},
    emitLeaderboard: ({ entries }) => {
      leaderboardPayload = entries;
    },
  });

  assert.is(nowCalls, 1);
  assert.is(telemetry.getLastEmissionTimestamp(), 1000);
  assert.is(computeCalls.length, 1);
  assert.is(computeCalls[0].snapshot, telemetry.snapshot);
  assert.is(computeCalls[0].size, 8);
  assert.equal(leaderboardPayload, [{ id: "winner" }]);
});
