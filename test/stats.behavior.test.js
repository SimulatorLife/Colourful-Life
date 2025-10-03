import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const statsModulePromise = import("../src/stats.js");

const createCell = (overrides = {}) => ({
  interactionGenes: { cooperate: 0, fight: 0, ...overrides.interactionGenes },
  dna: {
    reproductionProb: () => 0,
    similarity: () => 0,
    ...(overrides.dna || {}),
  },
  sight: 0,
  ...overrides,
});

test("computeTraitPresence clamps trait values and tracks active fractions", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(4);

  const cells = [
    createCell({
      interactionGenes: { cooperate: 1.2, fight: -0.2 },
      dna: { reproductionProb: () => 1.0 },
      sight: 6,
    }),
    createCell({
      interactionGenes: { cooperate: 0.5, fight: 0.6 },
      dna: { reproductionProb: () => 0.4 },
      sight: 2,
    }),
    createCell({
      interactionGenes: { cooperate: 0.6, fight: 0.7 },
      dna: { reproductionProb: () => -0.1 },
      sight: 5,
    }),
  ];

  const presence = stats.computeTraitPresence(cells);

  assert.is(presence.population, 3);
  approxEqual(presence.averages.cooperation, 0.7, 1e-9);
  approxEqual(presence.averages.fighting, 0.4333333333, 1e-9);
  approxEqual(presence.averages.breeding, 0.5, 1e-9);
  approxEqual(presence.averages.sight, 0.8, 1e-9);
  approxEqual(presence.fractions.cooperation, 2 / 3, 1e-9);
  approxEqual(presence.fractions.fighting, 2 / 3, 1e-9);
  approxEqual(presence.fractions.breeding, 1 / 3, 1e-9);
  approxEqual(presence.fractions.sight, 2 / 3, 1e-9);
  assert.is(presence.counts.cooperation, 2);
  assert.is(presence.counts.fighting, 2);
  assert.is(presence.counts.breeding, 1);
  assert.is(presence.counts.sight, 2);
});

test("estimateDiversity enumerates unique pairs when sample budget covers population", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();
  const similarityMatrix = new Map([
    ["0|1", 0.1],
    ["0|2", 0.3],
    ["1|2", 0.8],
  ]);
  const makeCell = (id) =>
    createCell({
      dna: {
        id,
        reproductionProb: () => 0,
        similarity(otherDna) {
          const a = Math.min(id, otherDna.id);
          const b = Math.max(id, otherDna.id);
          const key = `${a}|${b}`;

          return similarityMatrix.get(key) ?? 1;
        },
      },
    });
  const cells = [makeCell(0), makeCell(1), makeCell(2)];
  const distances = [
    1 - similarityMatrix.get("0|1"),
    1 - similarityMatrix.get("0|2"),
    1 - similarityMatrix.get("1|2"),
  ];
  const expected = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  const originalRandom = Math.random;
  const sequence = [0.1, 0.5, 0.4, 0.1, 0.2, 0.9];
  let index = 0;

  Math.random = () => {
    const value = sequence[index % sequence.length];

    index += 1;

    return value;
  };

  try {
    const actual = stats.estimateDiversity(cells, 10);

    approxEqual(actual, expected, 1e-9);
  } finally {
    Math.random = originalRandom;
  }
});

