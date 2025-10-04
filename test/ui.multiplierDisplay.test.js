import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui multiplier display");

test("multiplier sliders include the multiplication suffix", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(600, 600) },
    );

    const slider = findSliderByLabel(uiManager.controlsPanel, "Event Strength ×");

    assert.ok(slider, "event strength slider should render");

    const valueDisplay = slider?.parentElement?.children?.[1];

    assert.ok(valueDisplay, "slider display element should exist");
    assert.is(
      valueDisplay.textContent,
      "1×",
      "initial multiplier should display with suffix",
    );

    slider.updateDisplay(1.75);
    assert.is(
      valueDisplay.textContent,
      "1.75×",
      "fractional multipliers should retain significant decimals with suffix",
    );

    slider.updateDisplay(2);
    assert.is(
      valueDisplay.textContent,
      "2×",
      "whole multipliers should trim trailing zeros",
    );
  } finally {
    restore();
  }
});
