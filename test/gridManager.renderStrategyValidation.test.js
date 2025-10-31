import { assert, test } from "#tests/harness";
import { RenderStrategy } from "../src/grid/renderStrategy.js";

class StubContext {
  constructor() {
    this.canvas = { width: 4, height: 4 };
    this.imageSmoothingEnabled = false;
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  drawImage() {}
  save() {}
  restore() {}
}

test("GridManager validates render strategies", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const ctx = new StubContext();
  const options = {
    ctx,
    cellSize: 1,
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {} },
    renderStrategy: RenderStrategy.CANVAS,
  };

  const gm = new TestGridManager(2, 2, options);

  assert.is(gm.renderStrategy, RenderStrategy.CANVAS);

  assert.doesNotThrow(() => {
    gm.draw({ showObstacles: false });
  });

  assert.doesNotThrow(() => {
    gm.draw({ renderStrategy: RenderStrategy.IMAGE_DATA, showObstacles: false });
  });

  assert.throws(
    () => {
      gm.draw({ renderStrategy: "bogus", showObstacles: false });
    },
    /invalid render strategy/i,
    "unknown values should be rejected",
  );

  assert.throws(
    () =>
      new TestGridManager(2, 2, {
        ...options,
        renderStrategy: "bogus",
      }),
    /invalid render strategy/i,
    "constructor should validate configured values",
  );
});
