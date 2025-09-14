const { test } = require('uvu');
const assert = require('uvu/assert');

class Cell {
  constructor(movementGenes) {
    this.movementGenes = movementGenes;
  }

  chooseMovementStrategy() {
    const { wandering, pursuit, cautious } = this.movementGenes;
    const total = wandering + pursuit + cautious;
    const r = Math.random() * total;
    if (r < wandering) return 'wandering';
    if (r < wandering + pursuit) return 'pursuit';
    return 'cautious';
  }
}

function withMockedRandom(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[i++];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('chooseMovementStrategy selects based on gene weights', () => {
  const wanderer = new Cell({ wandering: 1, pursuit: 0, cautious: 0 });
  const pursuer = new Cell({ wandering: 0, pursuit: 1, cautious: 0 });
  const cautious = new Cell({ wandering: 0, pursuit: 0, cautious: 1 });

  assert.is(
    withMockedRandom([0], () => wanderer.chooseMovementStrategy()),
    'wandering'
  );
  assert.is(
    withMockedRandom([0], () => pursuer.chooseMovementStrategy()),
    'pursuit'
  );
  assert.is(
    withMockedRandom([0], () => cautious.chooseMovementStrategy()),
    'cautious'
  );
});

test.run();
