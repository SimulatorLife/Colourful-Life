const { test } = require('uvu');
const assert = require('uvu/assert');

async function loadModule() {
  return import('../src/rng.js');
}

test('resolveRngController returns existing controller instance', async () => {
  const { createRngController, resolveRngController } = await loadModule();
  const controller = createRngController(1234);
  const resolved = resolveRngController(controller);

  assert.is(resolved, controller, 'resolveRngController should reuse RNGController instances');
});

test('resolveRngController unwraps iterator-style generators', async () => {
  const { resolveRngController } = await loadModule();
  const iterator = {
    index: 0,
    values: [{ value: 0.1 }, { value: 0.9 }],
    next() {
      const result = this.values[this.index % this.values.length];

      this.index += 1;

      return result;
    },
    seed: () => 9876,
  };
  const rng = resolveRngController(iterator);

  assert.is(rng.seed, 9876, 'seed should be read from iterator seed() method');
  assert.equal([rng.next(), rng.next(), rng.next()], [0.1, 0.9, 0.1]);
});

test.run();