test("mating records track diversity-aware outcomes and block reasons", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(3);

  stats.setMatingDiversityThreshold(0.6);

  stats.recordReproductionBlocked({
    reason: "Too similar",
    parentA: { id: "a" },
    parentB: { id: "b" },
    spawn: { id: "c" },
  });

  assert.is(stats.mating.blocks, 1);
  assert.is(stats.mating.lastBlockReason, "Too similar");
  assert.equal(stats.lastBlockedReproduction.reason, "Too similar");
  assert.is(stats.lastBlockedReproduction.tick, 0);

  stats.recordMateChoice({
    similarity: 0.2,
    diversity: 0.7,
    appetite: 0.5,
    bias: 0.1,
    selectionMode: "curiosity",
    poolSize: 3,
    success: true,
    penalized: true,
    penaltyMultiplier: 0.4,
    behaviorComplementarity: 0.8,
    strategyPenaltyMultiplier: 0.6,
    strategyPressure: 0.3,
  });

  assert.is(stats.mating.choices, 1);
  assert.is(stats.mating.successes, 1);
  assert.is(stats.mating.diverseChoices, 1);
  assert.is(stats.mating.diverseSuccesses, 1);
  assert.is(stats.mating.selectionModes.curiosity, 1);
  assert.is(stats.mating.selectionModes.preference, 0);
  approxEqual(stats.mating.appetiteSum, 0.5, 1e-9);
  assert.is(stats.mating.poolSizeSum, 3);
  approxEqual(stats.mating.complementaritySum, 0.8, 1e-9);
  approxEqual(stats.mating.complementaritySuccessSum, 0.8, 1e-9);
  approxEqual(stats.mating.strategyPenaltySum, 0.6, 1e-9);
  approxEqual(stats.mating.strategyPressureSum, 0.3, 1e-9);
  assert.equal(stats.lastMatingDebug.blockedReason, "Too similar");
  assert.is(stats.lastMatingDebug.threshold, 0.6);
  approxEqual(stats.lastMatingDebug.behaviorComplementarity, 0.8, 1e-9);
  approxEqual(stats.lastMatingDebug.strategyPenaltyMultiplier, 0.6, 1e-9);
  approxEqual(stats.lastMatingDebug.strategyPressure, 0.3, 1e-9);
  assert.is(stats.mating.lastBlockReason, null);

  stats.recordMateChoice({
    similarity: 0.8,
    diversity: 0.5,
    selectionMode: "preference",
    poolSize: 2,
    success: false,
    behaviorComplementarity: 0.1,
  });

  assert.is(stats.mating.choices, 2);
  assert.is(stats.mating.successes, 1);
  assert.is(stats.mating.diverseChoices, 1);
  assert.is(stats.mating.diverseSuccesses, 1);
  assert.is(stats.mating.selectionModes.curiosity, 1);
  assert.is(stats.mating.selectionModes.preference, 1);
  approxEqual(stats.mating.complementaritySum, 0.9, 1e-9);
  approxEqual(stats.mating.complementaritySuccessSum, 0.8, 1e-9);
  approxEqual(stats.mating.strategyPenaltySum, 1.6, 1e-9);
  approxEqual(stats.mating.strategyPressureSum, 0.3, 1e-9);
  assert.equal(stats.lastMatingDebug.success, false);
  assert.is(stats.lastMatingDebug.threshold, 0.6);
  approxEqual(stats.lastMatingDebug.behaviorComplementarity, 0.1, 1e-9);
  approxEqual(stats.lastMatingDebug.strategyPenaltyMultiplier, 1, 1e-9);
  assert.is(stats.lastMatingDebug.strategyPressure, undefined);

  stats.recordReproductionBlocked({ reason: "Blocked by reproductive zone" });

  assert.is(stats.mating.blocks, 2);
  assert.is(stats.mating.lastBlockReason, "Blocked by reproductive zone");
  assert.equal(stats.lastBlockedReproduction.reason, "Blocked by reproductive zone");
});

test("mating threshold overrides are respected", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(2);

  stats.setMatingDiversityThreshold(0.5);

  stats.recordMateChoice({ diversity: 0.25, threshold: 0.2 });

  assert.is(stats.mating.choices, 1);
  assert.is(stats.mating.diverseChoices, 1);
  assert.is(stats.lastMatingDebug.threshold, 0.2);

  stats.recordMateChoice({ diversity: 0.1, threshold: 0.8 });

  assert.is(stats.mating.choices, 2);
  assert.is(stats.mating.diverseChoices, 1);
  assert.is(stats.lastMatingDebug.threshold, 0.8);
});

