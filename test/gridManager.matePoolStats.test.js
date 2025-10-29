import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";
import { clamp } from "../src/utils/math.js";

class TestGridManagerFactory {
  static async create({ rows = 20, cols = 30, stats } = {}) {
    const { default: GridManager } = await import("../src/grid/gridManager.js");

    class TestGridManager extends GridManager {
      init() {}
    }

    return new TestGridManager(rows, cols, {
      eventManager: { activeEvents: [] },
      stats,
    });
  }
}

test("handleReproduction records the full mate pool size when prioritizing candidates", async () => {
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  const recorded = [];
  const stats = {
    onBirth() {},
    onDeath() {},
    recordMateChoice(data) {
      recorded.push(data);
    },
  };

  const gm = await TestGridManagerFactory.create({ stats });

  const parentDna = new DNA(0, 0, 0);

  parentDna.reproductionThresholdFrac = () => 0;
  parentDna.parentalInvestmentFrac = () => 0.5;

  const mateDna = new DNA(0, 0, 0);

  mateDna.reproductionThresholdFrac = () => 0;
  mateDna.parentalInvestmentFrac = () => 0.5;

  const parent = new Cell(10, 10, parentDna, gm.maxTileEnergy);

  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  gm.setCell(10, 10, parent);

  const mates = [];
  const mateCount = 15;

  for (let i = 0; i < mateCount; i++) {
    const col = 11 + i;
    const mate = new Cell(10, col, mateDna, gm.maxTileEnergy);

    mate.computeReproductionProbability = () => 1;
    mate.decideReproduction = () => ({ probability: 1 });
    gm.setCell(10, col, mate);

    mates.push({
      row: mate.row,
      col: mate.col,
      target: mate,
      classification: "mate",
      precomputedSimilarity: 0.8,
      similarity: 0.8,
      diversity: 0.2,
      selectionWeight: 1,
      preferenceScore: 1,
    });
  }

  let seenPoolLength = null;

  parent.selectMateWeighted = (potentialMates) => {
    seenPoolLength = potentialMates.length;

    return {
      chosen: potentialMates[0],
      evaluated: potentialMates.slice(),
      mode: "preference",
    };
  };
  parent.findBestMate = () => mates[0];

  const result = gm.handleReproduction(
    10,
    10,
    parent,
    { mates, society: [] },
    {
      stats,
      densityGrid: gm.densityGrid,
      densityEffectMultiplier: 1,
      mutationMultiplier: 0,
    },
  );

  assert.is(result, true, "expected reproduction to succeed");
  assert.is(seenPoolLength, 12, "prioritization should limit the mating pool");
  assert.is(recorded.length, 1, "expected mate choice to be recorded");
  assert.is(recorded[0].poolSize, mateCount);
  assert.ok(Object.hasOwn(recorded[0], "diversityOpportunity"));
  assert.ok(Object.hasOwn(recorded[0], "diversityOpportunityGap"));
  assert.ok(Object.hasOwn(recorded[0], "diversityOpportunityAlignment"));
  assert.ok(Object.hasOwn(recorded[0], "diversityOpportunityMultiplier"));
});

