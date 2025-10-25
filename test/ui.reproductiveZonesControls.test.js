import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findButtonByLabel, findCheckboxByLabel } from "./helpers/controlQueries.js";

const test = suite("ui reproductive zone controls");

test("clear zones button disables patterns and refreshes summary", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const { default: SelectionManager } = await import(
      "../src/grid/selectionManager.js"
    );

    const selectionManager = new SelectionManager(60, 60);

    selectionManager.togglePattern("eastHalf", true);
    selectionManager.togglePattern("cornerPatches", true);

    let frameRequests = 0;
    const uiManager = new UIManager(
      {
        requestFrame: () => {
          frameRequests += 1;
        },
      },
      "#app",
      { selectionManager },
    );

    assert.ok(
      selectionManager.hasActiveZones(),
      "selection manager starts with active zones",
    );

    const clearButton = findButtonByLabel(uiManager.controlsPanel, "Clear Zones");

    assert.ok(clearButton, "clear zones button should render");
    assert.is(clearButton.tagName, "BUTTON");
    assert.is(clearButton.disabled, false, "button enabled while zones active");
    assert.is(
      clearButton.getAttribute("aria-disabled"),
      "false",
      "aria-disabled reflects enabled state",
    );

    const eastCheckbox = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Eastern Hemisphere",
    );
    const cornerCheckbox = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Corner Refuges",
    );

    assert.ok(eastCheckbox?.checked, "east zone checkbox mirrors active state");
    assert.ok(cornerCheckbox?.checked, "corner zone checkbox mirrors active state");

    const initialSummary =
      uiManager.zoneSummaryTextEl?.textContent ?? uiManager.zoneSummaryEl?.textContent;

    assert.match(
      initialSummary,
      /Focused on zones?: Eastern Hemisphere, Corner Refuges/,
      "summary lists active zones",
    );

    clearButton.trigger("click");

    assert.is(selectionManager.hasActiveZones(), false, "all zones cleared");
    assert.is(frameRequests, 1, "clearing zones schedules a render frame");
    assert.is(clearButton.disabled, true, "button disables with no active zones");
    assert.is(
      clearButton.getAttribute("aria-disabled"),
      "true",
      "aria-disabled mirrors disabled state",
    );
    assert.is(eastCheckbox?.checked, false, "east zone checkbox clears");
    assert.is(cornerCheckbox?.checked, false, "corner zone checkbox clears");

    const updatedSummary =
      uiManager.zoneSummaryTextEl?.textContent ?? uiManager.zoneSummaryEl?.textContent;

    assert.is(updatedSummary, "All tiles eligible for reproduction");
  } finally {
    restore();
  }
});

test.run();
