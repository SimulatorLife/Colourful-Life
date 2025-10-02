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
