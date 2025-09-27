const { test } = require('uvu');
const assert = require('uvu/assert');

test('captureFromEntries falls back to cell neuron count when brain reports zero', async () => {
  const { default: BrainDebugger } = await import('../src/brainDebugger.js');
  const telemetry = ['decision'];
  const snapshots = BrainDebugger.captureFromEntries(
    [
      {
        row: 1,
        col: 2,
        fitness: 42,
        cell: {
          color: '#abc',
          neurons: 7,
          brain: {
            neuronCount: 0,
            connectionCount: 3,
            snapshot() {
              return { foo: 'bar' };
            },
          },
          getDecisionTelemetry() {
            return telemetry;
          },
        },
      },
    ],
    { limit: 1 }
  );

  assert.is(snapshots.length, 1);
  assert.is(snapshots[0].neuronCount, 7);
  assert.equal(snapshots[0].decisions, telemetry);

  BrainDebugger.update([]);
});

test.run();
