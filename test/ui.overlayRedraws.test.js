import { test, assert } from "#tests/harness";
import UIManager from "../src/ui/uiManager.js";
import { setupDom } from "./helpers/mockDom.js";
import { findCheckboxByLabel } from "./helpers/controlQueries.js";

test("overlay toggles request a redraw while paused", () => {
  const restore = setupDom();

  try {
    let requested = 0;
    const uiManager = new UIManager(
      {
        requestFrame: () => {
          requested += 1;
        },
        onSettingChange() {},
      },
      "#app",
      {},
      {},
    );

    uiManager.setPauseState(true);
    requested = 0;

    const checkbox = findCheckboxByLabel(document.body, "Show Energy Heatmap");

    assert.ok(checkbox, "energy overlay checkbox is rendered");

    checkbox.checked = !checkbox.checked;
    checkbox.trigger("input", { target: checkbox });

    assert.is(requested, 1, "toggling overlays schedules a redraw while paused");
  } finally {
    restore();
  }
});
