import { assert, test } from "#tests/harness";

let DNA;
let SHARED_RNG_CACHE_MAX_ENTRIES;

const PARTNER_COUNT = 300;

function createPartner(seedValue) {
  return {
    seed: () => seedValue,
  };
}

test.before(async () => {
  ({ DNA, SHARED_RNG_CACHE_MAX_ENTRIES } = await import("../src/genome.js"));
});

test("sharedRng cache evicts oldest entries after reaching its cap", () => {
  const dna = new DNA(0, 0, 0);
  const firstPartner = createPartner(1);
  const secondPartner = createPartner(2);
  const firstKey = `${firstPartner.seed()}:tag-0`;

  const firstSample = dna.sharedRng(firstPartner, "tag-0")();
  const secondSample = dna.sharedRng(secondPartner, "tag-1")();

  for (let index = 2; index < PARTNER_COUNT; index += 1) {
    const partner = createPartner(index + 1);

    dna.sharedRng(partner, `tag-${index}`);
  }

  assert.ok(
    dna._sharedRngCache.size <= SHARED_RNG_CACHE_MAX_ENTRIES,
    "shared RNG cache should enforce an upper bound to avoid unbounded growth",
  );
  assert.strictEqual(
    dna._sharedRngCache.has(firstKey),
    false,
    "oldest shared RNG entries should be evicted once the cap is exceeded",
  );

  const firstAfter = dna.sharedRng(firstPartner, "tag-0")();
  const secondAfter = dna.sharedRng(secondPartner, "tag-1")();

  assert.strictEqual(
    firstAfter,
    firstSample,
    "recomputed shared RNG should remain deterministic after eviction",
  );
  assert.strictEqual(
    secondAfter,
    secondSample,
    "shared RNG determinism must hold for entries reloaded after pruning",
  );
  assert.ok(
    dna._sharedRngCache.size <= SHARED_RNG_CACHE_MAX_ENTRIES,
    "shared RNG cache should remain capped after reloading evicted entries",
  );
});
