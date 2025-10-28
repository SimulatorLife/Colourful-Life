import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";

const test = suite("ui hotkey reference");

test("renders collapsible keyboard shortcut list", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager({}, "#app");

    const controlsPanel = uiManager.controlsPanel;

    assert.ok(controlsPanel, "controls panel should render");

    const hotkeyDetails = controlsPanel.querySelector(".hotkey-reference");

    assert.ok(hotkeyDetails, "hotkey reference card should render");

    const summary = hotkeyDetails.querySelector(".hotkey-reference__summary");

    assert.ok(summary, "summary label should render");
    assert.is(summary.textContent, "Keyboard Shortcuts");

    const hint = hotkeyDetails.querySelector(".hotkey-reference__hint");

    assert.ok(hint, "hint copy should render");

    const list = hotkeyDetails.querySelector(".hotkey-reference__list");

    assert.ok(list, "hotkey list should render");
    assert.ok(Array.isArray(list.children), "list should track child entries");
    assert.ok(list.children.length > 0, "at least one hotkey should be listed");

    const firstItem = list.children[0];

    assert.ok(firstItem, "first hotkey entry should exist");

    const keyLabel = firstItem.querySelector(".hotkey-reference__keys");
    const actionLabel = firstItem.querySelector(".hotkey-reference__action");

    assert.ok(keyLabel, "hotkey entry should include key label");
    assert.ok(actionLabel, "hotkey entry should include action label");
    assert.notEqual(keyLabel.textContent.trim(), "", "keys should not be empty");
    assert.notEqual(
      actionLabel.textContent.trim(),
      "",
      "action label should not be empty",
    );
  } finally {
    restore();
  }
});

test.run();
