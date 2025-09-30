import { test } from "uvu";
import * as assert from "uvu/assert";
import { MockCanvas } from "./helpers/simulationEngine.js";

const simulationModulePromise = import("../src/main.js");

test("createSimulation runs in a headless Node environment", async () => {
  const { createSimulation } = await simulationModulePromise;
  const canvas = new MockCanvas(100, 100);
  const calls = [];

  const simulation = createSimulation({
    canvas,
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    requestAnimationFrame: (cb) => {
      const id = setTimeout(() => {
        calls.push("raf");
        cb(0);
      }, 0);

      return id;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
  });

  assert.ok(simulation.grid, "grid is returned");
  assert.ok(simulation.uiManager, "uiManager is returned");

  const result = simulation.step();

  assert.type(result, "boolean", "step returns whether a tick occurred");

  simulation.stop();
  assert.ok(Array.isArray(calls));
});

test("createSimulation headless mode infers a canvas when omitted", async () => {
  const { createSimulation } = await simulationModulePromise;

  const simulation = createSimulation({
    headless: true,
    autoStart: false,
    performanceNow: () => 0,
    config: { rows: 8, cols: 12, cellSize: 5 },
  });

  assert.ok(simulation.engine.canvas, "engine exposes a fallback canvas");
  assert.is(simulation.engine.canvas.width, 60);
  assert.is(simulation.engine.canvas.height, 40);

  simulation.destroy();
});

test.run();
