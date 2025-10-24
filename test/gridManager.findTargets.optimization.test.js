import { assert, test } from "#tests/harness";

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onDeath() {},
    onBirth() {},
  },
  ctx: {},
  cellSize: 1,
};

function createStubCell({
  id,
  sight = 0,
  enemyBias = { min: 0, max: 0 },
  riskTolerance = 0.5,
  allyThreshold = 0.8,
  enemyThreshold = 0.2,
} = {}) {
  const similarity = new Map();
  const resolveEnemyBias = enemyBias || {};

  const cell = {
    id,
    sight,
    density: {
      enemyBias: {
        min: Number.isFinite(resolveEnemyBias.min) ? resolveEnemyBias.min : 0,
        max: Number.isFinite(resolveEnemyBias.max) ? resolveEnemyBias.max : 0,
      },
    },
    dna: {
      allyThreshold: () => allyThreshold,
      enemyThreshold: () => enemyThreshold,
      riskTolerance: () => riskTolerance,
    },
    getRiskTolerance: () => riskTolerance,
    setSimilarity(other, value) {
      if (!other) return;

      similarity.set(other.id, value);
    },
    similarityTo(other) {
      if (!other) return 0;

      return similarity.get(other.id) ?? 0;
    },
  };

  return cell;
}

test("GridManager.findTargets classifies sparse distant cells without scanning empty columns", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const gm = new TestGridManager(30, 30, baseOptions);
  const origin = createStubCell({
    id: "origin",
    sight: 12,
    allyThreshold: 0.75,
    enemyThreshold: 0.25,
  });

  gm.placeCell(15, 15, origin);

  const ally = createStubCell({ id: "ally" });
  const enemy = createStubCell({ id: "enemy" });
  const mate = createStubCell({ id: "mate" });

  origin.setSimilarity(ally, 0.92);
  ally.setSimilarity(origin, 0.92);
  origin.setSimilarity(enemy, 0.1);
  enemy.setSimilarity(origin, 0.1);
  origin.setSimilarity(mate, 0.45);
  mate.setSimilarity(origin, 0.45);

  gm.placeCell(3, 24, ally);
  gm.placeCell(27, 17, enemy);
  gm.placeCell(15, 5, mate);

  const targets = gm.findTargets(origin.row, origin.col, origin);

  assert.is(targets.society.length, 1, "ally should be the only society target");
  assert.is(targets.society[0].target, ally, "ally target should match");
  assert.is(targets.society[0].row, ally.row, "ally row should be recorded");
  assert.is(targets.society[0].col, ally.col, "ally column should be recorded");

  assert.is(targets.enemies.length, 1, "enemy should be the only hostile target");
  assert.is(targets.enemies[0].target, enemy, "enemy target should match");
  assert.is(targets.enemies[0].row, enemy.row, "enemy row should be recorded");
  assert.is(targets.enemies[0].col, enemy.col, "enemy column should be recorded");

  assert.is(targets.mates.length, 1, "neutral candidate should be treated as mate");
  assert.is(targets.mates[0].target, mate, "mate target should match");
  assert.is(targets.mates[0].row, mate.row, "mate row should be recorded");
  assert.is(targets.mates[0].col, mate.col, "mate column should be recorded");
});
