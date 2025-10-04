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
    const expectedDescription =
      "Automatically pause the simulation when the tab or window loses focus, resuming when you return.";

    assert.is(controlRow?.title, expectedDescription);

    const descriptionEl = controlRow?.querySelector(".control-checkbox-description");

    if (descriptionEl) {
      assert.is(descriptionEl.textContent, expectedDescription);
    }

    toggle.checked = true;
    toggle.trigger("input");

    assert.is(uiManager.autoPauseOnBlur, true);
    assert.is(toggle.checked, true);
    assert.equal(settingChanges, [["autoPauseOnBlur", true]]);
    assert.is(
      uiManager.pauseOverlayAutopause.hidden,
      true,
      "autopause hint stays hidden until an auto pause occurs",
    );
    assert.is(uiManager.pauseOverlayAutopause.textContent, "");

    uiManager.setAutoPausePending(true);

    assert.is(uiManager.pauseOverlayAutopause.hidden, false);
    assert.is(
      uiManager.pauseOverlayAutopause.textContent,
      "Autopause resumes when the tab regains focus.",
    );

    uiManager.setAutoPausePending(false);
    assert.is(
      uiManager.pauseOverlayAutopause.hidden,
      true,
      "clearing autopause pending hides the hint",
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

test("setAutoPauseOnBlur sanitizes string inputs", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      { requestFrame: () => {} },
      "#app",
      {},
      { initialSettings: { autoPauseOnBlur: false } },
    );

    uiManager.setPauseState(true);
    uiManager.setAutoPauseOnBlur("true");

    assert.is(uiManager.autoPauseOnBlur, true, "string 'true' enables auto pause");
    assert.is(uiManager.autoPauseCheckbox?.checked, true);
    assert.is(uiManager.pauseOverlayAutopause?.hidden, true);

    uiManager.setAutoPausePending(true);
    assert.is(uiManager.pauseOverlayAutopause?.hidden, false);
    uiManager.setAutoPausePending(false);

    uiManager.setAutoPauseOnBlur("false");
    assert.is(uiManager.autoPauseOnBlur, false, "string 'false' disables auto pause");
    assert.is(uiManager.autoPauseCheckbox?.checked, false);
    assert.is(uiManager.pauseOverlayAutopause?.hidden, true);

    uiManager.setAutoPauseOnBlur("1");
    assert.is(uiManager.autoPauseOnBlur, true, "numeric string '1' enables auto pause");

    uiManager.setAutoPauseOnBlur("0");
    assert.is(
      uiManager.autoPauseOnBlur,
      false,
      "numeric string '0' disables auto pause",
    );
  } finally {
    restore();
  }
});

test.run();
