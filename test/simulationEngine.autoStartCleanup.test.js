import { assert, test } from "#tests/harness";
import { MockCanvas } from "./helpers/simulationEngine.js";

function createEventRecorder(additionalProps = {}) {
  const listeners = new Map();
  let additions = 0;

  return {
    listeners,
    target: {
      addEventListener(type, handler) {
        if (!listeners.has(type)) {
          listeners.set(type, new Set());
        }

        listeners.get(type).add(handler);
        additions += 1;
      },
      removeEventListener(type, handler) {
        const bucket = listeners.get(type);

        if (!bucket) return;

        bucket.delete(handler);
        if (bucket.size === 0) {
          listeners.delete(type);
        }
      },
      ...additionalProps,
    },
    count(type) {
      const bucket = listeners.get(type);

      return bucket ? bucket.size : 0;
    },
    total() {
      let total = 0;

      for (const bucket of listeners.values()) {
        total += bucket.size;
      }

      return total;
    },
    additions() {
      return additions;
    },
  };
}

test("SimulationEngine cleans up global listeners when autoStart fails", async () => {
  const { default: SimulationEngine } =
    await import("../src/engine/simulationEngine.js");

  const windowRecorder = createEventRecorder({ devicePixelRatio: 1 });
  const documentRecorder = createEventRecorder({
    visibilityState: "visible",
    hidden: false,
  });
  const canvas = new MockCanvas(40, 40);
  let rafCalls = 0;

  const failingRaf = () => {
    rafCalls += 1;
    throw new Error("raf failure");
  };

  try {
    new SimulationEngine({
      canvas,
      window: windowRecorder.target,
      document: documentRecorder.target,
      requestAnimationFrame: failingRaf,
      cancelAnimationFrame: () => {},
    });
    assert.unreachable(
      "SimulationEngine should throw when requestAnimationFrame fails",
    );
  } catch (error) {
    assert.match(error?.message ?? "", "raf failure");
  }

  assert.is(rafCalls, 1, "requestAnimationFrame stub should be invoked once");
  assert.ok(
    windowRecorder.additions() > 0,
    "window listeners should be registered before cleanup",
  );
  assert.ok(
    documentRecorder.additions() > 0,
    "document listeners should be registered before cleanup",
  );
  assert.is(
    windowRecorder.total(),
    0,
    "window listeners should be removed after failure",
  );
  assert.is(
    documentRecorder.total(),
    0,
    "document listeners should be removed after failure",
  );
});

function createFailingWindowRecorder(throwOnType) {
  const listeners = new Map();

  const target = {
    devicePixelRatio: 1,
    addEventListener(type, handler) {
      if (type === throwOnType && target.addEventListener === failingAdd) {
        throw new Error(`${type} listener registration failed`);
      }

      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }

      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      const bucket = listeners.get(type);

      if (!bucket) return;

      bucket.delete(handler);
      if (bucket.size === 0) {
        listeners.delete(type);
      }
    },
  };

  const failingAdd = target.addEventListener;

  return {
    target,
    total() {
      let total = 0;

      for (const bucket of listeners.values()) {
        total += bucket.size;
      }

      return total;
    },
  };
}

test("Auto pause handlers roll back partial listener registration on failure", async () => {
  const { default: SimulationEngine } =
    await import("../src/engine/simulationEngine.js");

  // Throw on the third registration ("focus") so two listeners are already
  // attached to the window and one to the document before the failure occurs.
  const windowRecorder = createFailingWindowRecorder("focus");
  const documentRecorder = createEventRecorder({
    visibilityState: "visible",
    hidden: false,
  });
  const canvas = new MockCanvas(40, 40);

  let thrown = null;

  try {
    new SimulationEngine({
      canvas,
      window: windowRecorder.target,
      document: documentRecorder.target,
      cancelAnimationFrame: () => {},
    });
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown, "SimulationEngine should throw when listener registration fails");
  assert.match(thrown?.message ?? "", "focus listener registration failed");
  assert.is(
    windowRecorder.total(),
    0,
    "window listeners registered before the failure should be rolled back",
  );
  assert.is(
    documentRecorder.total(),
    0,
    "document listeners registered before the failure should be rolled back",
  );
});
