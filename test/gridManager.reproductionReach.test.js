import { assert, test } from "#tests/harness";

const identityMateEntry = (parent, mate) => ({
  target: mate,
  row: mate.row,
  col: mate.col,
  similarity: parent.similarityTo(mate),
  diversity: 1 - parent.similarityTo(mate),
});

test("adjacent parents reproduce even when reach profile dips below one", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let blocked = null;
  const stats = {
    onBirth() {
      births += 1;
    },
    onDeath() {},
    recordMateChoice() {},
    recordReproductionBlocked(info) {
      blocked = info;
    },
  };

  const gm = new TestGridManager(3, 3, {
    eventManager: { activeEvents: [] },
    stats,
  });

  gm.densityGrid = Array.from({ length: gm.rows }, () =>
    Array.from({ length: gm.cols }, () => 0),
  );

  const parentDNA = new DNA(0, 0, 0);
  const mateDNA = new DNA(0, 0, 0);
  const parent = new Cell(1, 1, parentDNA, MAX_TILE_ENERGY);
  const mate = new Cell(1, 2, mateDNA, MAX_TILE_ENERGY);

  for (const individual of [parent, mate]) {
    individual.dna.reproductionThresholdFrac = () => 0;
    individual.dna.parentalInvestmentFrac = () => 0.25;
    individual.dna.starvationThresholdFrac = () => 0;
    individual.dna.reproductionCooldownTicks = () => 3;
  }

  parent.getReproductionReach = () => 0.6;
  mate.getReproductionReach = () => 0.6;
  parent.computeReproductionProbability = () => 1;
  parent.decideReproduction = () => ({ probability: 1 });

  const mateEntry = identityMateEntry(parent, mate);

  parent.selectMateWeighted = () => ({
    chosen: mateEntry,
    evaluated: [mateEntry],
    mode: "preference",
  });
  parent.findBestMate = () => mateEntry;

  gm.setCell(parent.row, parent.col, parent);
  gm.setCell(mate.row, mate.col, mate);

  const reproductionArgs = {
    mates: [mateEntry],
    society: [],
  };
  const context = {
    stats,
    densityGrid: gm.densityGrid,
    densityEffectMultiplier: 1,
    mutationMultiplier: 1,
  };

  const reproduced = gm.handleReproduction(
    parent.row,
    parent.col,
    parent,
    reproductionArgs,
    context,
  );

  assert.is(reproduced, true, "adjacent parents should reproduce successfully");
  assert.is(births, 1, "a single birth should be recorded");
  assert.ok(blocked == null, "reproduction should not be blocked by reach");
});
