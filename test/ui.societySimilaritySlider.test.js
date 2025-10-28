import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui society similarity slider");

test("ally similarity slider exposes thresholds and notifies updates", async () => {
  const restore = setupDom();

  try {
    const changes = [];
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: (key, value) => {
          changes.push([key, value]);
        },
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(600, 600) },
    );

    const slider = findSliderByLabel(uiManager.controlsPanel, "Ally Similarity ≥");

    assert.ok(slider, "ally similarity slider should render");
    assert.is(slider.min, "0", "slider should start at 0");
    assert.is(slider.max, "1", "slider should cap at 1");
    assert.is(slider.step, "0.01", "slider should move in hundredths");
    assert.is(
      slider.value,
      "0.7",
      "slider should reflect the default similarity threshold",
    );

    const sliderRow = slider.closest("label");

    assert.is(
      sliderRow?.title,
      "Minimum genetic similarity to consider another cell an ally (0..1)",
      "slider should expose the descriptive tooltip",
    );

    const display = slider.parentElement?.children?.[1];

    assert.ok(display, "slider value display should render");
    assert.is(
      display.textContent,
      "0.70",
      "display should show the formatted default value",
    );

    const baselineChanges = changes.length;

    slider.value = "0.58";
    slider.trigger("input");

    assert.is(
      uiManager.getSocietySimilarity(),
      0.58,
      "ui manager should store the updated similarity threshold",
    );
    assert.is(display.textContent, "0.58", "display should update the formatted value");

    const recentChanges = changes.slice(baselineChanges);

    assert.ok(
      recentChanges.some(
        ([key, value]) => key === "societySimilarity" && value === 0.58,
      ),
      "onSettingChange should be invoked with the new value",
    );
  } finally {
    restore();
  }
});