test("updateFromSnapshot aggregates metrics and caps histories", async () => {
  const { default: Stats } = await statsModulePromise;

  class DeterministicStats extends Stats {
    constructor(size, options = {}) {
      super(size, options);
      this.diversitySequence = [];
    }

    estimateDiversity() {
      return this.diversitySequence.length ? this.diversitySequence.shift() : 0;
    }
  }

  const stats = new DeterministicStats(3, {
    diversitySampleInterval: 1,
    traitResampleInterval: 1,
  });

  stats.mating = {
    choices: 2,
    successes: 1,
    diverseChoices: 1,
    diverseSuccesses: 1,
    appetiteSum: 1.2,
    selectionModes: { curiosity: 1, preference: 0 },
    poolSizeSum: 5,
    complementaritySum: 0.75,
    complementaritySuccessSum: 0.6,
    strategyPenaltySum: 1.7,
    strategyPressureSum: 0.4,
    blocks: 1,
    lastBlockReason: "Still recent",
  };
  stats.lastMatingDebug = { mode: "test" };
  stats.lastBlockedReproduction = { reason: "Still recent", tick: 0 };
  stats.mutationMultiplier = 2;
  stats.diversitySequence.push(0.42, 0.1, 0.2, 0.3);

  stats.births = 2;
  stats.deaths = 1;
  stats.fights = 4;
  stats.cooperations = 3;

  const cells = [
    createCell({
      interactionGenes: { cooperate: 0.5, fight: 0.4 },
      sight: 2,
    }),
    createCell({
      interactionGenes: { cooperate: 0.8, fight: 0.9 },
      sight: 3,
    }),
  ];

  const result = stats.updateFromSnapshot({
    population: 2,
    totalEnergy: 6,
    totalAge: 9,
    cells,
  });

  assert.is(result.population, 2);
  assert.is(result.births, 2);
  assert.is(result.deaths, 1);
  assert.is(result.growth, 1);
  assert.is(result.birthsPerTick, 2);
  assert.is(result.deathsPerTick, 1);
  assert.is(result.fights, 4);
  assert.is(result.cooperations, 3);
  assert.is(result.meanEnergy, 3);
  assert.is(result.meanAge, 4.5);
  assert.is(result.diversity, 0.42);
  assert.is(result.diversityPressure, 0);
  assert.is(result.diversityTarget, stats.getDiversityTarget());
  assert.equal(result.traitPresence, stats.traitPresence);
  assert.is(result.mateChoices, 2);
  assert.is(result.successfulMatings, 1);
  assert.is(result.diverseChoiceRate, 0.5);
  assert.is(result.diverseMatingRate, 1);
  assert.is(result.meanDiversityAppetite, 0.6);
  approxEqual(result.meanBehaviorComplementarity, 0.375, 1e-9);
  approxEqual(result.successfulBehaviorComplementarity, 0.6, 1e-9);
  approxEqual(result.behaviorEvenness, 1, 1e-9);
  approxEqual(result.meanStrategyPenalty, 0.85, 1e-9);
  approxEqual(result.meanStrategyPressure, 0.2, 1e-9);
  approxEqual(result.strategyPressure, stats.getStrategyPressure(), 1e-9);
  assert.is(result.curiositySelections, 1);
  assert.equal(result.lastMating, stats.lastMatingDebug);
  assert.is(result.mutationMultiplier, 2);
  assert.is(result.blockedMatings, 1);
  assert.equal(result.lastBlockedReproduction.reason, "Still recent");

  approxEqual(stats.getBehavioralEvenness(), 1, 1e-9);

  assert.is(stats.history.population.length, 1);
  assert.is(stats.history.diversity.length, 1);
  assert.is(stats.history.diversityPressure.length, 1);
  assert.is(stats.history.energy.length, 1);
  assert.is(stats.history.growth.length, 1);
  assert.is(stats.history.birthsPerTick.length, 1);
  assert.is(stats.history.deathsPerTick.length, 1);
  assert.is(stats.history.birthsPerTick[0], 2);
  assert.is(stats.history.deathsPerTick[0], 1);
  assert.is(stats.history.diversePairingRate.length, 1);
  assert.is(stats.history.diversePairingRate[0], 0.5);
  assert.is(stats.history.meanDiversityAppetite.length, 1);
  assert.is(stats.history.mutationMultiplier.length, 1);

  assert.is(stats.traitHistory.presence.cooperation.length, 1);
  assert.is(stats.traitHistory.average.cooperation.length, 1);

  for (let i = 0; i < 3; i += 1) {
    stats.resetTick();
    stats.mating = {
      choices: 0,
      successes: 0,
      diverseChoices: 0,
      diverseSuccesses: 0,
      appetiteSum: 0,
      selectionModes: { curiosity: 0, preference: 0 },
      poolSizeSum: 0,
      strategyPenaltySum: 0,
      strategyPressureSum: 0,
    };
    stats.births = i;
    stats.deaths = 0;
    stats.diversitySequence.push(0.1 * (i + 1));

    stats.updateFromSnapshot({
      population: 1,
      totalEnergy: i + 1,
      totalAge: i + 2,
      cells,
    });
  }

  assert.is(stats.history.population.length, 3);
  assert.is(stats.history.diversity.length, 3);
  assert.is(stats.history.energy.length, 3);
  assert.is(stats.history.growth.length, 3);
  assert.is(stats.history.birthsPerTick.length, 3);
  assert.is(stats.history.deathsPerTick.length, 3);
  assert.is(stats.history.diversePairingRate.length, 3);
  assert.is(stats.history.meanDiversityAppetite.length, 3);
  assert.is(stats.history.mutationMultiplier.length, 3);
  assert.is(stats.traitHistory.presence.cooperation.length, 3);
  assert.is(stats.traitHistory.average.cooperation.length, 3);

  assert.equal(stats.history.population, [1, 1, 1]);
  assert.equal(stats.history.diversity, [0.1, 0.2, 0.3]);
  assert.equal(stats.history.birthsPerTick, [0, 1, 2]);
  assert.equal(stats.history.deathsPerTick, [0, 0, 0]);
  assert.equal(stats.getHistorySeries("population"), [1, 1, 1]);
  assert.equal(stats.getTraitHistorySeries("presence", "cooperation"), [0.5, 0.5, 0.5]);
});

