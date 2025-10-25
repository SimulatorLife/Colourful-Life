import { assert, test } from "#tests/harness";

test("headless UI mirrors engine cadence changes", async () => {
  const { createSimulation } = await import("../src/main.js");
  const controller = createSimulation({ headless: true, autoStart: false });

  try {
    assert.is(
      controller.uiManager.getUpdatesPerSecond(),
      controller.engine.state.updatesPerSecond,
    );

    controller.engine.setUpdatesPerSecond(45);

    assert.is(controller.engine.state.updatesPerSecond, 45);
    assert.is(controller.uiManager.getUpdatesPerSecond(), 45);
  } finally {
    controller.destroy();
  }
});
