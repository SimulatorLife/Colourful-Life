const { test } = require('uvu');
const assert = require('uvu/assert');

const collectNeighbors = async (rows, cols, row, col, radius, includeOrigin = false) => {
  const { forEachNeighbor } = await import('../src/gridNeighbors.js');
  const coords = [];

  forEachNeighbor(
    rows,
    cols,
    row,
    col,
    radius,
    (r, c) => {
      coords.push([r, c]);
    },
    includeOrigin
  );

  return coords;
};

test('collects all in-bounds neighbors in radius 1', async () => {
  const neighbors = await collectNeighbors(3, 3, 1, 1, 1);

  assert.equal(neighbors, [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ]);
});

test('trims neighbors that fall outside bounds', async () => {
  const neighbors = await collectNeighbors(4, 4, 0, 0, 2);

  assert.equal(neighbors, [
    [0, 1],
    [0, 2],
    [1, 0],
    [1, 1],
    [1, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ]);
});

test('optionally includes the origin when requested', async () => {
  const neighbors = await collectNeighbors(2, 2, 0, 1, 1, true);

  assert.equal(neighbors, [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
});

const callCounter = () => {
  let calls = 0;

  return {
    increment() {
      calls += 1;
    },
    get value() {
      return calls;
    },
  };
};

test('does not invoke callback when radius is negative', async () => {
  const { forEachNeighbor } = await import('../src/gridNeighbors.js');
  const counter = callCounter();

  forEachNeighbor(2, 2, 0, 0, -1, counter.increment.bind(counter));

  assert.is(counter.value, 0);
});

test.run();
