import { assert, test } from "#tests/harness";

let DNA;

const readGenes = (dna, count) =>
  Array.from({ length: count }, (_, index) => dna.geneAt(index));

test.before(async () => {
  ({ default: DNA } = await import("../src/genome.js"));
});

test("DNA constructor accepts byte views beyond Uint8Array", () => {
  const genes = new Uint8ClampedArray([12, 34, 56, 78]);
  const dna = new DNA({ genes, geneCount: genes.length });

  assert.is(
    dna.length,
    genes.length,
    "constructor should adopt the provided gene count",
  );
  assert.equal(
    readGenes(dna, genes.length),
    Array.from(genes),
    "genes should mirror the provided sequence",
  );
});

test("DNA similarity supports collaborators exposing only geneAt", () => {
  const genes = Uint8Array.from([10, 20, 30, 40]);
  const dna = new DNA({ genes, geneCount: genes.length });
  const adapter = {
    length: genes.length,
    geneAt(index) {
      return index < genes.length ? genes[index] : 0;
    },
  };

  assert.is(
    dna.similarity(adapter),
    1,
    "identical collaborators should have perfect similarity",
  );
});

test("DNA similarity falls back to iterable genes when geneAt returns invalid data", () => {
  const genes = new Uint8Array([0, 0, 0, 0]);
  const dna = new DNA({ genes, geneCount: genes.length });
  const fallbackGenes = {
    0: 0,
    1: 50,
    2: 0,
    3: 0,
    length: genes.length,
    [Symbol.iterator]: function* iterator() {
      for (let index = 0; index < this.length; index += 1) {
        yield this[index];
      }
    },
  };
  const adapter = {
    length: genes.length,
    genes: fallbackGenes,
    geneAt(index) {
      return index === 1 ? Number.NaN : 0;
    },
  };

  const similarity = dna.similarity(adapter);
  const expected = 1 - 50 / Math.sqrt(genes.length * 255 * 255);

  assert.ok(
    Math.abs(similarity - expected) < 1e-12,
    "similarity should reuse fallback genes when direct samples are invalid",
  );
});
