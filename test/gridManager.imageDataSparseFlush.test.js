import { assert, test } from "#tests/harness";

class StubImageDataContext {
  constructor(canvas, sink) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = false;
    this.#sink = sink;
  }

  #sink;

  createImageData(width, height) {
    return { data: new Uint8ClampedArray(width * height * 4), width, height };
  }

  putImageData(imageData, dx, dy, dirtyX, dirtyY, dirtyWidth, dirtyHeight) {
    this.#sink.push({ dirtyX, dirtyY, dirtyWidth, dirtyHeight, imageData });
  }
}

test("GridManager batches sparse dirty tiles into row segments", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
    consumeEnergy() {}
  }

  const calls = [];
  const originalOffscreenCanvas = globalThis.OffscreenCanvas;

  class StubOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._ctx = null;
    }

    getContext(type) {
      if (type !== "2d") return null;
      if (!this._ctx) {
        this._ctx = new StubImageDataContext(this, calls);
      }

      return this._ctx;
    }
  }

  globalThis.OffscreenCanvas = StubOffscreenCanvas;

  const ctx = {
    canvas: { width: 48, height: 48 },
    imageSmoothingEnabled: false,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    drawImage() {},
    save() {},
    restore() {},
  };

  const gm = new TestGridManager(12, 12, {
    ctx,
    cellSize: 4,
    eventManager: { activeEvents: [] },
    stats: { onBirth() {}, onDeath() {} },
  });

  try {
    gm.draw({ renderStrategy: "image-data", showObstacles: false });
    assert.is(calls.length, 1, "initial draw should write the full buffer once");

    calls.length = 0;

    gm.placeCell(0, 0, { color: "#ff0000" });
    gm.placeCell(11, 11, { color: "#00ff00" });

    gm.draw({ renderStrategy: "image-data", showObstacles: false });

    assert.is(calls.length, 2, "sparse tiles should flush per affected row");

    const [first, second] = calls;

    assert.equal(
      { x: first.dirtyX, y: first.dirtyY, w: first.dirtyWidth, h: first.dirtyHeight },
      { x: 0, y: 0, w: 1, h: 1 },
      "top-left tile should flush individually",
    );
    assert.equal(
      {
        x: second.dirtyX,
        y: second.dirtyY,
        w: second.dirtyWidth,
        h: second.dirtyHeight,
      },
      { x: 11, y: 11, w: 1, h: 1 },
      "bottom-right tile should flush individually",
    );
  } finally {
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  }
});
