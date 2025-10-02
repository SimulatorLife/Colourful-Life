import { assert, test } from "#tests/harness";

const identityMateEntry = (parent, mate) =>
  parent.evaluateMateCandidate({
    row: mate.row,
    col: mate.col,
    target: mate,
  }) || {
    target: mate,
    row: mate.row,
    col: mate.col,
    similarity: 1,
    diversity: 0,
    selectionWeight: 1,
    preferenceScore: 1,
  };

test("parents observe reproduction cooldown before another birth", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");
  const { default: Cell } = await import("../src/cell.js");
  const { default: DNA } = await import("../src/genome.js");
  const { MAX_TILE_ENERGY } = await import("../src/config.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  let births = 0;
  let lastBirth = null;
  let lastBlocked = null;
  const stats = {
    onBirth: (offspring, details) => {
      births += 1;
      lastBirth = { offspring, details };
    },
    onDeath() {},
    recordMateChoice() {},
    recordReproductionBlocked(info) {
      lastBlocked = info;
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

  assert.is(reproduced, true, "first reproduction attempt should succeed");
  assert.is(births, 1, "birth counter should increment once");
  assert.ok(
    parent.getReproductionCooldown() >= 3,
    "parent should start reproduction cooldown",
  );
  assert.ok(
    mate.getReproductionCooldown() >= 3,
    "mate should start reproduction cooldown",
  );

  if (lastBirth?.details) {
    const { row, col } = lastBirth.details;

    gm.removeCell(row, col);
  }

  parent.tickReproductionCooldown();
  mate.tickReproductionCooldown();
  parent.energy = MAX_TILE_ENERGY;
  mate.energy = MAX_TILE_ENERGY;
  lastBlocked = null;

  const blocked = gm.handleReproduction(
    parent.row,
    parent.col,
    parent,
    reproductionArgs,
    context,
  );

  assert.is(blocked, false, "cooldown should block immediate reproduction");
  assert.is(births, 1, "no new births should occur while on cooldown");
  assert.is(
    lastBlocked?.reason,
    "Reproduction cooldown active",
    "blocked reason should identify cooldown",
  );
  assert.ok(
    (lastBlocked?.parentA?.cooldown ?? 0) > 0 ||
      (lastBlocked?.parentB?.cooldown ?? 0) > 0,
    "blocked payload should report remaining cooldown",
  );

  while (parent.getReproductionCooldown() > 0) parent.tickReproductionCooldown();
  while (mate.getReproductionCooldown() > 0) mate.tickReproductionCooldown();
  parent.energy = MAX_TILE_ENERGY;
  mate.energy = MAX_TILE_ENERGY;
  lastBirth = null;

  const afterCooldown = gm.handleReproduction(
    parent.row,
    parent.col,
    parent,
    reproductionArgs,
    context,
  );

  assert.is(afterCooldown, true, "reproduction should resume after cooldown");
  assert.is(births, 2, "second birth should be recorded");
  assert.ok(
    parent.getReproductionCooldown() >= 3,
    "cooldown should restart after new birth",
  );
});
