import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui playback speed display");

test("playback speed slider displays trimmed values", async () => {
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

    const slider = uiManager.playbackSpeedSlider;

    assert.ok(slider, "playback speed slider should render");

    const valueDisplay = slider?.parentElement?.children?.[1];

    assert.ok(valueDisplay, "slider value display should exist");

    assert.is(
      valueDisplay.textContent,
      "1×",
      "initial speed should display without trailing decimal",
    );

    slider.updateDisplay(2);
    assert.is(
      valueDisplay.textContent,
      "2×",
      "whole numbers should omit decimal places",
    );

    slider.updateDisplay(1.5);
    assert.is(
      valueDisplay.textContent,
      "1.5×",
      "fractional speeds should retain a single decimal place",
    );
  } finally {
    restore();
  }
});
