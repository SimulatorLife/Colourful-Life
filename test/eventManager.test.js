const { test } = require('uvu');
const assert = require('uvu/assert');

function makeSequenceRng(sequence) {
  let index = 0;

  const rng = () => {
    if (index >= sequence.length) {
      throw new Error('RNG sequence exhausted');
    }

    const value = sequence[index];

    index += 1;

    return value;
  };

  rng.getCalls = () => index;

  return rng;
}

function expectedEventFromSequence(sequence, rows, cols) {
  const eventTypes = ['flood', 'drought', 'heatwave', 'coldwave'];
  let idx = 0;

  const sample = (min, max) => min + sequence[idx++] * (max - min);
  const eventType = eventTypes[Math.floor(sample(0, eventTypes.length))];
  const duration = Math.floor(sample(300, 900));
  const strength = sample(0.25, 1);
  const x = Math.floor(sample(0, cols));
  const y = Math.floor(sample(0, rows));
  const width = Math.max(10, Math.floor(sample(6, cols / 3)));
  const height = Math.max(10, Math.floor(sample(6, rows / 3)));

  return {
    eventType,
    duration,
    strength,
    affectedArea: { x, y, width, height },
    remaining: duration,
  };
}

test('EventManager respects injected RNG for deterministic events', async () => {
  const { default: EventManager } = await import('../src/eventManager.js');
  const rows = 40;
  const cols = 60;
  const sequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const rng = makeSequenceRng(sequence.slice());
  const manager = new EventManager(rows, cols, rng);
  const expected = expectedEventFromSequence(sequence, rows, cols);

  assert.equal(manager.currentEvent, expected);
  assert.is(rng.getCalls(), sequence.length);
});

test.run();
