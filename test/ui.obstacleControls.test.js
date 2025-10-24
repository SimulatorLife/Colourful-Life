import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findSelectByLabel } from "./helpers/controlQueries.js";

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

    const select = findSelectByLabel(uiManager.controlsPanel, "Layout Preset");

    assert.ok(select, "layout preset select should exist");
    assert.is(select.value, "midline", "select value should match active preset");
  } finally {
    restore();
  }
});
test("clearing obstacles resets preset select to open field", async () => {
  const restore = setupDom();

  try {
    const [{ default: UIManager }, { OBSTACLE_PRESETS }] = await Promise.all([
      import("../src/ui/uiManager.js"),
      import("../src/grid/obstaclePresets.js"),
    ]);

    const applyCalls = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        applyObstaclePreset: (...args) => {
          applyCalls.push(args);
        },
        obstaclePresets: OBSTACLE_PRESETS,
        selectionManager: {
          getPatterns: () => [],
          togglePattern: () => {},
          getActiveZones: () => [],
          hasActiveZones: () => false,
        },
      },
      { canvasElement: new MockCanvas(200, 200) },
    );

    const findButtonByText = (root, text) => {
      const queue = [root];

      while (queue.length > 0) {
        const node = queue.shift();

        if (!node) continue;
        if (node.tagName === "BUTTON" && node.textContent === text) return node;
        if (Array.isArray(node.children)) queue.push(...node.children);
      }

      return null;
    };

    const presetSelect = findSelectByLabel(uiManager.controlsPanel, "Layout Preset");

    assert.ok(presetSelect, "obstacle preset dropdown should exist");

    presetSelect.value = "sealed-quadrants";
    presetSelect.dispatchEvent({ type: "change" });
    assert.is(uiManager.obstaclePreset, "sealed-quadrants");
    assert.ok(
      applyCalls.some(([id]) => id === "sealed-quadrants"),
      "changing the preset should immediately apply the layout",
    );

    const clearButton = findButtonByText(uiManager.controlsPanel, "Clear Obstacles");

    assert.ok(clearButton, "clear obstacles button should exist");

    clearButton.dispatchEvent({ type: "click" });

    assert.is(uiManager.obstaclePreset, "none");
    assert.is(presetSelect.value, "none");
    assert.ok(
      applyCalls.some(([id]) => id === "none"),
      "applyObstaclePreset should be called with the cleared preset",
    );
  } finally {
    restore();
  }
});

test("shuffle layout button applies a random preset", async () => {
  const restore = setupDom();

  try {
    const [{ default: UIManager }, { OBSTACLE_PRESETS }] = await Promise.all([
      import("../src/ui/uiManager.js"),
      import("../src/grid/obstaclePresets.js"),
    ]);

    const applyCalls = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        applyObstaclePreset: (...args) => {
          applyCalls.push(args);
        },
        obstaclePresets: OBSTACLE_PRESETS,
      },
      { canvasElement: new MockCanvas(200, 200) },
    );

    const findButtonByText = (root, text) => {
      const queue = [root];

      while (queue.length > 0) {
        const node = queue.shift();

        if (!node) continue;
        if (node.tagName === "BUTTON" && node.textContent === text) return node;
        if (Array.isArray(node.children)) queue.push(...node.children);
      }

      return null;
    };

    const shuffleButton = findButtonByText(uiManager.controlsPanel, "Shuffle Layout");

    assert.ok(shuffleButton, "shuffle layout button should render");

    const originalRandom = Math.random;

    Math.random = () => 0.5;

    try {
      shuffleButton.dispatchEvent({ type: "click" });
    } finally {
      Math.random = originalRandom;
    }

    assert.is(applyCalls.length, 1, "random preset should be applied once");
    const [id] = applyCalls[0];

    assert.ok(
      id && id !== "none",
      "shuffle should choose a non-empty preset when available",
    );
    assert.is(uiManager.obstaclePreset, id, "UI state should track randomized preset");
  } finally {
    restore();
  }
});

test.run();
