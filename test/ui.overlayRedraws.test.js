import { test, assert } from "#tests/harness";
import UIManager from "../src/ui/uiManager.js";
import { setupDom } from "./helpers/mockDom.js";
import { findCheckboxByLabel } from "./helpers/controlQueries.js";

test("overlay toggles notify simulation and request redraws regardless of pause state", () => {
  const restore = setupDom();

  try {
    const frameStates = [];
    const settingChanges = [];
    let uiManager;
    const simulationCallbacks = {
      requestFrame: () => {
        frameStates.push(uiManager?.isPaused());
      },
      onSettingChange: (key, value) => {
        settingChanges.push([key, value]);
      },
    };

    uiManager = new UIManager(simulationCallbacks, "#app", {}, {});

    uiManager.setPauseState(true);

    const checkbox = findCheckboxByLabel(document.body, "Show Energy Heatmap");

    assert.ok(checkbox, "energy overlay checkbox is rendered");
    assert.is(uiManager.showEnergy, false);

    checkbox.checked = !checkbox.checked;
    checkbox.trigger("input", { target: checkbox });

    assert.equal(
      frameStates,
      [true],
      "pausing and toggling should schedule exactly one redraw",
    );
    assert.is(
      uiManager.showEnergy,
      true,
      "toggling the checkbox should enable the energy overlay",
    );
    assert.equal(settingChanges, [["showEnergy", true]]);

    uiManager.setPauseState(false);

    checkbox.checked = !checkbox.checked;
    checkbox.trigger("input", { target: checkbox });

    assert.equal(
      frameStates,
      [true, false],
      "toggling while running should also request a redraw",
    );
    assert.is(
      uiManager.showEnergy,
      false,
      "second toggle should disable the energy overlay",
    );
    assert.equal(settingChanges, [
      ["showEnergy", true],
      ["showEnergy", false],
    ]);
  } finally {
    restore();
  }
});
