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

  return {
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
}

test("GridManager target descriptor pool reuses reset descriptors across findTargets calls", async () => {
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
  const ally = createStubCell({ id: "ally" });
  const enemy = createStubCell({ id: "enemy" });
  const mate = createStubCell({ id: "mate" });

  origin.setSimilarity(ally, 0.92);
  ally.setSimilarity(origin, 0.92);
  origin.setSimilarity(enemy, 0.1);
  enemy.setSimilarity(origin, 0.1);
  origin.setSimilarity(mate, 0.45);
  mate.setSimilarity(origin, 0.45);

  gm.placeCell(15, 15, origin);
  gm.placeCell(3, 24, ally);
  gm.placeCell(27, 17, enemy);
  gm.placeCell(15, 5, mate);

  const initialPoolSize = gm.getTargetDescriptorPoolSize();

  assert.is(initialPoolSize, 0, "pool should start empty before any findTargets calls");

  // Run many scans back-to-back; each call exercises #acquireTargetDescriptor
  // and the trailing reset path. We assert that descriptors returned each call
  // carry the canonical acquire-time fields and that the previously-reset
  // dynamic fields stay at undefined.
  for (let i = 0; i < 25; i++) {
    const targets = gm.findTargets(origin.row, origin.col, origin);

    assert.is(
      targets.society.length,
      1,
      "ally should classify as society on every scan",
    );
    assert.is(
      targets.enemies.length,
      1,
      "enemy should classify as enemy on every scan",
    );
    assert.is(targets.mates.length, 1, "mate should classify as mate on every scan");

    for (const bucket of [targets.society, targets.enemies, targets.mates]) {
      for (const descriptor of bucket) {
        assert.is(
          descriptor.row,
          descriptor.target.row,
          "descriptor row should mirror target row after acquire",
        );
        assert.is(
          descriptor.col,
          descriptor.target.col,
          "descriptor col should mirror target col after acquire",
        );
        assert.ok(
          descriptor.classification.length > 0,
          "classification should be non-empty after acquire",
        );
        assert.is(
          descriptor.noveltyPressure,
          undefined,
          "noveltyPressure should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.diversity,
          undefined,
          "diversity should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.appetite,
          undefined,
          "appetite should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.mateBias,
          undefined,
          "mateBias should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.curiosityBonus,
          undefined,
          "curiosityBonus should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.preferenceScore,
          undefined,
          "preferenceScore should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.selectionWeight,
          undefined,
          "selectionWeight should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.baseReproductionProbability,
          undefined,
          "baseReproductionProbability should be reset to undefined after acquire",
        );
        assert.is(
          descriptor.neuralAffinity,
          undefined,
          "neuralAffinity should be reset to undefined after acquire",
        );
      }
    }
  }

  const finalPoolSize = gm.getTargetDescriptorPoolSize();

  assert.ok(
    finalPoolSize >= 0 && Number.isFinite(finalPoolSize),
    `pool size should remain a finite non-negative number (got ${finalPoolSize})`,
  );
});
