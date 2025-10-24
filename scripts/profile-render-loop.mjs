import { performance } from "node:perf_hooks";

class FakeImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class Fake2DContext {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.imageSmoothingEnabled = true;
    this.canvas = { width, height };
    this._imageDataStore = new Map();
  }

  createImageData(width, height) {
    const key = `${width}x${height}`;
    let imageData = this._imageDataStore.get(key);

    if (!imageData) {
      imageData = new FakeImageData(width, height);
      this._imageDataStore.set(key, imageData);
    }

    return imageData;
  }

  putImageData() {}

  drawImage() {}

  fillRect() {}

  strokeRect() {}

  clearRect() {}

  save() {}

  restore() {}
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this._ctx = new Fake2DContext(width, height);
  }

  getContext(type) {
    if (type === "2d") {
      return this._ctx;
    }

    return null;
  }
}

globalThis.OffscreenCanvas = FakeOffscreenCanvas;

await import("../src/utils/error.js");
const { default: GridManager } = await import("../src/grid/gridManager.js");

function seedRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x9e3779b9) >>> 0;

    return (state >>> 8) / 0x01000000;
  };
}

const rows = Number.parseInt(process.argv[2] ?? "90", 10);
const cols = Number.parseInt(process.argv[3] ?? "90", 10);
const iterations = Number.parseInt(process.argv[4] ?? "12", 10);

const ctx = new Fake2DContext(cols, rows);
const rng = seedRandom(0xdecafbad);
const manager = new GridManager(rows, cols, {
  ctx,
  cellSize: 1,
  renderStrategy: "image-data",
  rng,
});

for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    if (rng() < 0.78) {
      manager.spawnCell(row, col, { recordBirth: false });
    }
  }
}

manager.renderStrategy = "image-data";

for (let i = 0; i < 3; i++) {
  manager.draw({ renderStrategy: "image-data", showObstacles: false });
}

const samples = [];

for (let i = 0; i < iterations; i++) {
  const start = performance.now();

  manager.draw({ renderStrategy: "image-data", showObstacles: false });
  const end = performance.now();

  samples.push(end - start);
}

const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;
const max = Math.max(...samples);
const min = Math.min(...samples);

console.log(
  JSON.stringify(
    {
      rows,
      cols,
      iterations,
      avg,
      min,
      max,
      samples,
      renderMode: manager.renderStats?.mode ?? "unknown",
    },
    null,
    2,
  ),
);
