import { test, assert } from "#tests/harness";
import UIManager from "../src/ui/uiManager.js";
import { setupDom } from "./helpers/mockDom.js";

function traverse(node, predicate) {
  if (!node) return null;
  if (predicate(node)) return node;
  if (!Array.isArray(node.children)) return null;

  for (const child of node.children) {
    const match = traverse(child, predicate);

    if (match) return match;
  }

  return null;
}

function findCheckboxByLabel(root, labelText) {
  const labelSpan = traverse(root, (node) => {
    return (
      node &&
      node.tagName === "SPAN" &&
      typeof node.textContent === "string" &&
      node.textContent.trim() === labelText
    );
  });

  if (!labelSpan) return null;

  let current = labelSpan;

  while (current && current.tagName !== "LABEL") {
    current = current.parentElement;
  }

  if (!current) return null;

  return traverse(
    current,
    (node) => node?.tagName === "INPUT" && node.type === "checkbox",
  );
}

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
