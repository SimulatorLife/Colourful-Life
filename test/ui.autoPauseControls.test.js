import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findCheckboxByLabel } from "./helpers/controlQueries.js";

const test = suite("ui auto pause controls");

test("autopause toggle updates pause indicator and notifies listeners", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const settingChanges = [];

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        onSettingChange: (key, value) => {
          settingChanges.push([key, value]);
        },
      },
      "#app",
      {},
      { initialSettings: { autoPauseOnBlur: false } },
    );

    assert.ok(uiManager.pauseOverlay, "pause indicator should render");
    assert.is(uiManager.pauseOverlay.getAttribute("role"), "status");
    assert.is(uiManager.pauseOverlay.getAttribute("aria-live"), "polite");

    uiManager.setPauseState(true);

    assert.ok(uiManager.pauseOverlayAutopause, "autopause hint element should exist");
    assert.is(uiManager.pauseOverlayAutopause.hidden, true);
    assert.is(uiManager.pauseOverlayAutopause.textContent, "");

    const toggle = findCheckboxByLabel(uiManager.controlsPanel, "Pause When Hidden");

    assert.ok(toggle, "autopause checkbox should be discoverable");
    assert.is(toggle.type, "checkbox");
    assert.is(toggle.checked, false);

    const controlRow = toggle.parentElement?.parentElement;

    assert.is(controlRow?.tagName, "LABEL");
    assert.is(
      controlRow?.title,
      "Automatically pause when the tab or window loses focus, resuming on return.",
    );

    toggle.checked = true;
    toggle.trigger("input");

    assert.is(uiManager.autoPauseOnBlur, true);
    assert.is(toggle.checked, true);
    assert.equal(settingChanges, [["autoPauseOnBlur", true]]);
    assert.is(uiManager.pauseOverlayAutopause.hidden, false);
    assert.is(
      uiManager.pauseOverlayAutopause.textContent,
      "Autopause resumes when the tab regains focus.",
    );

    toggle.checked = false;
    toggle.trigger("input");

    assert.is(uiManager.autoPauseOnBlur, false);
    assert.equal(settingChanges, [
      ["autoPauseOnBlur", true],
      ["autoPauseOnBlur", false],
    ]);
    assert.is(uiManager.pauseOverlayAutopause.hidden, true);
    assert.is(uiManager.pauseOverlayAutopause.textContent, "");
  } finally {
    restore();
  }
});

test.run();