test("diversity sampling caches results between configured intervals", async () => {
  const { default: Stats } = await statsModulePromise;
  let calls = 0;

  class CountingStats extends Stats {
    constructor(options = {}) {
      super(4, options);
    }

    estimateDiversity(cells) {
      calls += 1;

      return super.estimateDiversity(cells);
    }
  }

  const stats = new CountingStats({
    diversitySampleInterval: 3,
    traitResampleInterval: 1,
  });
  const cells = [
    createCell({ interactionGenes: { cooperate: 0.4, fight: 0.3 } }),
    createCell({ interactionGenes: { cooperate: 0.6, fight: 0.2 } }),
  ];
  const snapshot = {
    population: cells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells,
  };

  stats.updateFromSnapshot(snapshot);

  assert.is(calls, 1);
  assert.is(stats.history.diversity.length, 1);

  for (let i = 0; i < 2; i += 1) {
    stats.resetTick();
    stats.updateFromSnapshot(snapshot);

    assert.is(
      calls,
      1,
      "diversity should stay cached before the sample interval elapses",
    );
  }

  stats.resetTick();
  stats.updateFromSnapshot(snapshot);

  assert.is(calls, 2);
  assert.is(stats.history.diversity.length, 4);
  assert.is(stats.history.diversity[0], stats.history.diversity[1]);
  assert.is(stats.history.diversity[1], stats.history.diversity[2]);
});

test("trait presence rebuild honors resample interval when events are absent", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(4, {
    traitResampleInterval: 3,
    diversitySampleInterval: 1,
  });

  const cooperativeA = [
    createCell({ interactionGenes: { cooperate: 0.9, fight: 0.1 }, sight: 0.7 }),
    createCell({ interactionGenes: { cooperate: 0.8, fight: 0.2 }, sight: 0.6 }),
  ];
  const cooperativeB = [
    createCell({ interactionGenes: { cooperate: 0.2, fight: 0.8 }, sight: 0.4 }),
    createCell({ interactionGenes: { cooperate: 0.1, fight: 0.9 }, sight: 0.3 }),
  ];
  const snapshotA = {
    population: cooperativeA.length,
    totalEnergy: 0,
    totalAge: 0,
    cells: cooperativeA,
  };
  const snapshotB = {
    population: cooperativeB.length,
    totalEnergy: 0,
    totalAge: 0,
    cells: cooperativeB,
  };

  stats.updateFromSnapshot(snapshotA);

  approxEqual(stats.traitPresence.averages.cooperation, 0.85, 1e-9);

  for (let i = 0; i < 2; i += 1) {
    stats.resetTick();
    stats.updateFromSnapshot(snapshotB);

    approxEqual(
      stats.traitPresence.averages.cooperation,
      0.85,
      1e-9,
      "trait averages should remain cached before the resample interval expires",
    );
  }

  stats.resetTick();
  stats.updateFromSnapshot(snapshotB);

  approxEqual(stats.traitPresence.averages.cooperation, 0.15, 1e-9);
});

