import { assert, test } from "#tests/harness";
import { ensureCanvasDimensions } from "../src/engine/environment.js";
import {
  MockCanvas,
  loadSimulationModules,
  patchSimulationPrototypes,
} from "./helpers/simulationEngine.js";

test("ensureCanvasDimensions accepts numeric string overrides", () => {
  const canvas = { width: undefined, height: undefined };
  const dimensions = ensureCanvasDimensions(canvas, {
    canvasWidth: "640",
    canvasHeight: "480",
  });

  assert.equal(dimensions, { width: 640, height: 480 });
  assert.is(canvas.width, 640);
  assert.is(canvas.height, 480);
});

test("ensureCanvasDimensions ignores zero or negative overrides", () => {
  const canvas = { width: 800, height: 600 };
  const dimensions = ensureCanvasDimensions(canvas, {
    width: 0,
    canvasHeight: -50,
  });

  assert.equal(dimensions, { width: 800, height: 600 });
  assert.is(canvas.width, 800);
  assert.is(canvas.height, 600);
});

test("ensureCanvasDimensions normalizes mixed sources", () => {
  const canvas = { width: "320", height: 200 };
  const dimensions = ensureCanvasDimensions(canvas, {
    width: "1280",
    canvasSize: { height: "720" },
  });

  assert.equal(dimensions, { width: 1280, height: 720 });
  assert.is(canvas.width, 1280);
  assert.is(canvas.height, 720);
});

test("SimulationEngine falls back to derived dimensions when row/col overrides are invalid", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const canvas = new MockCanvas(200, 100);
    const engine = new SimulationEngine({
      canvas,
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
      config: { rows: "nope", cols: { value: "bad" }, cellSize: 5 },
    });

    assert.is(engine.rows, 20);
    assert.is(engine.cols, 40);
    assert.is(engine.grid.grid.length, 20);
    assert.is(engine.grid.grid[0].length, 40);
  } finally {
    restore();
  }
});

test("SimulationEngine scales the canvas for high-DPI displays", async () => {
  const modules = await loadSimulationModules();
  const { SimulationEngine } = modules;
  const { restore } = patchSimulationPrototypes(modules);

  try {
    const canvas = new MockCanvas(200, 150);
    const listeners = {};
    const removed = [];
    const fakeWindow = {
      devicePixelRatio: 2,
      addEventListener(event, handler) {
        listeners[event] = handler;
      },
      removeEventListener(event, handler) {
        removed.push({ event, handler });
      },
    };

    const engine = new SimulationEngine({
      canvas,
      window: fakeWindow,
      autoStart: false,
      performanceNow: () => 0,
      requestAnimationFrame: () => {},
      cancelAnimationFrame: () => {},
    });

    assert.is(canvas.width, 400);
    assert.is(canvas.height, 300);
    assert.equal(canvas.getContext("2d").lastTransform, {
      a: 2,
      b: 0,
      c: 0,
      d: 2,
      e: 0,
      f: 0,
    });
    assert.ok(typeof listeners.resize === "function");

    fakeWindow.devicePixelRatio = 1.5;
    listeners.resize();

    assert.is(canvas.width, 300);
    assert.is(canvas.height, 225);
    assert.equal(canvas.getContext("2d").lastTransform, {
      a: 1.5,
      b: 0,
      c: 0,
      d: 1.5,
      e: 0,
      f: 0,
    });

    engine.destroy();

    assert.ok(
      removed.some(
        (entry) => entry.event === "resize" && entry.handler === listeners.resize,
      ),
      "resize listener should be cleaned up",
    );
  } finally {
    restore();
  }
});
