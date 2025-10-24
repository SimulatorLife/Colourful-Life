import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui speed preset controls");

test("speed preset buttons sync playback speed and aria state", async () => {
  const restore = setupDom();

  try {
    const settingChanges = [];
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: (key, value) => {
          settingChanges.push([key, value]);
        },
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(800, 600) },
    );

    const slider = uiManager.playbackSpeedSlider;

    assert.ok(slider, "playback speed slider should render");

    const valueDisplay = slider?.parentElement?.children?.[1];

    assert.ok(valueDisplay, "slider value display should exist");

    const presets = Array.isArray(uiManager.speedPresetButtons)
      ? uiManager.speedPresetButtons
      : [];

    assert.is(presets.length, 4, "expected four playback speed presets");

    const presetGroup = presets[0]?.button?.parentElement ?? null;

    assert.is(presetGroup?.getAttribute("role"), "group");
    assert.is(presetGroup?.getAttribute("aria-label"), "Playback speed presets");

    const findPresetButton = (value) =>
      presets.find((entry) => entry.value === value)?.button ?? null;

    const oneXButton = findPresetButton(1);
    const twoXButton = findPresetButton(2);
    const fourXButton = findPresetButton(4);

    assert.ok(oneXButton, "1× preset button should exist");
    assert.ok(twoXButton, "2× preset button should exist");
    assert.ok(fourXButton, "4× preset button should exist");

    assert.is(slider.value, "1");
    assert.is(valueDisplay.textContent, "1×");
    assert.is(oneXButton.getAttribute("aria-pressed"), "true");
    assert.ok(oneXButton.classList.contains("active"));

    twoXButton.trigger("click");

    assert.equal(settingChanges, [["speedMultiplier", 2]]);
    assert.is(uiManager.speedMultiplier, 2);
    assert.is(slider.value, "2");
    assert.is(valueDisplay.textContent, "2×");
    assert.is(twoXButton.getAttribute("aria-pressed"), "true");
    assert.ok(twoXButton.classList.contains("active"));
    assert.is(oneXButton.getAttribute("aria-pressed"), "false");
    assert.is(oneXButton.classList.contains("active"), false);

    slider.value = "3.99";
    slider.trigger("input");

    assert.equal(settingChanges, [
      ["speedMultiplier", 2],
      ["speedMultiplier", 3.99],
    ]);
    assert.is(uiManager.speedMultiplier, 3.99);
    assert.is(slider.value, "3.99");
    assert.is(valueDisplay.textContent, "4×");
    assert.is(fourXButton.getAttribute("aria-pressed"), "true");
    assert.ok(fourXButton.classList.contains("active"));

    presets
      .filter((entry) => entry.value !== 4)
      .forEach(({ button }) => {
        assert.is(button.getAttribute("aria-pressed"), "false");
      });
  } finally {
    restore();
  }
});

test.run();
