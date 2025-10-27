import { assert, test } from "#tests/harness";

test("captureFromEntries falls back to cell neuron count when brain reports zero", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const telemetry = ["decision"];
  const snapshots = BrainDebugger.captureFromEntries(
    [
      {
        row: 1,
        col: 2,
        fitness: 42,
        cell: {
          color: "#abc",
          neurons: 7,
          brain: {
            neuronCount: 0,
            connectionCount: 3,
            snapshot() {
              return { foo: "bar" };
            },
          },
          getDecisionTelemetry() {
            return telemetry;
          },
        },
      },
    ],
    { limit: 1 },
  );

  assert.is(snapshots.length, 1);
  assert.is(snapshots[0].neuronCount, 7);
  assert.equal(snapshots[0].decisions, telemetry);

  BrainDebugger.update([]);
});

test("captureFromEntries falls back to DNA color when runtime color missing", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const snapshots = BrainDebugger.captureFromEntries(
    [
      {
        row: 2,
        col: 3,
        fitness: 24,
        cell: {
          dna: {
            toColor() {
              return "#c0ffee";
            },
          },
          brain: {
            neuronCount: 4,
            connectionCount: 2,
            snapshot() {
              return { connections: [1, 2] };
            },
          },
        },
      },
    ],
    { limit: 1 },
  );

  assert.is(snapshots.length, 1);
  assert.is(snapshots[0].color, "#c0ffee");

  BrainDebugger.update([]);
});

test("captureFromEntries falls back to DNA connection count when brain reports zero", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const genes = [{ enabled: true }, { enabled: false }, { enabled: true }];
  const snapshots = BrainDebugger.captureFromEntries(
    [
      {
        row: 3,
        col: 4,
        fitness: 99,
        cell: {
          color: "#def",
          dna: {
            neuralGenes() {
              return genes;
            },
          },
          brain: {
            neuronCount: 5,
            connectionCount: 0,
            snapshot() {
              return { connections: [] };
            },
          },
        },
      },
    ],
    { limit: 1 },
  );

  assert.is(snapshots.length, 1);
  assert.is(snapshots[0].connectionCount, 2);

  BrainDebugger.update([]);
});

test("captureFromEntries skips entries when brain snapshot throws", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    const entry = {
      row: 5,
      col: 6,
      fitness: 10,
      cell: {
        brain: {
          snapshot() {
            throw new Error("snapshot failure");
          },
        },
      },
    };

    const snapshots = BrainDebugger.captureFromEntries([entry], { limit: 1 });

    assert.is(snapshots.length, 0);

    BrainDebugger.captureFromEntries([entry], { limit: 1 });

    assert.is(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }

  BrainDebugger.update([]);
});

test("captureFromEntries defaults decision telemetry to empty array when getter throws", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const originalWarn = console.warn;

  console.warn = () => {};

  try {
    const snapshots = BrainDebugger.captureFromEntries(
      [
        {
          row: 1,
          col: 1,
          fitness: 5,
          cell: {
            color: "#123",
            brain: {
              neuronCount: 2,
              connectionCount: 2,
              snapshot() {
                return { connections: [1, 2] };
              },
            },
            getDecisionTelemetry() {
              throw new Error("telemetry failure");
            },
          },
        },
      ],
      { limit: 1 },
    );

    assert.is(snapshots.length, 1);
    assert.equal(snapshots[0].decisions, []);
  } finally {
    console.warn = originalWarn;
  }

  BrainDebugger.update([]);
});

test("captureFromEntries requests telemetry depth matching limit", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const history = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  let requestedLimit = null;

  const snapshots = BrainDebugger.captureFromEntries(
    [
      {
        row: 0,
        col: 0,
        fitness: 1,
        cell: {
          brain: {
            neuronCount: 2,
            connectionCount: 2,
            snapshot() {
              return { connections: [1, 2] };
            },
          },
          getDecisionTelemetry(limit) {
            requestedLimit = limit;

            return history.slice(-limit);
          },
        },
      },
    ],
    { limit: 4 },
  );

  assert.is(requestedLimit, 4);
  assert.equal(
    snapshots[0].decisions,
    history.slice(-4),
    "decisions should respect the requested telemetry depth",
  );

  BrainDebugger.update([]);
});

test("update clones snapshots using shared helper", async () => {
  const { default: BrainDebugger } = await import("../src/ui/brainDebugger.js");
  const source = [
    {
      row: 7,
      col: 8,
      fitness: 11,
      color: "#123456",
      neuronCount: 4,
      connectionCount: 2,
      brain: { connections: [1], metadata: { type: "foo" } },
      decisions: [{ id: "alpha" }],
    },
  ];

  const updated = BrainDebugger.update(source);

  assert.is.not(updated, source, "update should clone the array instance");
  assert.is.not(updated[0], source[0], "update should clone each snapshot");
  assert.is.not(updated[0].brain, source[0].brain, "brain payload should be cloned");
  assert.is.not(
    updated[0].brain.metadata,
    source[0].brain.metadata,
    "nested brain data should be cloned",
  );
  assert.is.not(
    updated[0].decisions,
    source[0].decisions,
    "decision history should be cloned",
  );

  source[0].brain.connections.push(2);
  source[0].brain.metadata.type = "mutated";
  source[0].decisions.push({ id: "beta" });

  assert.equal(
    updated[0].brain.connections,
    [1],
    "updates to original brain should not leak",
  );
  assert.equal(
    updated[0].brain.metadata,
    { type: "foo" },
    "nested metadata should remain isolated",
  );
  assert.equal(
    updated[0].decisions,
    [{ id: "alpha" }],
    "decision history should remain isolated",
  );

  const retrieved = BrainDebugger.get();

  assert.is.not(retrieved, updated, "get should return a cloned array");
  assert.is.not(retrieved[0], updated[0], "get should clone stored snapshots");
  assert.is.not(
    retrieved[0].brain,
    updated[0].brain,
    "brain payload from get should be cloned",
  );
  assert.is.not(
    retrieved[0].decisions,
    updated[0].decisions,
    "decision history from get should be cloned",
  );

  updated[0].brain.connections.push(3);
  updated[0].decisions[0].id = "gamma";

  assert.equal(
    retrieved[0].brain.connections,
    [1],
    "get should protect stored brain payload",
  );
  assert.equal(
    retrieved[0].decisions,
    [{ id: "alpha" }],
    "get should protect stored decisions",
  );

  BrainDebugger.update([]);
});
