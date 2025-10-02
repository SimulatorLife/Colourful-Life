import { assert, test } from "#tests/harness";

test("reproduceWith uses runtime entropy for crossover RNG", async () => {
  const { default: DNA } = await import("../src/genome.js");

  const baseGenes = Uint8Array.from({ length: 10 }, (_, idx) => (idx * 25) % 256);
  const parentA = new DNA({ genes: baseGenes, geneCount: baseGenes.length });
  const parentB = new DNA({ genes: baseGenes, geneCount: baseGenes.length });

  const originalRandom = Math.random;
  let nonce = 0;

  Math.random = () => {
    nonce = (nonce + 1) >>> 0;

    return nonce / 0xffffffff;
  };

  try {
    const offspring = Array.from({ length: 5 }, () => parentA.reproduceWith(parentB));
    const uniqueGeneSignatures = new Set(
      offspring.map((dna) => Array.from(dna.genes).join(",")),
    );

    assert.ok(
      uniqueGeneSignatures.size > 1,
      "Expected runtime entropy to yield divergent offspring gene mixes",
    );
  } finally {
    Math.random = originalRandom;
  }
});
