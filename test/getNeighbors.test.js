const getNeighbors = require('../fallingSand/getNeighbors');
const { test } = require('uvu');
const assert = require('uvu/assert');

const sampleGrid = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
];

test('center cell with 8 neighbors', () => {
  const neighbors = getNeighbors(sampleGrid, 1, 1);
  assert.is(neighbors.length, 8);
  assert.equal(neighbors, [0, 1, 2, 3, 5, 6, 7, 8]);
});

test('corner cell with 3 neighbors', () => {
  const neighbors = getNeighbors(sampleGrid, 0, 0);
  assert.is(neighbors.length, 3);
  assert.equal(neighbors, [1, 3, 4]);
});

test('edge cell with 5 neighbors', () => {
  const neighbors = getNeighbors(sampleGrid, 1, 0);
  assert.is(neighbors.length, 5);
  assert.equal(neighbors, [0, 2, 3, 4, 5]);
});

test.run();
