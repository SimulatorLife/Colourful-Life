import { assert, test } from "#tests/harness";
import { ensureCanvasDimensions } from "../src/simulationEngine.js";
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
