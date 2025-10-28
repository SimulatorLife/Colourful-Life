import { assert, suite } from "#tests/harness";
import { drawLifeEventMarkers } from "../src/ui/overlays.js";

const test = suite("ui overlays: life event markers");

function createRecordingContext() {
  const ops = [];
  let lineWidth = 1;
  let strokeStyle = null;
  let fillStyle = null;

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
      ops.push({ type: "stroke", color: strokeStyle });
    },
    fill() {
      ops.push({ type: "fill", color: fillStyle });
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
      strokeStyle = value;
      ops.push({ type: "strokeStyle", value });
    },
    set fillStyle(value) {
      fillStyle = value;
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

test("drawLifeEventMarkers respects custom color overrides", () => {
  const ctx = createRecordingContext();
  const events = [
    { type: "birth", row: 0, col: 0, tick: 1 },
    { type: "death", row: 1, col: 1, tick: 1 },
  ];

  drawLifeEventMarkers(ctx, 10, events, {
    currentTick: 2,
    colors: { birth: "#112233", death: "#445566" },
  });

  const strokeStyles = ctx.ops
    .filter((op) => op.type === "strokeStyle")
    .map((op) => op.value);
  const fillStyles = ctx.ops
    .filter((op) => op.type === "fillStyle")
    .map((op) => op.value);

  assert.ok(
    strokeStyles.includes("#445566"),
    "death marker uses custom stroke color override",
  );
  assert.ok(
    strokeStyles.includes("#112233") || fillStyles.includes("#112233"),
    "birth marker applies custom color override",
  );
});

test("drawLifeEventMarkers keeps birth fills within the outer ring for tiny cells", () => {
  const ctx = createRecordingContext();
  const events = [{ type: "birth", row: 1, col: 1, tick: 5 }];

  drawLifeEventMarkers(ctx, 2, events, { currentTick: 5, fadeTicks: 20 });

  const arcs = ctx.ops.filter((op) => op.type === "arc");

  assert.ok(arcs.length >= 2, "birth marker should render outer and inner arcs");

  const [outer, inner] = arcs;

  assert.ok(
    inner.radius <= outer.radius,
    "inner birth marker circle should not exceed outer ring radius",
  );
  assert.ok(inner.radius > 0, "inner birth marker radius should stay positive");
});

test("drawLifeEventMarkers draws newest markers last to preserve visibility", () => {
  const ctx = createRecordingContext();
  const events = [
    { type: "birth", row: 0, col: 0, tick: 110, color: "#00ff00" },
    { type: "birth", row: 0, col: 0, tick: 90, color: "#ff00ff" },
  ];

  // Stats#getRecentLifeEvents emits newest entries first. Ensure layering keeps
  // the freshest marker on top of older strokes.
  drawLifeEventMarkers(ctx, 8, events, { currentTick: 120, fadeTicks: 200 });

  const strokeOrder = ctx.ops
    .filter((op) => op.type === "stroke")
    .slice(0, events.length)
    .map((op) => op.color);

  assert.equal(
    strokeOrder,
    ["#ff00ff", "#00ff00"],
    "older markers render first so newer ones remain visible",
  );
});

test("drawLifeEventMarkers falls back to default limit when provided invalid input", () => {
  const ctx = createRecordingContext();
  const events = [
    { type: "birth", row: 0, col: 0, tick: 1, color: "#111111" },
    { type: "birth", row: 1, col: 1, tick: 2, color: "#222222" },
  ];

  drawLifeEventMarkers(ctx, 10, events, {
    currentTick: 3,
    fadeTicks: 50,
    limit: "not-a-number",
  });

  const strokeCount = ctx.ops.filter((op) => op.type === "stroke").length;

  assert.ok(strokeCount > 0, "invalid limit still renders the available markers");
});

test("drawLifeEventMarkers tolerates contexts without save/restore helpers", () => {
  const ctx = {
    ops: [],
    beginPath() {
      this.ops.push({ type: "beginPath" });
    },
    arc(x, y, radius) {
      this.ops.push({ type: "arc", x, y, radius });
    },
    moveTo(x, y) {
      this.ops.push({ type: "moveTo", x, y });
    },
    lineTo(x, y) {
      this.ops.push({ type: "lineTo", x, y });
    },
    stroke() {
      this.ops.push({ type: "stroke" });
    },
    fill() {
      this.ops.push({ type: "fill" });
    },
    fillRect(x, y, width, height) {
      this.ops.push({ type: "fillRect", x, y, width, height });
    },
    fillText(text, x, y) {
      this.ops.push({ type: "fillText", text, x, y });
    },
    measureText() {
      return { width: 0 };
    },
    set lineWidth(value) {
      this.ops.push({ type: "lineWidth", value });
    },
    get lineWidth() {
      return 1;
    },
    set lineJoin(value) {
      this.ops.push({ type: "lineJoin", value });
    },
    set lineCap(value) {
      this.ops.push({ type: "lineCap", value });
    },
    set strokeStyle(value) {
      this.ops.push({ type: "strokeStyle", value });
    },
    set fillStyle(value) {
      this.ops.push({ type: "fillStyle", value });
    },
    set globalAlpha(value) {
      this.ops.push({ type: "alpha", value });
    },
    get globalAlpha() {
      return 1;
    },
  };

  const events = [{ type: "birth", row: 0, col: 0, tick: 5, color: "#abcdef" }];

  assert.not.throws(() => {
    drawLifeEventMarkers(ctx, 12, events, { currentTick: 5, fadeTicks: 10 });
  });

  assert.ok(
    ctx.ops.some((op) => op.type === "fillRect"),
    "legend background renders without relying on save/restore",
  );
});