test("life event ticks align with the active simulation tick", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.resetAll();
  stats.resetTick();

  const offspring = createCell({ row: 3, col: 4, energy: 5 });

  stats.onBirth(offspring, {
    row: offspring.row,
    col: offspring.col,
    energy: offspring.energy,
  });

  stats.updateFromSnapshot({
    population: 1,
    totalEnergy: offspring.energy,
    totalAge: 0,
    cells: [offspring],
  });

  const [birthEvent] = stats.getRecentLifeEvents(1);

  assert.ok(birthEvent, "birth should be recorded");
  assert.is(birthEvent.tick, stats.totals.ticks);

  stats.resetAll();

  stats.onDeath({ row: 1, col: 2, cause: "obstacle" });

  const [deathEvent] = stats.getRecentLifeEvents(1);

  assert.ok(deathEvent, "obstacle removal should be recorded");
  assert.is(deathEvent.tick, stats.totals.ticks);
});

test("diversity pressure responds to behavioral stagnation and complementary success", async () => {
  const { default: Stats } = await statsModulePromise;

  class DeterministicStats extends Stats {
    constructor(size, options = {}) {
      super(size, options);
      this.diversitySequence = [];
    }

    estimateDiversity() {
      return this.diversitySequence.length ? this.diversitySequence.shift() : 0;
    }
  }

  const stats = new DeterministicStats(3, {
    diversitySampleInterval: 1,
    traitResampleInterval: 1,
  });

  stats.diversitySequence.push(0.34, 0.34);

  const homogeneousCells = [
    createCell({ interactionGenes: { cooperate: 0.95, fight: 0.05 }, sight: 0.2 }),
    createCell({ interactionGenes: { cooperate: 0.92, fight: 0.04 }, sight: 0.1 }),
    createCell({ interactionGenes: { cooperate: 0.9, fight: 0.03 }, sight: 0.1 }),
  ];

  stats.mating = {
    choices: 1,
    successes: 1,
    diverseChoices: 0,
    diverseSuccesses: 0,
    appetiteSum: 0,
    selectionModes: { curiosity: 0, preference: 1 },
    poolSizeSum: 0,
    complementaritySum: 0.1,
    complementaritySuccessSum: 0.1,
    strategyPenaltySum: 1,
    strategyPressureSum: 0,
  };

  stats.updateFromSnapshot({
    population: homogeneousCells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells: homogeneousCells,
  });

  const firstEvenness = stats.getBehavioralEvenness();

  assert.ok(firstEvenness < 0.3);
  const firstPressure = stats.getDiversityPressure();

  assert.ok(firstPressure > 0.02);

  stats.resetTick();
  stats.mating = {
    choices: 1,
    successes: 1,
    diverseChoices: 0,
    diverseSuccesses: 0,
    appetiteSum: 0,
    selectionModes: { curiosity: 0, preference: 1 },
    poolSizeSum: 0,
    complementaritySum: 0.9,
    complementaritySuccessSum: 0.9,
    strategyPenaltySum: 1,
    strategyPressureSum: 0,
  };

  stats.diversitySequence.push(0.34);

  stats.updateFromSnapshot({
    population: homogeneousCells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells: homogeneousCells,
  });

  const relievedPressure = stats.getDiversityPressure();

  assert.ok(relievedPressure < firstPressure);
});

test("strategy pressure intensifies when monotony escapes penalties", async () => {
  const { default: Stats } = await statsModulePromise;

  class DeterministicStats extends Stats {
    constructor(size, options = {}) {
      super(size, options);
      this.diversitySequence = [];
    }

    estimateDiversity() {
      return this.diversitySequence.length ? this.diversitySequence.shift() : 0;
    }
  }

  const monotoneCells = [
    createCell({ interactionGenes: { cooperate: 0.95, fight: 0.05 }, sight: 0.2 }),
    createCell({ interactionGenes: { cooperate: 0.94, fight: 0.04 }, sight: 0.1 }),
    createCell({ interactionGenes: { cooperate: 0.93, fight: 0.03 }, sight: 0.1 }),
  ];

  const snapshot = {
    population: monotoneCells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells: monotoneCells,
  };

  const unchecked = new DeterministicStats(3, {
    diversitySampleInterval: 1,
    traitResampleInterval: 1,
  });

  unchecked.diversitySequence.push(0.22);
  unchecked.mating = {
    choices: 1,
    successes: 1,
    diverseChoices: 0,
    diverseSuccesses: 0,
    appetiteSum: 0,
    selectionModes: { curiosity: 0, preference: 1 },
    poolSizeSum: 0,
    complementaritySum: 0.15,
    complementaritySuccessSum: 0.15,
    strategyPenaltySum: 1,
    strategyPressureSum: 0,
  };
  unchecked.updateFromSnapshot(snapshot);

  const relieved = new DeterministicStats(3, {
    diversitySampleInterval: 1,
    traitResampleInterval: 1,
  });

  relieved.diversitySequence.push(0.22);
  relieved.mating = {
    choices: 1,
    successes: 1,
    diverseChoices: 0,
    diverseSuccesses: 0,
    appetiteSum: 0,
    selectionModes: { curiosity: 0, preference: 1 },
    poolSizeSum: 0,
    complementaritySum: 0.15,
    complementaritySuccessSum: 0.15,
    strategyPenaltySum: 0.5,
    strategyPressureSum: 0,
  };
  relieved.updateFromSnapshot(snapshot);

  const uncheckedPressure = unchecked.getStrategyPressure();
  const relievedPressure = relieved.getStrategyPressure();

  assert.ok(uncheckedPressure > relievedPressure);
  assert.ok(uncheckedPressure - relievedPressure > 0.01);
});

