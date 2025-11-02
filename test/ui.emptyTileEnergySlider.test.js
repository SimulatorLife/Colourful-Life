import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui empty tile energy slider");

test("slider displays percentages, clamps input, and notifies changes", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const notifications = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: (key, value) => {
          notifications.push([key, value]);
        },
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(600, 600) },
    );

    notifications.length = 0;

    const slider = findSliderByLabel(uiManager.controlsPanel, "Empty Tile Energy");

    assert.ok(slider, "empty tile energy slider should render");
    assert.is(slider.type, "range", "slider input should be a range control");

    const labelRow = slider.closest ? slider.closest("label") : null;

    assert.ok(
      labelRow,
      "slider should be wrapped in a label for accessible association",
    );
    assert.is(
      labelRow?.title,
      "Fraction of the energy cap applied to empty tiles during resets and world refreshes (0..1)",
      "slider tooltip should describe empty tile energy behaviour",
    );

    const valueDisplay = slider.parentElement?.children?.[1];

    assert.ok(valueDisplay, "slider should render a live value display");
    assert.is(
      valueDisplay.textContent,
      "50%",
      "default empty tile energy should display as a percentage",
    );

    slider.value = "0.8";
    slider.trigger("input");

    assert.is(
      uiManager.getInitialTileEnergyFraction(),
      0.8,
      "UI manager should store sanitized slider values",
    );
    assert.is(
      valueDisplay.textContent,
      "80%",
      "value display should reflect the sanitized slider value",
    );

    assert.deepEqual(
      notifications,
      [["initialTileEnergyFraction", 0.8]],
      "slider input should notify listeners with the sanitized value",
    );

    uiManager.setInitialTileEnergyFraction(1.6);

    assert.is(
      uiManager.getInitialTileEnergyFraction(),
      1,
      "direct setter should clamp values above the unit interval",
    );
    assert.is(
      valueDisplay.textContent,
      "100%",
      "clamped values should update the slider display",
    );

    assert.deepEqual(
      notifications,
      [
        ["initialTileEnergyFraction", 0.8],
        ["initialTileEnergyFraction", 1],
      ],
      "notifications should include the clamped follow-up update",
    );
  } finally {
    restore();
  }
});
