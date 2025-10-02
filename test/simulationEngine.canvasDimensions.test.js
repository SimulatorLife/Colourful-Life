import { assert, test } from "#tests/harness";
import { ensureCanvasDimensions } from "../src/simulationEngine.js";

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
