import { assert, test } from "#tests/harness";
import TelemetryController from "../src/engine/telemetryController.js";
import { LEADERBOARD_SIZE_DEFAULT } from "../src/config.js";

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

test("TelemetryController setLeaderboardSize clamps values", () => {
  const controller = new TelemetryController({ leaderboardSize: 2 });

  assert.is(controller.setLeaderboardSize(7.8), 7);
  assert.is(controller.setLeaderboardSize(-4), 0);
  assert.is(controller.setLeaderboardSize("oops"), 0);
});

test("TelemetryController preserves leaderboard size for nullish and blank inputs", () => {
  const controller = new TelemetryController({ leaderboardSize: 4 });

  assert.is(controller.setLeaderboardSize(""), 4);
  assert.is(controller.setLeaderboardSize(null), 4);
  assert.is(controller.setLeaderboardSize(false), 4);
});

test("TelemetryController falls back to default leaderboard size when unset", () => {
  const sizes = [];
  const controller = new TelemetryController({
    leaderboardSize: null,
    computeLeaderboard(snapshot, size) {
      sizes.push(size);

      return snapshot.entries.slice(0, size);
    },
  });

  controller.setInitialSnapshot({ entries: [{ id: "alpha" }] });

  controller.publishNow({
    emitLeaderboard: () => {},
  });

  assert.equal(sizes, [LEADERBOARD_SIZE_DEFAULT]);
});

test("TelemetryController sanitizes retained snapshots for leaderboard consumers", () => {
  const controller = new TelemetryController();
  const snapshot = {
    entries: [
      {
        id: "alpha",
        offspring: Number.NaN,
        fightsWon: Number.POSITIVE_INFINITY,
        age: Number.NaN,
        color: undefined,
        cell: { offspring: 4, fightsWon: 2, age: 12, color: "#aabbcc" },
      },
      {
        id: "beta",
        offspring: 3,
        fightsWon: 1,
        age: 6,
        color: null,
        cell: { color: "#ddeeff" },
      },
      null,
    ],
    brainSnapshots: [
      { id: "alpha-brain", color: null, cell: { color: "#ff00ff" } },
      { id: "beta-brain" },
    ],
    populationCells: [{ id: 1 }],
  };

  controller.setInitialSnapshot(snapshot);

  const retained = controller.snapshot;

  assert.equal(retained.entries[0], {
    id: "alpha",
    offspring: 4,
    fightsWon: 2,
    age: 12,
    color: "#aabbcc",
  });
  assert.equal(retained.entries[1], {
    id: "beta",
    offspring: 3,
    fightsWon: 1,
    age: 6,
    color: "#ddeeff",
  });
  assert.is(retained.entries[2], null);
  assert.equal(retained.brainSnapshots, [
    { id: "alpha-brain", color: "#aabbcc" },
    { id: "beta-brain", color: "#ddeeff" },
  ]);
  assert.not.ok("populationCells" in retained);
  assert.not.ok("cell" in retained.entries[0]);
  assert.not.ok("cell" in retained.entries[1]);
});

test("TelemetryController guards environment resolution and emitters with error boundaries", () => {
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const controller = new TelemetryController({
      stats: {
        updateFromSnapshot(snapshot) {
          return { tick: snapshot.tick };
        },
      },
      computeLeaderboard() {
        throw new Error("leaderboard failure");
      },
      now: () => 100,
    });

    controller.ingestSnapshot({ tick: 7, entries: [{ id: "alpha" }] });

    const published = controller.publishIfDue({
      getEnvironment: () => {
        throw new Error("environment failure");
      },
      emitMetrics: () => {
        throw new Error("metrics failure");
      },
      emitLeaderboard: () => {
        throw new Error("leaderboard emit failure");
      },
    });

    assert.is(published, true);
    assert.not.ok(controller.hasPending());
    assert.equal(controller.metrics, { tick: 7 });
    assert.equal(controller.snapshot.entries, [
      { id: "alpha", offspring: 0, fightsWon: 0, age: 0, color: null },
    ]);
    assert.is(warnings.length, 4);
    assert.equal(
      warnings.map(([message]) => message),
      [
        "Telemetry environment resolver failed; continuing without environment context.",
        "Telemetry metrics emitter failed; skipping metrics publication.",
        "Telemetry leaderboard computation failed; emitting empty leaderboard.",
        "Telemetry leaderboard emitter failed; skipping leaderboard publication.",
      ],
    );
  } finally {
    console.warn = originalWarn;
  }
});
