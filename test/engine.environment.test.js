import { assert, test } from "#tests/harness";
import {
  buildHeadlessCanvasOverrides,
  createHeadlessCanvas,
  resolveCanvas,
  resolveHeadlessCanvasSize,
  resolveTimingProviders,
} from "../src/engine/environment.js";
import { drawAuroraVeil, drawLifeEventMarkers } from "../src/ui/overlays.js";

test("resolveCanvas returns explicit canvas when supplied", () => {
  const explicitCanvas = { id: "preferred" };

  const result = resolveCanvas(explicitCanvas, {
    getElementById() {
      throw new Error("should not look up canvas when explicit value exists");
    },
  });

  assert.is(result, explicitCanvas);
});

test("resolveCanvas locates default canvas on provided document", () => {
  const fallbackCanvas = { id: "gameCanvas" };
  const documentRef = {
    getElementById(id) {
      this.calls = (this.calls ?? 0) + 1;

      return id === "gameCanvas" ? fallbackCanvas : null;
    },
  };

  const result = resolveCanvas(null, documentRef);

  assert.is(result, fallbackCanvas);
  assert.is(documentRef.calls, 1);
});

test("resolveCanvas returns null when no lookup strategy succeeds", () => {
  const result = resolveCanvas(null, {});

  assert.is(result, null);
});

test("resolveTimingProviders prioritizes explicit overrides", () => {
  const now = () => 42;
  const rafHandles = [];
  const raf = (cb) => {
    rafHandles.push(cb);

    return 7;
  };
  const cafHandles = [];
  const caf = (handle) => cafHandles.push(handle);

  const providers = resolveTimingProviders({
    performanceNow: now,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
  });

  assert.is(providers.now(), 42);
  assert.is(providers.raf, raf);
  assert.is(providers.caf, caf);

  const handle = providers.raf(() => {});

  assert.is(handle, 7);
  providers.caf(handle);
  assert.equal(cafHandles, [7]);
});

test("resolveTimingProviders binds window methods to preserve context", () => {
  const window = {
    requestAnimationFrame(callback) {
      this.lastCallback = callback;

      return 13;
    },
    cancelAnimationFrame(handle) {
      this.cancelled = handle;
    },
    performance: {
      now() {
        this.calls = (this.calls ?? 0) + 1;

        return 99;
      },
    },
  };

  const providers = resolveTimingProviders({ window });

  assert.is(providers.now(), 99);
  assert.is(window.performance.calls, 1);

  const handle = providers.raf(() => {});

  assert.is(handle, 13);
  assert.is(window.lastCallback != null, true);

  providers.caf(handle);
  assert.is(window.cancelled, 13);
});

test("resolveTimingProviders falls back to timeout-based scheduling when unavailable", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];

  let handleCounter = 0;

  globalThis.setTimeout = (fn, delay) => {
    scheduled.push({ fn, delay });
    handleCounter += 1;

    return handleCounter;
  };
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle);
  };

  try {
    const providers = resolveTimingProviders();

    const nowValue = providers.now();

    assert.type(nowValue, "number");

    const handle = providers.raf((timestamp) => {
      scheduled[0].timestamp = timestamp;
    });

    assert.is(handle, 1);
    assert.equal(
      scheduled.map((entry) => entry.delay),
      [16],
    );

    scheduled[0].fn();
    assert.type(scheduled[0].timestamp, "number");

    providers.caf(handle);
    assert.equal(cleared, [1]);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("resolveHeadlessCanvasSize falls back to default grid dimensions when overrides missing", () => {
  const result = resolveHeadlessCanvasSize();

  assert.equal(result, { width: 600, height: 600 });
});

test("resolveHeadlessCanvasSize derives size from rows/cols when overrides invalid", () => {
  const result = resolveHeadlessCanvasSize({
    width: -200,
    canvasWidth: "0",
    canvasSize: { width: null },
    height: undefined,
    canvasHeight: "",
    cols: "48",
    rows: 36,
    cellSize: 3,
  });

  assert.equal(result, { width: 144, height: 108 });
});

test("resolveHeadlessCanvasSize defaults cell size when provided value is non-positive", () => {
  const result = resolveHeadlessCanvasSize({
    cols: 10,
    rows: "5",
    cellSize: 0,
  });

  assert.equal(result, { width: 50, height: 25 });
});

test("resolveHeadlessCanvasSize applies layout overrides", () => {
  const result = resolveHeadlessCanvasSize({
    rows: 50,
    cols: 70,
    cellSize: 4,
    canvasSize: { width: 600 },
    height: 420,
  });

  assert.equal(result, { width: 600, height: 420 });
});

test("buildHeadlessCanvasOverrides merges derived dimensions into config", () => {
  const overrides = buildHeadlessCanvasOverrides(
    { canvasSize: { width: 200 } },
    { width: 320, height: 180 },
  );

  assert.equal(overrides, {
    canvasSize: { width: 320, height: 180 },
    width: 320,
    canvasWidth: 320,
    height: 180,
    canvasHeight: 180,
  });
});

test("buildHeadlessCanvasOverrides returns null when no positive dimensions", () => {
  const overrides = buildHeadlessCanvasOverrides(
    { canvasSize: {} },
    { width: 0, height: -5 },
  );

  assert.is(overrides, null);
});

test("createHeadlessCanvas returns stub context", () => {
  const canvas = createHeadlessCanvas({ width: 300, height: 150 });
  const context = canvas.getContext("2d");

  assert.equal(
    Object.keys(context).sort(),
    [
      "arc",
      "beginPath",
      "canvas",
      "clearRect",
      "closePath",
      "createLinearGradient",
      "drawImage",
      "fill",
      "fillRect",
      "fillStyle",
      "fillText",
      "font",
      "imageSmoothingEnabled",
      "lineTo",
      "lineWidth",
      "moveTo",
      "resetTransform",
      "restore",
      "save",
      "scale",
      "setTransform",
      "stroke",
      "strokeRect",
      "strokeStyle",
      "strokeText",
      "textAlign",
      "textBaseline",
      "translate",
    ].sort(),
  );
  assert.is(canvas.width, 300);
  assert.is(canvas.height, 150);
});

test("createHeadlessCanvas stub tolerates overlay rendering helpers", () => {
  const canvas = createHeadlessCanvas({ width: 200, height: 120 });
  const ctx = canvas.getContext("2d");

  assert.not.throws(() => {
    drawAuroraVeil(ctx, 6, 10, 10, { tick: 12 });
  });

  assert.not.throws(() => {
    drawLifeEventMarkers(
      ctx,
      6,
      [
        {
          type: "death",
          row: 2,
          col: 3,
          tick: 4,
        },
      ],
      {
        currentTick: 6,
        fadeTicks: 12,
      },
    );
  });
});
