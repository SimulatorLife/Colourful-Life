import { assert, test } from "#tests/harness";

const statsModulePromise = import("../src/stats/index.js");

const createCell = (overrides = {}) => ({
  interactionGenes: { cooperate: 0, fight: 0, ...overrides.interactionGenes },
  dna: { reproductionProb: () => 0, ...(overrides.dna || {}) },
  sight: 0,
  ...overrides,
});

test("custom trait definitions merge with defaults and clamp thresholds", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(4, {
    traitDefinitions: [
      {
        key: " cooperation ",
        compute: (cell) => (cell?.interactionGenes?.cooperate ?? 0) * 2,
        threshold: 0.9,
      },
      {
        key: "stealth",
        compute: (cell) => cell?.stealthValue ?? 0,
        threshold: 2,
      },
      {
        key: "fighting",
        compute: () => {
          throw new Error("failing override");
        },
      },
      { key: "ignored" },
      { key: null, compute: () => 0.5 },
    ],
  });

  const traitKeys = stats.traitDefinitions.map((definition) => definition.key);

  assert.equal(traitKeys, ["cooperation", "fighting", "breeding", "sight", "stealth"]);

  const stealth = stats.traitDefinitions.find(
    (definition) => definition.key === "stealth",
  );
  const cooperation = stats.traitDefinitions.find(
    (definition) => definition.key === "cooperation",
  );

  assert.is(stealth.threshold, 1);
  assert.is(cooperation.threshold, 0.9);

  const cells = [
    createCell({
      interactionGenes: { cooperate: 0.8, fight: 0.7 },
      stealthValue: 1.2,
    }),
    createCell({
      interactionGenes: { cooperate: 0.2, fight: 0.4 },
      stealthValue: 0.3,
    }),
  ];

  const presence = stats.computeTraitPresence(cells);

  assert.is(presence.population, 2);
  assert.ok(Math.abs(presence.averages.cooperation - 0.7) < 1e-9);
  assert.ok(Math.abs(presence.fractions.cooperation - 0.5) < 1e-9);
  assert.is(presence.counts.cooperation, 1);
  assert.ok(Math.abs(presence.averages.stealth - 0.65) < 1e-9);
  assert.ok(Math.abs(presence.fractions.stealth - 0.5) < 1e-9);
  assert.is(presence.counts.stealth, 1);
  assert.is(presence.averages.fighting, 0);
  assert.is(presence.counts.fighting, 0);
});

test("history rings evict oldest samples and expose defensive copies", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(3);

  [1, 2, 3, 4, 5].forEach((value) => stats.pushHistory("population", value));
  assert.equal(stats.getHistorySeries("population"), [3, 4, 5]);

  const snapshot = stats.getHistorySeries("population");

  snapshot.push(999);
  assert.equal(stats.getHistorySeries("population"), [3, 4, 5]);

  [0.2, 0.4, 0.6, 0.8].forEach((value) =>
    stats.pushTraitHistory("presence", "cooperation", value),
  );
  assert.equal(stats.getTraitHistorySeries("presence", "cooperation"), [0.4, 0.6, 0.8]);

  stats.pushTraitHistory("presence", "missing", 1);
  assert.equal(stats.getTraitHistorySeries("presence", "missing"), []);
  assert.equal(stats.getHistorySeries("unknown"), []);
});
