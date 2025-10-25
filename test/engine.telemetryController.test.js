import { assert, test } from "#tests/harness";
import TelemetryController from "../src/engine/telemetryController.js";

function createNowSequence(values) {
  const queue = [...values];

  return () => {
    if (queue.length === 0) {
      throw new Error("Now sequence exhausted");
    }

    return queue.shift();
  };
}

test("TelemetryController publishes pending metrics with throttle enforcement", () => {
  const leaderboardArgs = [];
  const now = createNowSequence([100, 120, 180]);
  const controller = new TelemetryController({
    stats: {
      updateFromSnapshot(snapshot) {
        return { tick: snapshot.tick };
      },
    },
    computeLeaderboard(snapshot, size) {
      leaderboardArgs.push({ snapshot, size });

      return snapshot.entries.slice(0, size);
    },
    leaderboardSize: "3.7",
    now,
  });

  const firstSnapshot = { tick: 1, entries: [{ id: "a" }, { id: "b" }, { id: "c" }] };
  const firstMetrics = controller.ingestSnapshot(firstSnapshot);

  assert.equal(firstMetrics, { tick: 1 });
  assert.ok(controller.hasPending());

  controller.includeRenderStats({ fps: 60 });

  const metricsCalls = [];
  const leaderboardCalls = [];
  const environment = { biome: "forest" };

  const firstPublish = controller.publishIfDue({
    interval: 50,
    getEnvironment: () => environment,
    emitMetrics: (payload) => metricsCalls.push(payload),
    emitLeaderboard: (payload) => leaderboardCalls.push(payload),
  });

  assert.is(firstPublish, true);
  assert.not.ok(controller.hasPending());
  assert.equal(metricsCalls, [
    {
      stats: controller.stats,
      metrics: { tick: 1, rendering: { fps: 60 } },
      environment,
    },
  ]);
  assert.equal(leaderboardCalls, [
    {
      entries: [
        { id: "a", offspring: 0, fightsWon: 0, age: 0, color: null },
        { id: "b", offspring: 0, fightsWon: 0, age: 0, color: null },
        { id: "c", offspring: 0, fightsWon: 0, age: 0, color: null },
      ],
    },
  ]);
  assert.equal(
    leaderboardArgs.map(({ size }) => size),
    [3],
  );
  assert.is(controller.getLastEmissionTimestamp(), 100);

  const secondSnapshot = {
    tick: 2,
    entries: [{ id: "d" }, { id: "e" }, { id: "f" }, { id: "g" }],
  };

  controller.ingestSnapshot(secondSnapshot);
  controller.includeRenderStats({ fps: 55 });

  const throttledPublish = controller.publishIfDue({
    interval: 50,
    getEnvironment: () => environment,
    emitMetrics: (payload) => metricsCalls.push(payload),
    emitLeaderboard: (payload) => leaderboardCalls.push(payload),
  });

  assert.is(throttledPublish, false);
  assert.ok(controller.hasPending());
  assert.is(metricsCalls.length, 1);

  const secondPublish = controller.publishIfDue({
    interval: 50,
    getEnvironment: () => environment,
    emitMetrics: (payload) => metricsCalls.push(payload),
    emitLeaderboard: (payload) => leaderboardCalls.push(payload),
  });

  assert.is(secondPublish, true);
  assert.not.ok(controller.hasPending());
  assert.equal(metricsCalls[1], {
    stats: controller.stats,
    metrics: { tick: 2, rendering: { fps: 55 } },
    environment,
  });
  assert.equal(leaderboardCalls[1], {
    entries: [
      { id: "d", offspring: 0, fightsWon: 0, age: 0, color: null },
      { id: "e", offspring: 0, fightsWon: 0, age: 0, color: null },
      { id: "f", offspring: 0, fightsWon: 0, age: 0, color: null },
    ],
  });
  assert.equal(
    leaderboardArgs.map(({ size }) => size),
    [3, 3],
  );
  assert.is(controller.getLastEmissionTimestamp(), 180);
});

test("TelemetryController publishNow emits leaderboard with sanitized size", () => {
  const capturedSizes = [];
  const controller = new TelemetryController({
    computeLeaderboard(snapshot, size) {
      capturedSizes.push(size);

      return snapshot.entries.slice(0, size);
    },
    leaderboardSize: -4,
    now: () => Number.NaN,
  });

  const snapshot = { entries: [{ id: "alpha" }, { id: "beta" }] };

  controller.setInitialSnapshot(snapshot);

  const leaderboardCalls = [];

  controller.publishNow({
    timestamp: 500,
    getEnvironment: { season: "dry" },
    emitMetrics: () => {
      assert.unreachable("emitMetrics should not be called without metrics");
    },
    emitLeaderboard: (payload) => leaderboardCalls.push(payload),
  });

  assert.equal(capturedSizes, [0]);
  assert.equal(leaderboardCalls, [{ entries: [] }]);
  assert.is(controller.getLastEmissionTimestamp(), 500);
  assert.is(controller.metrics, null);
});
