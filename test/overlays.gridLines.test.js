import { assert, suite } from "#tests/harness";
import { drawGridLines } from "../src/ui/overlays.js";

const test = suite("ui overlays: grid lines");

function createMockContext({ withDrawImage = false } = {}) {
  const calls = [];
  let strokeStyle = null;
  let lineWidth = 0;
  let smoothingEnabled = true;

  return {
    get calls() {
      return calls;
    },
    set strokeStyle(value) {
      strokeStyle = value;
      calls.push({ type: "setStrokeStyle", value });
    },
    get strokeStyle() {
      return strokeStyle;
    },
    set lineWidth(value) {
      lineWidth = value;
      calls.push({ type: "setLineWidth", value });
    },
    get lineWidth() {
      return lineWidth;
    },
    get imageSmoothingEnabled() {
      return smoothingEnabled;
    },
    set imageSmoothingEnabled(value) {
      smoothingEnabled = value;
      calls.push({ type: "setImageSmoothing", value });
    },
    save() {
      calls.push({ type: "save" });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    moveTo(x, y) {
      calls.push({ type: "moveTo", x, y });
    },
    lineTo(x, y) {
      calls.push({ type: "lineTo", x, y });
    },
    stroke() {
      calls.push({ type: "stroke", strokeStyle, lineWidth });
    },
    drawImage: withDrawImage
      ? (...args) => {
          calls.push({ type: "drawImage", args });
        }
      : undefined,
  };
}

test("drawGridLines renders vertical and horizontal separators", () => {
  const ctx = createMockContext();

  drawGridLines(ctx, 10, 3, 4);

  assert.equal(ctx.calls, [
    { type: "save" },
    { type: "setStrokeStyle", value: "rgba(255, 255, 255, 0.1)" },
    { type: "setLineWidth", value: 1 },
    { type: "beginPath" },
    { type: "moveTo", x: 10.5, y: 0 },
    { type: "lineTo", x: 10.5, y: 30 },
    { type: "moveTo", x: 20.5, y: 0 },
    { type: "lineTo", x: 20.5, y: 30 },
    { type: "moveTo", x: 30.5, y: 0 },
    { type: "lineTo", x: 30.5, y: 30 },
    { type: "stroke", strokeStyle: "rgba(255, 255, 255, 0.1)", lineWidth: 1 },
    { type: "setStrokeStyle", value: "rgba(255, 255, 255, 0.1)" },
    { type: "setLineWidth", value: 1 },
    { type: "beginPath" },
    { type: "moveTo", x: 0, y: 10.5 },
    { type: "lineTo", x: 40, y: 10.5 },
    { type: "moveTo", x: 0, y: 20.5 },
    { type: "lineTo", x: 40, y: 20.5 },
    { type: "stroke", strokeStyle: "rgba(255, 255, 255, 0.1)", lineWidth: 1 },
    { type: "restore" },
  ]);
});

test("drawGridLines highlights emphasis intervals with alternate styling", () => {
  const ctx = createMockContext();

  drawGridLines(ctx, 8, 5, 5, {
    emphasisStep: 2,
    color: "rgba(10, 10, 10, 0.08)",
    emphasisColor: "rgba(200, 200, 255, 0.28)",
    lineWidth: 2,
  });

  const strokes = ctx.calls.filter((call) => call.type === "stroke");

  assert.equal(
    strokes,
    [
      { type: "stroke", strokeStyle: "rgba(10, 10, 10, 0.08)", lineWidth: 2 },
      { type: "stroke", strokeStyle: "rgba(10, 10, 10, 0.08)", lineWidth: 2 },
      { type: "stroke", strokeStyle: "rgba(200, 200, 255, 0.28)", lineWidth: 2 },
      { type: "stroke", strokeStyle: "rgba(200, 200, 255, 0.28)", lineWidth: 2 },
    ],
    "separate strokes are emitted for minor and emphasis grids",
  );

  const emphasisMoves = ctx.calls.filter(
    (call) => call.type === "moveTo" && (call.x === 16 || call.y === 16),
  );

  assert.ok(
    emphasisMoves.length > 0,
    "grid lines include coordinates aligned with emphasis interval",
  );
});

test("drawGridLines caches repeated geometry when offscreen surfaces are available", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;
  let created = 0;

  class StubOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this._context = createMockContext();
      created += 1;
    }

    getContext(type) {
      if (type !== "2d") return null;

      return this._context;
    }
  }

  globalThis.OffscreenCanvas = StubOffscreenCanvas;

  try {
    const ctx = createMockContext({ withDrawImage: true });

    drawGridLines(ctx, 6, 4, 4);
    drawGridLines(ctx, 6, 4, 4);

    const drawCalls = ctx.calls.filter((call) => call.type === "drawImage");

    assert.equal(drawCalls.length, 2, "each invocation blits the cached surface");
    assert.is(created, 1, "reused surface should avoid allocating multiple canvases");
    assert.not.ok(
      ctx.calls.some((call) => call.type === "moveTo"),
      "cached path should not issue stroke commands on the main context",
    );
  } finally {
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});
