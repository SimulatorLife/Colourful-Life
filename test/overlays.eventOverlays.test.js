import { assert, suite } from "#tests/harness";
import { drawEventOverlays } from "../src/ui/overlays.js";

const test = suite("ui overlays: event overlays");

function createMockContext() {
  const calls = [];
  let fillStyle = null;

  return {
    get calls() {
      return calls;
    },
    get fillStyle() {
      return fillStyle;
    },
    set fillStyle(value) {
      fillStyle = value;
      calls.push({ type: "setFillStyle", value });
    },
    save() {
      calls.push({ type: "save" });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    fillRect(x, y, width, height) {
      calls.push({
        type: "fillRect",
        x,
        y,
        width,
        height,
        fillStyle,
      });
    },
  };
}

test("drawEventOverlays renders active rectangles using event colors", () => {
  const ctx = createMockContext();
  const events = [
    {
      color: "rgba(10,20,30,0.4)",
      affectedArea: { x: 1, y: 2, width: 2, height: 1 },
    },
    {
      affectedArea: { x: 0, y: 0, width: 1, height: 3 },
    },
    null,
    {
      color: "rgba(200,200,255,0.5)",
    },
  ];

  drawEventOverlays(ctx, 5, events);

  assert.equal(ctx.calls, [
    { type: "save" },
    { type: "setFillStyle", value: "rgba(10,20,30,0.4)" },
    {
      type: "fillRect",
      x: 5,
      y: 10,
      width: 10,
      height: 5,
      fillStyle: "rgba(10,20,30,0.4)",
    },
    { type: "setFillStyle", value: "rgba(255,255,255,0.15)" },
    {
      type: "fillRect",
      x: 0,
      y: 0,
      width: 5,
      height: 15,
      fillStyle: "rgba(255,255,255,0.15)",
    },
    { type: "restore" },
  ]);
});

test("drawEventOverlays consults getColor override with fallbacks", () => {
  const ctx = createMockContext();
  const events = [
    {
      color: "rgba(20,30,40,0.5)",
      affectedArea: { x: 0, y: 0, width: 1, height: 1 },
    },
    {
      color: "rgba(5,10,15,0.2)",
      affectedArea: { x: 1, y: 1, width: 2, height: 2 },
    },
    {
      affectedArea: { x: 2, y: 0, width: 1, height: 1 },
    },
  ];
  const warnings = [];
  const originalWarn = console.warn;

  console.warn = (...args) => warnings.push(args);

  let invocation = 0;
  const colors = ["hotpink", "", null];

  try {
    drawEventOverlays(ctx, 4, events, () => {
      invocation++;

      if (invocation === 3) {
        throw new Error("resolver failed");
      }

      return colors[invocation - 1];
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.is(invocation, 3, "override invoked for each event");
  assert.is(warnings.length, 1, "warning logged once when override throws");
  assert.match(warnings[0][0], /Failed to resolve event overlay color/);
  assert.equal(
    ctx.calls.filter((call) => call.type === "fillRect"),
    [
      { type: "fillRect", x: 0, y: 0, width: 4, height: 4, fillStyle: "hotpink" },
      {
        type: "fillRect",
        x: 4,
        y: 4,
        width: 8,
        height: 8,
        fillStyle: "rgba(5,10,15,0.2)",
      },
      {
        type: "fillRect",
        x: 8,
        y: 0,
        width: 4,
        height: 4,
        fillStyle: "rgba(255,255,255,0.15)",
      },
    ],
  );
});

test("drawEventOverlays skips rendering when no context or events are provided", () => {
  const ctx = createMockContext();

  drawEventOverlays(null, 4, [{ affectedArea: { x: 0, y: 0, width: 1, height: 1 } }]);
  drawEventOverlays(ctx, 4, null);
  drawEventOverlays(ctx, 4, []);

  assert.equal(ctx.calls, []);
});
