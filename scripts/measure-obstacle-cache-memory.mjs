import GridManager from "../src/grid/gridManager.js";

class StubOffscreenContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = false;
    this._buffer = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  }

  clearRect() {
    this._buffer.fill(0);
  }

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

globalThis.OffscreenCanvas = StubOffscreenCanvas;

const canvasWidth = 512;
const canvasHeight = 512;

const ctx = {
  canvas: { width: canvasWidth, height: canvasHeight },
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

const manager = new GridManager(128, 128, {
  ctx,
  cellSize: 4,
  stats: { onBirth() {}, onDeath() {} },
  eventManager: { activeEvents: [] },
});

for (let row = 0; row < manager.rows; row += 4) {
  for (let col = 0; col < manager.cols; col += 4) {
    manager.setObstacle(row, col, true, { evict: false });
  }
}

manager.draw({ showObstacles: true, renderStrategy: "canvas" });

if (typeof global.gc === "function") {
  global.gc();
}

const heapWithObstacles = process.memoryUsage().heapUsed;
const cacheEntriesBefore = manager.obstacleRenderCache?.caches?.size ?? null;
const bufferBytesBefore = manager.obstacleRenderCache
  ? Array.from(manager.obstacleRenderCache.caches.values()).reduce(
      (total, entry) =>
        total +
        (entry?.fill?.ctx?._buffer?.byteLength ?? 0) +
        (entry?.stroke?.ctx?._buffer?.byteLength ?? 0),
      0,
    )
  : 0;

manager.clearObstacles();

if (typeof global.gc === "function") {
  global.gc();
}

const heapAfterClear = process.memoryUsage().heapUsed;
const cacheEntriesAfter = manager.obstacleRenderCache?.caches?.size ?? null;
const bufferBytesAfter = manager.obstacleRenderCache
  ? Array.from(manager.obstacleRenderCache.caches.values()).reduce(
      (total, entry) =>
        total +
        (entry?.fill?.ctx?._buffer?.byteLength ?? 0) +
        (entry?.stroke?.ctx?._buffer?.byteLength ?? 0),
      0,
    )
  : 0;

console.log(
  JSON.stringify(
    {
      heapWithObstacles,
      heapAfterClear,
      reclaimedBytes: heapWithObstacles - heapAfterClear,
      cacheEntriesBefore,
      cacheEntriesAfter,
      bufferBytesBefore,
      bufferBytesAfter,
      bufferBytesReclaimed: bufferBytesBefore - bufferBytesAfter,
    },
    null,
    2,
  ),
);
