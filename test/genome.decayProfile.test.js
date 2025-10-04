import { assert, test } from "#tests/harness";

let DNA;
let GENE_LOCI;

test.before(async () => {
  ({ DNA, GENE_LOCI } = await import("../src/genome.js"));
});

function neutralizeDecayRng(dna, value = 0.5) {
  const original = dna.prngFor;

  dna.prngFor = function (tag) {
    if (tag === "decayRecyclingProfile") {
      return () => value;
    }

    return original.call(this, tag);
  };
}

test("decayRecyclingProfile stays within expected bounds", () => {
  const dna = new DNA();

  neutralizeDecayRng(dna);

  const profile = dna.decayRecyclingProfile();

  assert.type(profile, "object");
  assert.ok(
    profile.immediateShare >= 0.05 && profile.immediateShare <= 0.8,
    "immediateShare clamped to 0.05..0.8",
  );
  assert.ok(
    profile.releaseBase >= 0.02 && profile.releaseBase <= 0.3,
    "releaseBase clamped to 0.02..0.3",
  );
  assert.ok(
    profile.releaseRate >= 0.05 && profile.releaseRate <= 0.45,
    "releaseRate clamped to 0.05..0.45",
  );
  assert.ok(
    profile.persistence >= 0.35 && profile.persistence <= 1.8,
    "persistence clamped to 0.35..1.8",
  );
});

test("decayRecyclingProfile encodes heritable recycling trade-offs", () => {
  const miser = new DNA();
  const nurturer = new DNA();

  neutralizeDecayRng(miser);
  neutralizeDecayRng(nurturer);

  miser.genes[GENE_LOCI.RECOVERY] = 0;
  miser.genes[GENE_LOCI.PARENTAL] = 0;
  miser.genes[GENE_LOCI.COOPERATION] = 0;
  miser.genes[GENE_LOCI.DENSITY] = 255;
  miser.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 255;

  nurturer.genes[GENE_LOCI.RECOVERY] = 255;
  nurturer.genes[GENE_LOCI.PARENTAL] = 255;
  nurturer.genes[GENE_LOCI.COOPERATION] = 255;
  nurturer.genes[GENE_LOCI.DENSITY] = 0;
  nurturer.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 64;

  const miserProfile = miser.decayRecyclingProfile();
  const nurturerProfile = nurturer.decayRecyclingProfile();

  assert.ok(
    nurturerProfile.immediateShare > miserProfile.immediateShare,
    "nurturing genomes return more energy immediately",
  );

  const slowDecay = new DNA();
  const quickDecay = new DNA();

  neutralizeDecayRng(slowDecay);
  neutralizeDecayRng(quickDecay);

  slowDecay.genes[GENE_LOCI.DENSITY] = 255;
  slowDecay.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 0;
  slowDecay.genes[GENE_LOCI.RECOVERY] = 0;
  slowDecay.genes[GENE_LOCI.SENESCENCE] = 0;

  quickDecay.genes[GENE_LOCI.DENSITY] = 0;
  quickDecay.genes[GENE_LOCI.ENERGY_EFFICIENCY] = 255;
  quickDecay.genes[GENE_LOCI.RECOVERY] = 255;
  quickDecay.genes[GENE_LOCI.SENESCENCE] = 255;

  const slowProfile = slowDecay.decayRecyclingProfile();
  const quickProfile = quickDecay.decayRecyclingProfile();

  assert.ok(
    quickProfile.releaseRate > slowProfile.releaseRate,
    "efficient genomes accelerate decay release",
  );
  assert.ok(
    slowProfile.persistence > quickProfile.persistence,
    "dense, low-efficiency genomes keep reserves longer",
  );
});
