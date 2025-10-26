import { performance } from "node:perf_hooks";
import UIManager from "../src/ui/uiManager.js";

class StubContext {
  constructor() {
    this.lineWidth = 1;
    this.strokeStyle = "#000";
  }

  clearRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
}

function createSeries(length) {
  const series = new Array(length);
  let seed = 1337;

  for (let i = 0; i < length; i++) {
    seed = (seed * 16807) % 2147483647;
    series[i] = seed / 2147483647;
  }

  return series;
}

function benchmark(iterations, length) {
  const manager = Object.create(UIManager.prototype);
  const ctx = new StubContext();
  const canvas = {
    width: 220,
    height: 48,
    getContext: () => ctx,
  };
  const data = createSeries(length);

  // Warm up once to avoid including any setup overhead.
  manager.drawSpark(canvas, data, "#88d");

  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    manager.drawSpark(canvas, data, "#88d");
  }

  const end = performance.now();
  const totalMs = end - start;
  const perCall = totalMs / iterations;

  return { totalMs, perCall };
}

const samples = [
  { iterations: 200, length: 64 },
  { iterations: 200, length: 256 },
  { iterations: 200, length: 720 },
];

for (const sample of samples) {
  const { iterations, length } = sample;
  const { totalMs, perCall } = benchmark(iterations, length);

  console.log(
    `length=${length} iterations=${iterations} totalMs=${totalMs.toFixed(
      2,
    )} avgMs=${perCall.toFixed(4)}`,
  );
}