test("behavioral evenness drops when one trait dominates", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(2);

  const cells = [
    createCell({ interactionGenes: { cooperate: 0.95, fight: 0.1 }, sight: 0.2 }),
    createCell({ interactionGenes: { cooperate: 0.92, fight: 0.05 }, sight: 0.1 }),
    createCell({ interactionGenes: { cooperate: 0.88, fight: 0.05 }, sight: 0.1 }),
  ];

  stats.updateFromSnapshot({
    population: cells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells,
  });

  const evenness = stats.getBehavioralEvenness();

  assert.ok(evenness < 0.2, "dominant behavior should collapse evenness");
  approxEqual(stats.behavioralEvenness, evenness, 1e-12);
});

test("traitDefinitions option extends and overrides tracked trait metrics", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(2, {
    traitDefinitions: [
      { key: "cooperation", threshold: 0.9 },
      {
        key: "exploration",
        compute: (cell) => cell?.exploration ?? 0,
        threshold: 0.5,
      },
    ],
  });

  const cells = [
    createCell({
      interactionGenes: { cooperate: 0.95 },
      exploration: 0.9,
      dna: { reproductionProb: () => 0.8, similarity: () => 0.5 },
    }),
    createCell({
      interactionGenes: { cooperate: 0.65 },
      exploration: 0.4,
      dna: { reproductionProb: () => 0.3, similarity: () => 0.5 },
    }),
    createCell({
      interactionGenes: { cooperate: 0.55 },
      exploration: 0.8,
      dna: { reproductionProb: () => 0.2, similarity: () => 0.5 },
    }),
  ];

  const presence = stats.computeTraitPresence(cells);

  const expectedExplorationAverage = (0.9 + 0.4 + 0.8) / cells.length;

  assert.ok("exploration" in presence.averages);
  approxEqual(presence.averages.exploration, expectedExplorationAverage, 1e-9);
  assert.is(presence.counts.cooperation, 1);
  assert.is(presence.counts.exploration, 2);

  stats.updateFromSnapshot({
    population: cells.length,
    totalEnergy: 0,
    totalAge: 0,
    cells,
  });

  assert.is(stats.traitHistory.presence.exploration.length, 1);
  assert.is(stats.traitHistory.average.exploration.length, 1);
});

test("updateFromSnapshot tolerates missing or invalid totals", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(3);
  const cells = [createCell(), createCell(), createCell()];

  const firstSummary = stats.updateFromSnapshot({
    population: "3",
    totalEnergy: undefined,
    totalAge: "not-a-number",
    cells,
  });

  assert.is(firstSummary.meanEnergy, 0);
  assert.is(firstSummary.meanAge, 0);
  assert.equal(stats.history.energy, [0]);
  assert.equal(stats.history.population, [3]);
  assert.equal(stats.history.birthsPerTick, [0]);
  assert.equal(stats.history.deathsPerTick, [0]);

  const secondSummary = stats.updateFromSnapshot({
    population: 2,
    totalEnergy: Number.POSITIVE_INFINITY,
    totalAge: Number.NaN,
    cells: [],
  });

  assert.is(secondSummary.meanEnergy, 0);
  assert.is(secondSummary.meanAge, 0);
  assert.equal(stats.history.energy, [0, 0]);
  assert.equal(stats.history.population, [3, 2]);
  assert.equal(stats.history.birthsPerTick, [0, 0]);
  assert.equal(stats.history.deathsPerTick, [0, 0]);
});

