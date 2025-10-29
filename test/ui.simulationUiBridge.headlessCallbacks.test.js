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

test.run();