test("handleReproduction weights diversity opportunity by available variety", async () => {
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  const recorded = [];
  const stats = {
    onBirth() {},
    onDeath() {},
    recordMateChoice(data) {
      recorded.push(data);
    },
  };

  const gm = await TestGridManagerFactory.create({ stats });

  const parentDna = new DNA(0, 0, 0);

  parentDna.reproductionThresholdFrac = () => 0;
  parentDna.parentalInvestmentFrac = () => 0.5;

  const mateDna = new DNA(0, 0, 0);

  mateDna.reproductionThresholdFrac = () => 0;
  mateDna.parentalInvestmentFrac = () => 0.5;

  const parent = new Cell(10, 10, parentDna, gm.maxTileEnergy);

  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  gm.setCell(10, 10, parent);

  const mates = [
    { diversity: 0.3, columnOffset: 1 },
    { diversity: 0.9, columnOffset: 2 },
    { diversity: 0.8, columnOffset: 3 },
    { diversity: 0.7, columnOffset: 4 },
    { diversity: 0.6, columnOffset: 5 },
    { diversity: 0.5, columnOffset: 6 },
  ].map(({ diversity, columnOffset }) => {
    const mate = new Cell(10, 10 + columnOffset, mateDna, gm.maxTileEnergy);

    mate.computeReproductionProbability = () => 1;
    mate.decideReproduction = () => ({ probability: 1 });
    gm.setCell(mate.row, mate.col, mate);

    return {
      row: mate.row,
      col: mate.col,
      target: mate,
      classification: "mate",
      precomputedSimilarity: 1 - diversity,
      similarity: 1 - diversity,
      diversity,
      selectionWeight: 1,
      preferenceScore: 1,
    };
  });

  parent.selectMateWeighted = (potentialMates) => ({
    chosen: potentialMates[0],
    evaluated: potentialMates.slice(),
    mode: "preference",
  });
  parent.findBestMate = () => mates[0];

  gm.handleReproduction(
    10,
    10,
    parent,
    { mates, society: [] },
    {
      stats,
      densityGrid: gm.densityGrid,
      densityEffectMultiplier: 1,
      mutationMultiplier: 0,
    },
  );

  assert.is(recorded.length, 1, "expected mate choice to be recorded");
  const [choice] = recorded;

  const diversities = mates.map((mate) => clamp(mate.diversity ?? 0, 0, 1));
  const threshold = clamp(choice.threshold ?? gm.matingDiversityThreshold ?? 0, 0, 1);
  const values = diversities.slice().sort((a, b) => b - a);
  const sampleCount = Math.min(values.length, 5);
  const topAverage =
    sampleCount > 0
      ? values.slice(0, sampleCount).reduce((sum, value) => sum + value, 0) /
        sampleCount
      : 0;
  const aboveThresholdCount =
    threshold > 0 ? values.filter((value) => value >= threshold).length : values.length;
  const availableAbove = Math.max(
    0,
    aboveThresholdCount - (choice.diversity >= threshold ? 1 : 0),
  );
  const availability = clamp(
    values.length > 0 ? availableAbove / values.length : 0,
    0,
    1,
  );
  const depth = aboveThresholdCount > 0 ? clamp(aboveThresholdCount / 4, 0, 1) : 0;
  const gap = clamp(topAverage - choice.diversity, 0, 1);
  const headroom = clamp((values[0] ?? 0) - threshold, 0, 1);

  let expectedScore = gap * (0.5 + availability * 0.3 + depth * 0.2);

  if (choice.diversity < threshold) {
    expectedScore += availability * (0.25 + depth * 0.3);
    expectedScore += headroom * 0.2;
  } else {
    expectedScore += headroom * 0.1;
  }

  expectedScore = clamp(expectedScore, 0, 1);
  const expectedWeight = clamp(
    availability * 0.65 + depth * 0.25 + (gap > 0.2 ? 0.1 : 0),
    0,
    1,
  );

  approxEqual(choice.diversityOpportunity, expectedScore, 1e-9);
  approxEqual(choice.diversityOpportunityWeight, expectedWeight, 1e-9);
  approxEqual(choice.diversityOpportunityAvailability, availability, 1e-9);
  approxEqual(choice.diversityOpportunityGap, gap, 1e-9);
  approxEqual(
    choice.diversityOpportunityAlignment,
    clamp(1 - gap, 0, 1) * availability,
    1e-9,
  );
  assert.ok(choice.diversityOpportunityMultiplier > 0);
});

test("novelty pressure intensifies penalties for repetitive low-diversity pairings", async () => {
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");

  async function evaluatePenalty(novelty) {
    const recorded = [];
    const stats = {
      onBirth() {},
      onDeath() {},
      recordMateChoice(data) {
        recorded.push(data);
      },
      recordReproductionBlocked() {},
      getDiversityPressure: () => 0.3,
      getBehavioralEvenness: () => 0.55,
      getStrategyPressure: () => 0.2,
    };

    const gm = await TestGridManagerFactory.create({ stats });

    gm.setMatingDiversityOptions({ threshold: 0.6, lowDiversityMultiplier: 0.5 });

    const parentDna = new DNA(0, 0, 0);

    parentDna.reproductionThresholdFrac = () => 0;
    parentDna.parentalInvestmentFrac = () => 0.5;

    const mateDna = new DNA(0, 0, 0);

    mateDna.reproductionThresholdFrac = () => 0;
    mateDna.parentalInvestmentFrac = () => 0.5;

    const parent = new Cell(5, 5, parentDna, gm.maxTileEnergy);

    parent.computeReproductionProbability = () => 1;
    parent.decideReproduction = () => ({ probability: 1 });
    parent.resolveSharedRng = () => () => 1;
    parent._mateNoveltyPressure = novelty;

    gm.setCell(5, 5, parent);

    const mate = new Cell(5, 6, mateDna, gm.maxTileEnergy);

    mate.computeReproductionProbability = () => 1;
    mate.decideReproduction = () => ({ probability: 1 });
    mate._mateNoveltyPressure = novelty;

    gm.setCell(5, 6, mate);

    const candidate = {
      row: mate.row,
      col: mate.col,
      target: mate,
      classification: "mate",
      precomputedSimilarity: 0.9,
      similarity: 0.9,
      diversity: 0.1,
      selectionWeight: 1,
      preferenceScore: 1,
    };

    const mates = [candidate];

    parent.selectMateWeighted = () => ({
      chosen: candidate,
      evaluated: [candidate],
      mode: "preference",
    });

    parent.findBestMate = () => candidate;

    const result = gm.handleReproduction(
      5,
      5,
      parent,
      { mates, society: [] },
      {
        stats,
        densityGrid: gm.densityGrid,
        densityEffectMultiplier: 1,
        mutationMultiplier: 0,
      },
    );

    assert.is(result, false, "expected reproduction to fail deterministically");
    assert.is(recorded.length, 1, "expected a single mate-choice sample");

    return recorded[0].penaltyMultiplier;
  }

  const baseline = await evaluatePenalty(0);
  const pressured = await evaluatePenalty(0.9);

  assert.ok(
    pressured < baseline,
    "novelty pressure should reduce the retained probability mass",
  );

  const reduction = baseline - pressured;

  assert.ok(
    reduction > 0.05,
    "expected novelty pressure to apply a measurable additional penalty",
  );
});
