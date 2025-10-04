#!/usr/bin/env node
import GridManager, {
  __getColorCacheSizeForTesting,
  __resetColorCacheForTesting,
  __setColorCacheLimitForTesting,
} from "../src/grid/gridManager.js";

if (typeof global.gc !== "function") {
  console.error(
    "This script requires --expose-gc. Run with `node --expose-gc scripts/measure-color-cache.js`.",
  );
  process.exit(1);
}

class Fake2DContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.imageSmoothingEnabled = false;
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  drawImage() {}
  createImageData(width, height) {
    return { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }
  putImageData() {}
  getImageData() {
    return this.createImageData(this.canvas.width, this.canvas.height);
  }
}

class FakeCanvas {
  constructor() {
    this.width = 0;
    this.height = 0;
    this._ctx = new Fake2DContext(this);
  }

  getContext(type) {
    if (type === "2d") {
      return this._ctx;
    }

    return null;
  }
}

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag) {
      if (tag !== "canvas") {
        throw new Error(`Unsupported element type: ${tag}`);
      }

      return new FakeCanvas();
    },
  };
}

const ROWS = 64;
const COLS = 64;
const ITERATIONS = 60;

function colorForIndex(index) {
  const r = (index >> 16) & 0xff;
  const g = (index >> 8) & 0xff;
  const b = index & 0xff;

  return `rgb(${r},${g},${b})`;
}

function runMeasurement(label, limit) {
  __setColorCacheLimitForTesting(limit);
  __resetColorCacheForTesting();
  global.gc();

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const canvas = new FakeCanvas();
    const ctx = canvas.getContext("2d");
    const manager = new GridManager(ROWS, COLS, { ctx, cellSize: 1 });
    let colorIndex = iteration * ROWS * COLS;

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        manager.grid[row][col] = { color: colorForIndex(colorIndex) };
        colorIndex += 1;
      }
    }

    manager.draw({ renderStrategy: "image-data", showObstacles: false });
  }

  global.gc();
  const heapUsed = process.memoryUsage().heapUsed / (1024 * 1024);

  return {
    label,
    limit,
    heapUsedMB: Number(heapUsed.toFixed(2)),
    cacheSize: __getColorCacheSizeForTesting(),
    totalColors: ROWS * COLS * ITERATIONS,
  };
}

const scenarios = [
  { label: "unbounded", limit: Number.POSITIVE_INFINITY },
  { label: "bounded", limit: 4096 },
];

const results = scenarios.map((scenario) =>
  runMeasurement(scenario.label, scenario.limit),
);

console.log(JSON.stringify(results, null, 2));
