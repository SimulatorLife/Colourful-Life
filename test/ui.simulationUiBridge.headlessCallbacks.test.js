import { assert, suite } from "#tests/harness";

const test = suite("ui simulation ui bridge headless callbacks");

test("headless bridge forwards update rate changes to simulation callbacks", async () => {
  const { bindSimulationToUi } = await import("../src/ui/simulationUiBridge.js");

  const observed = [];
  const engineStub = {
    setUpdatesPerSecond(value) {
      observed.push(["engine", value]);
    },
  };

  const { uiManager } = bindSimulationToUi({
    engine: engineStub,
    headless: true,
    simulationCallbacks: {
      onSettingChange(key, value) {
        observed.push(["callback", key, value]);
      },
    },
  });

  uiManager.setUpdatesPerSecond(144);

  assert.equal(observed, [
    ["engine", 144],
    ["callback", "updatesPerSecond", 144],
  ]);
});

test("headless bridge ignores engine-driven max concurrent syncs", async () => {
  const { bindSimulationToUi } = await import("../src/ui/simulationUiBridge.js");

  const observed = [];
  const stateHandlers = [];
  const engineStub = {
    state: { maxConcurrentEvents: 3 },
    on(eventName, handler) {
      if (eventName === "state") {
        stateHandlers.push(handler);
      }

      return () => {};
    },
  };

  const { uiManager } = bindSimulationToUi({
    engine: engineStub,
    headless: true,
    simulationCallbacks: {
      onSettingChange(key, value) {
        observed.push([key, value]);
      },
    },
  });

  assert.equal(observed, []);

  stateHandlers.forEach((handler) => handler({ changes: { maxConcurrentEvents: 5 } }));

  assert.equal(observed, []);
  assert.is(uiManager.getMaxConcurrentEvents(), 5);
});

test.run();
