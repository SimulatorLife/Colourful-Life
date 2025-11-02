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
  const { default: SimulationEngine } = await import(
    "../src/engine/simulationEngine.js"
  );

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
