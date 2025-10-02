import { assert, suite } from "#tests/harness";
import { drawLifeEventMarkers } from "../src/ui/overlays.js";

const test = suite("ui overlays: life event markers");

function createRecordingContext() {
  const ops = [];
  let lineWidth = 1;

  return {
    ops,
    save() {
      ops.push({ type: "save" });
    },
    restore() {
      ops.push({ type: "restore" });
    },
    beginPath() {
      ops.push({ type: "beginPath" });
    },
    arc(x, y, radius) {
      ops.push({ type: "arc", x, y, radius });
    },
    moveTo(x, y) {
      ops.push({ type: "moveTo", x, y });
    },
    lineTo(x, y) {
      ops.push({ type: "lineTo", x, y });
    },
    stroke() {
      ops.push({ type: "stroke" });
    },
    fill() {
      ops.push({ type: "fill" });
    },
    set lineWidth(value) {
      lineWidth = value;
      ops.push({ type: "lineWidth", value });
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineJoin(value) {
      ops.push({ type: "lineJoin", value });
    },
    set lineCap(value) {
      ops.push({ type: "lineCap", value });
    },
    set strokeStyle(value) {
      ops.push({ type: "strokeStyle", value });
    },
    set fillStyle(value) {
      ops.push({ type: "fillStyle", value });
    },
    set globalAlpha(value) {
      ops.push({ type: "alpha", value });
    },
    get globalAlpha() {
      return 1;
    },
  };
}

test("drawLifeEventMarkers renders fading rings for births", () => {
  const ctx = createRecordingContext();
  const events = [{ type: "birth", row: 2, col: 3, tick: 10, color: "#abcdef" }];

  drawLifeEventMarkers(ctx, 8, events, { currentTick: 12, fadeTicks: 20 });

  const arcCount = ctx.ops.filter((op) => op.type === "arc").length;

  assert.ok(arcCount >= 2, "birth markers draw ring and core arcs");
  assert.ok(
    ctx.ops.some((op) => op.type === "strokeStyle" && op.value === "#abcdef"),
    "uses the event color for strokes",
  );
  assert.ok(
    ctx.ops.some((op) => op.type === "alpha" && op.value < 1 && op.value > 0),
    "applies per-event alpha fading",
  );
});

test("drawLifeEventMarkers skips events outside the fade window", () => {
  const ctx = createRecordingContext();
  const events = [{ type: "birth", row: 1, col: 1, tick: 4 }];

  drawLifeEventMarkers(ctx, 10, events, { currentTick: 50, fadeTicks: 6 });

  const arcCount = ctx.ops.filter((op) => op.type === "arc").length;
  const moveCount = ctx.ops.filter((op) => op.type === "moveTo").length;

  assert.is(arcCount, 0, "no arcs drawn when markers are stale");
  assert.is(moveCount, 0, "no cross strokes rendered for skipped events");
});

test("drawLifeEventMarkers renders crosses for deaths", () => {
  const ctx = createRecordingContext();
  const events = [{ type: "death", row: 4, col: 2, tick: 100, color: "#ff0000" }];

  drawLifeEventMarkers(ctx, 6, events, { currentTick: 101, fadeTicks: 12 });

  const moveOps = ctx.ops.filter((op) => op.type === "moveTo");
  const lineOps = ctx.ops.filter((op) => op.type === "lineTo");

  assert.ok(moveOps.length >= 2, "death markers draw diagonal segments");
  assert.is(moveOps.length, lineOps.length, "each move has a matching line segment");
});
