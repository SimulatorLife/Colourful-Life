import { suite } from 'uvu';
import * as assert from 'uvu/assert';
import { forEachNeighbor } from '../src/gridNeighbors.js';

const test = suite('forEachNeighbor');

test('iterates only in-bounds neighbors', () => {
  const collected = [];

  forEachNeighbor(0, 0, 1, 3, 3, (row, col) => {
    collected.push([row, col]);
  });

  assert.equal(collected, [
    [0, 1],
    [1, 0],
    [1, 1],
  ]);
});

test('optionally includes the origin tile', () => {
  const collected = [];

  forEachNeighbor(1, 1, 1, 3, 3, (row, col) => {
    collected.push(`${row},${col}`);
  });

  assert.ok(!collected.includes('1,1'));

  collected.length = 0;

  forEachNeighbor(1, 1, 0, 3, 3, (row, col) => {
    collected.push(`${row},${col}`);
  });

  assert.equal(collected, []);

  forEachNeighbor(
    1,
    1,
    0,
    3,
    3,
    (row, col) => {
      collected.push(`${row},${col}`);
    },
    { includeOrigin: true }
  );

  assert.equal(collected, ['1,1']);
});

test('supports early exit from the callback', () => {
  const seen = [];

  const result = forEachNeighbor(1, 1, 2, 4, 4, (row, col) => {
    seen.push(row * 10 + col);
    if (seen.length === 2) return false;

    return true;
  });

  assert.is(result, false);
  assert.is(seen.length, 2);
});

test('ignores negative or fractional radius by flooring to zero', () => {
  const collected = [];

  forEachNeighbor(
    1,
    1,
    -2.7,
    3,
    3,
    (row, col) => {
      collected.push([row, col]);
    },
    { includeOrigin: true }
  );

  assert.equal(collected, [[1, 1]]);
});

test.run();
