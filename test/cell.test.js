const { test } = require('uvu');
const assert = require('uvu/assert');

class Cell {
  constructor(genes = Cell.randomGenes(), energy = 1) {
    this.genes = genes;
    this.energy = energy;
  }

  static randomGenes() {
    return Array.from({ length: 5 }, () => Math.random());
  }

  cloneWithMutation(mutationRate = 0.1) {
    const newGenes = this.genes.map(g => {
      const mutation = (Math.random() * 2 - 1) * mutationRate;
      const mutated = g + mutation;
      return Math.min(1, Math.max(0, mutated));
    });
    return new Cell(newGenes);
  }
  manageEnergy(isHighDensity) {
    this.energy -= isHighDensity ? 0.8 : 0.055;
    return this.energy <= this.starvationThreshold();
  }

  starvationThreshold() {
    return this.genes[0];
  }
}

function randomEmptyCell(grid) {
  const empties = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!grid[r][c]) empties.push({ row: r, col: c });
    }
  }
  if (empties.length === 0) return null;
  return empties[Math.floor(Math.random() * empties.length)];
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

test('Cell.randomGenes returns predetermined genes', () => {
  const expected = [0.1, 0.2, 0.3, 0.4, 0.5];
  const genes = withMockedRandom(expected, () => Cell.randomGenes());
  assert.equal(genes, expected);
});

test('Cell.cloneWithMutation creates a new cell with mutated genes', () => {
  const baseGenes = [0.5, 0.5, 0.5, 0.5, 0.5];
  const cell = new Cell(baseGenes);
  const clone = withMockedRandom([1, 1, 1, 1, 1], () => cell.cloneWithMutation(0.2));
  assert.ok(clone !== cell);
  assert.equal(clone.genes, Array(5).fill(0.7));
  assert.equal(cell.genes, baseGenes);
});

test('randomEmptyCell finds an empty spot or null when full', () => {
  const grid = [
    [1, null],
    [2, 3],
  ];
  const empty = withMockedRandom([0], () => randomEmptyCell(grid));
  assert.equal(empty, { row: 0, col: 1 });

  const filled = [
    [1, 2],
    [3, 4],
  ];
  assert.is(withMockedRandom([0], () => randomEmptyCell(filled)), null);
});

test('manageEnergy uses gene-derived starvation threshold', () => {
  const cell = new Cell([0.2, 0, 0, 0, 0], 0.25);
  assert.is(cell.manageEnergy(false), true);
  const cell2 = new Cell([0, 0, 0, 0, 0], 0.25);
  assert.is(cell2.manageEnergy(false), false);
});
test.run();
