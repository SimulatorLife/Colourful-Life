import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui obstacle controls");

test("obstacle controls expose preset actions without linger penalty slider", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        obstaclePresets: [
          { id: "none", label: "Clear" },
          { id: "midline", label: "Wall" },
        ],
        getCellSize: () => 5,
      },
      { canvasElement: new MockCanvas(400, 400) },
    );

    assert.is(
      uiManager.lingerPenaltySlider,
      undefined,
      "linger penalty slider should no longer be present",
    );

    const findButton = (node, text) => {
      if (!node || typeof node !== "object") return null;
      if (node.tagName === "BUTTON" && node.textContent === text) return node;
      if (!Array.isArray(node.children)) return null;

      for (const child of node.children) {
        const match = findButton(child, text);

        if (match) return match;
      }

      return null;
    };

    const clearButton = findButton(uiManager.controlsPanel, "Clear Obstacles");

    assert.ok(clearButton, "clear obstacles button should render");
  } finally {
    restore();
  }
});

test("layout preset control reflects current obstacle preset", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const obstaclePresets = [
      { id: "none", label: "Open Field" },
      { id: "midline", label: "Midline Wall" },
    ];

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        obstaclePresets,
        getCellSize: () => 5,
        getCurrentObstaclePreset: () => "midline",
      },
      { canvasElement: new MockCanvas(400, 400) },
    );

    assert.is(
      uiManager.obstaclePreset,
      "midline",
      "UI state should mirror grid preset",
    );

    const findSelect = (node) => {
      if (!node || typeof node !== "object") return null;
      if (node.tagName === "SELECT") return node;
      if (!Array.isArray(node.children)) return null;

      for (const child of node.children) {
        const match = findSelect(child);

        if (match) return match;
      }

      return null;
    };

    const select = findSelect(uiManager.controlsPanel);

    assert.ok(select, "layout preset select should exist");
    assert.is(select.value, "midline", "select value should match active preset");
  } finally {
    restore();
  }
});
