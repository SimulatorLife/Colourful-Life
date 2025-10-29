import { assert, test } from "#tests/harness";

test(
  "headless UI manager synchronizes pause state with the engine",
  { concurrency: false },
  async () => {
    const { createSimulation } = await import("../src/main.js");
    const controller = createSimulation({ headless: true, autoStart: false });

    try {
      assert.is(controller.engine.isPaused(), true);
      assert.is(controller.uiManager.isPaused(), true);

      controller.uiManager.setPaused(true);
      await Promise.resolve();
      assert.is(controller.engine.isPaused(), true);
      assert.is(controller.uiManager.isPaused(), true);

      controller.uiManager.setPaused(false);
      await Promise.resolve();
      assert.is(controller.engine.isPaused(), false);
      assert.is(controller.uiManager.isPaused(), false);

      controller.engine.pause();
      assert.is(controller.uiManager.isPaused(), true);

      controller.engine.resume();
      assert.is(controller.uiManager.isPaused(), false);

      controller.uiManager.togglePause();
      await Promise.resolve();
      assert.is(controller.engine.isPaused(), true);
    } finally {
      controller.destroy();
    }
  },
);
