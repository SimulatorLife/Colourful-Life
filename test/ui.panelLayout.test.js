import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui panel layout");

test("panels clamp horizontal overflow", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const simulation = createSimulation({
      canvas: new MockCanvas(200, 200),
      autoStart: false,
    });

    const { uiManager } = simulation;
    const panels = [
      uiManager.controlsPanel,
      uiManager.insightsPanel,
      uiManager.lifeEventsPanel,
    ].filter(Boolean);

    assert.ok(panels.length > 0, "expected to collect rendered panels");

    for (const panel of panels) {
      assert.is(
        panel.style.overflowX,
        "hidden",
        "panels should suppress horizontal scrolling",
      );
      assert.is(panel.style.maxWidth, "100%", "panels should respect container width");
    }

    simulation.destroy();
  } finally {
    restore();
  }
});
