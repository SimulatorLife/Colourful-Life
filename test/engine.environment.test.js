import { assert, test } from "#tests/harness";
import { resolveCanvas, resolveTimingProviders } from "../src/engine/environment.js";

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
