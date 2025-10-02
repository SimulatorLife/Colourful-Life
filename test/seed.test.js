import { assert, test } from "#tests/harness";

function createRNG(seed) {
  seed = seed >>> 0;

  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;

    return seed / 4294967296;
  };
}

class Cell {
  static randomGenes(rng = Math.random) {
    const genes = [];

    for (let a = 0; a < 6; a++) {
      const weights = [];

      for (let i = 0; i < 5; i++) {
        weights.push(rng() * 2 - 1);
      }
      genes.push(weights);
    }

    return genes;
  }
}

const cellColors = ["#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FF00FF", "#00FFFF"];

function seedCell(seedValue) {
  const rng = createRNG(seedValue);

  rng();
  const genes = Cell.randomGenes(rng);
  const preferences = cellColors.map(() => rng());
  const neurons = Math.floor(rng() * 5) + 1;
  const sight = Math.floor(rng() * 5) + 1;
  const color = cellColors[Math.floor(rng() * cellColors.length)];

  return { genes, preferences, neurons, sight, color };
}

test("cells from identical seeds are identical", () => {
  const a = seedCell(12345);
  const b = seedCell(12345);

  assert.equal(a, b);
});

test("cells from different seeds differ", () => {
  const a = seedCell(12345);
  const b = seedCell(54321);

  assert.not.equal(a, b);
});
