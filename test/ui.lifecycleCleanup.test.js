import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui lifecycle cleanup");

test("createSimulation removes global keydown listener on destroy", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const simulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
    });

    const getKeydownListenerCount = () =>
      Array.isArray(document.eventListeners?.keydown)
        ? document.eventListeners.keydown.length
        : 0;

    assert.is(getKeydownListenerCount(), 1);

    simulation.destroy();

    assert.is(getKeydownListenerCount(), 0);

    const secondSimulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
    });

    assert.is(getKeydownListenerCount(), 1);

    secondSimulation.destroy();
  } finally {
    restore();
  }
});
