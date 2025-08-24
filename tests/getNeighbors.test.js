const getNeighbors = require('../fallingSand/getNeighbors');

const sampleGrid = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8]
];

describe('getNeighbors', () => {
  test('center cell with 8 neighbors', () => {
    const neighbors = getNeighbors(sampleGrid, 1, 1);
    expect(neighbors).toHaveLength(8);
    expect(neighbors).toEqual([0, 1, 2, 3, 5, 6, 7, 8]);
  });

  test('corner cell with 3 neighbors', () => {
    const neighbors = getNeighbors(sampleGrid, 0, 0);
    expect(neighbors).toHaveLength(3);
    expect(neighbors).toEqual([1, 3, 4]);
  });

  test('edge cell with 5 neighbors', () => {
    const neighbors = getNeighbors(sampleGrid, 1, 0);
    expect(neighbors).toHaveLength(5);
    expect(neighbors).toEqual([0, 2, 3, 4, 5]);
  });
});
