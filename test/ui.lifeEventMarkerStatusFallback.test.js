import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui life event marker status fallback");

test("status messaging updates when only text node shims are available", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const simulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
    });

    const { uiManager } = simulation;

    uiManager.lifeEventLimit = 3;
    uiManager.lifeEventFadeTicks = 12;

    const statusStub = {
      dataset: {},
      data: "",
    };

    uiManager.lifeEventMarkerStatus = statusStub;

    uiManager.setShowLifeEventMarkers(true, { notify: false });

    assert.equal(statusStub.dataset.state, "enabled");
    assert.equal(
      statusStub.data,
      "Markers visible. Showing up to 3 markers that fade after 12 ticks.",
      "status fallback should describe enabled markers",
    );

    uiManager.setShowLifeEventMarkers(false, { notify: false });

    assert.equal(statusStub.dataset.state, "disabled");
    assert.equal(
      statusStub.data,
      "Markers hidden. Enable to highlight recent births and deaths on the grid.",
      "status fallback should describe disabled markers",
    );

    simulation.destroy();
  } finally {
    restore();
  }
});

test.run();