test("diversity pressure increases when diversity stays below target", async () => {
  const { default: Stats } = await statsModulePromise;

  class PressureStats extends Stats {
    constructor() {
      super(undefined, {
        diversitySampleInterval: 1,
        traitResampleInterval: 1,
      });
      this.mockDiversity = 0.1;
    }

    estimateDiversity() {
      return this.mockDiversity;
    }
  }

  const stats = new PressureStats();
  const sparseSnapshot = {
    population: 2,
    totalEnergy: 0,
    totalAge: 0,
    cells: [createCell(), createCell()],
  };

  stats.setDiversityTarget(0.5);
  stats.updateFromSnapshot(sparseSnapshot);

  assert.ok(stats.getDiversityPressure() > 0);

  const firstPressure = stats.getDiversityPressure();

  stats.mockDiversity = 0.05;
  stats.updateFromSnapshot(sparseSnapshot);

  const elevatedPressure = stats.getDiversityPressure();

  assert.ok(elevatedPressure > firstPressure);

  stats.resetTick();
  stats.mockDiversity = 0.8;

  stats.mating = {
    choices: 1,
    successes: 1,
    diverseChoices: 1,
    diverseSuccesses: 1,
    appetiteSum: 1,
    selectionModes: { curiosity: 1, preference: 0 },
    poolSizeSum: 2,
    complementaritySum: 0.9,
    complementaritySuccessSum: 0.9,
    strategyPenaltySum: 1,
    strategyPressureSum: 0,
  };

  const variedSnapshot = {
    population: 4,
    totalEnergy: 0,
    totalAge: 0,
    cells: [
      createCell({ interactionGenes: { cooperate: 0.9, fight: 0.1 }, sight: 0.8 }),
      createCell({ interactionGenes: { cooperate: 0.2, fight: 0.9 }, sight: 0.3 }),
      createCell({ interactionGenes: { cooperate: 0.4, fight: 0.4 }, sight: 0.5 }),
      createCell({ interactionGenes: { cooperate: 0.7, fight: 0.2 }, sight: 0.6 }),
    ],
  };

  stats.updateFromSnapshot(variedSnapshot);

  assert.ok(stats.getDiversityPressure() < elevatedPressure);
});

test("history buffers maintain order while capping size", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(3);

  stats.pushHistory("population", 1);
  stats.pushHistory("population", 2);
  stats.pushHistory("population", 3);

  assert.equal(stats.history.population, [1, 2, 3]);

  stats.pushHistory("population", 4);

  assert.equal(stats.history.population, [2, 3, 4]);
  assert.equal(stats.getHistorySeries("population"), [2, 3, 4]);

  stats.pushTraitHistory("presence", "cooperation", 0.1);
  stats.pushTraitHistory("presence", "cooperation", 0.2);
  stats.pushTraitHistory("presence", "cooperation", 0.3);

  assert.equal(stats.traitHistory.presence.cooperation, [0.1, 0.2, 0.3]);

  stats.pushTraitHistory("presence", "cooperation", 0.4);

  assert.equal(stats.traitHistory.presence.cooperation, [0.2, 0.3, 0.4]);
  assert.equal(stats.getTraitHistorySeries("presence", "cooperation"), [0.2, 0.3, 0.4]);

  const chartSeries = stats.history.population;

  assert.ok(Array.isArray(chartSeries));
  assert.is(chartSeries.length, 3);
});

test("setters sanitize non-finite mutation and diversity threshold inputs", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(2);

  stats.setMatingDiversityThreshold(1.5);
  assert.is(stats.matingDiversityThreshold, 1);

  stats.setMatingDiversityThreshold(-0.2);
  assert.is(stats.matingDiversityThreshold, 0);

  stats.setMatingDiversityThreshold("0.3");
  assert.is(stats.matingDiversityThreshold, 0.3);

  stats.setMatingDiversityThreshold("not-number");
  assert.is(stats.matingDiversityThreshold, 0.3);

  stats.setMutationMultiplier(3.2);
  assert.is(stats.mutationMultiplier, 3.2);

  stats.setMutationMultiplier(-1);
  assert.is(stats.mutationMultiplier, 0);

  stats.setMutationMultiplier("not-number");
  assert.is(stats.mutationMultiplier, 1);

  stats.setMutationMultiplier(Infinity);
  assert.is(stats.mutationMultiplier, 1);
});
