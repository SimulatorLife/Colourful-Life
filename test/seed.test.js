import { assert, test } from "#tests/harness";
import DNA from "../src/genome.js";
import { createRNG } from "../src/utils.js";

function sampleGenome(seedValue, { sampleTag = "phenotype", sampleCount = 5 } = {}) {
  const rng = createRNG(seedValue);
  const dna = DNA.random(rng);
  const traitRng = dna.prngFor(sampleTag);
  const traitSamples = Array.from({ length: sampleCount }, () => traitRng());

  return {
    genes: Array.from(dna.genes),
    color: dna.toColor(),
    seed: dna.seed(),
    traitSamples,
  };
}

test("DNA.random seeded with createRNG reproduces genomes and derived randomness", () => {
  const first = sampleGenome(12345);
  const second = sampleGenome(12345);
  const different = sampleGenome(54321);

  assert.equal(
    first.genes,
    second.genes,
    "identical seeds should produce identical gene sequences",
  );
  assert.is(
    first.color,
    second.color,
    "phenotype color should be reproducible for identical genomes",
  );
  assert.is(
    first.seed,
    second.seed,
    "derived DNA seed should be deterministic across matching genomes",
  );
  assert.equal(
    first.traitSamples,
    second.traitSamples,
    "trait-specific RNG streams should align when derived from identical genomes",
  );

  assert.not.equal(
    first.genes,
    different.genes,
    "different seeds should result in different gene sequences",
  );
  assert.not.equal(
    first.traitSamples,
    different.traitSamples,
    "trait-specific RNG sequences should diverge for different genomes",
  );
});

test("DNA.random seeded with createRNG diverges across seeds", () => {
  const first = sampleGenome(1);
  const second = sampleGenome(2);

  assert.not.equal(first.genes, second.genes);
  assert.not.equal(first.seed, second.seed);
});
