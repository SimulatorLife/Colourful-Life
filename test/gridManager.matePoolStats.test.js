import { assert, test } from "#tests/harness";

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
  assert.ok(Object.prototype.hasOwnProperty.call(recorded[0], "diversityOpportunity"));
});
