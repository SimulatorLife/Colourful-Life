import { assert, test } from "#tests/harness";
import { RenderStrategy } from "../src/grid/renderStrategy.js";

class StubOffscreenContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = false;
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  closePath() {}
  stroke() {}
  fill() {}
  save() {}
  restore() {}
}

class StubOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._ctx = null;
  }

  getContext(type) {
    if (type !== "2d") return null;
    if (!this._ctx) {
      this._ctx = new StubOffscreenContext(this);
    }

    return this._ctx;
  }
}

test("GridManager releases obstacle render surfaces when grid is cleared", async () => {
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  globalThis.OffscreenCanvas = StubOffscreenCanvas;

  try {
    const { default: GridManager } = await import("../src/grid/gridManager.js");
    const ctx = {
      canvas: { width: 64, height: 64 },
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      drawImage() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      stroke() {},
      fill() {},
      save() {},
      restore() {},
    };

    const manager = new GridManager(16, 16, {
      ctx,
      cellSize: 4,
      stats: { onBirth() {}, onDeath() {} },
      eventManager: { activeEvents: [] },
    });

    manager.setObstacle(0, 0, true, { evict: false });
    manager.draw({ showObstacles: true, renderStrategy: RenderStrategy.CANVAS });

    assert.ok(
      (manager.obstacleRenderCache?.caches?.size ?? 0) > 0,
      "obstacle cache should allocate surfaces when obstacles are present",
    );

    manager.clearObstacles();

    assert.equal(
      manager.obstacleRenderCache?.caches?.size ?? 0,
      0,
      "clearing obstacles should release cached surfaces",
    );
  } finally {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
