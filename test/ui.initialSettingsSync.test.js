import { suite } from "uvu";
import * as assert from "uvu/assert";

import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui initial settings sync");

test("createSimulation aligns UI controls with config defaults", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const config = {
      autoPauseOnBlur: false,
      showObstacles: false,
      showDensity: true,
      showEnergy: true,
      showFitness: true,
      showCelebrationAuras: true,
    };

    const simulation = createSimulation({
      canvas: new MockCanvas(200, 200),
      autoStart: false,
      config,
    });

    const { uiManager } = simulation;

    assert.is(uiManager.showObstacles, false);
    assert.is(uiManager.showDensity, true);
    assert.is(uiManager.showEnergy, true);
    assert.is(uiManager.showFitness, true);
    assert.is(uiManager.showCelebrationAuras, true);
    assert.is(uiManager.autoPauseOnBlur, false);

    const findCheckboxByLabel = (root, label) => {
      const queue = [root];

      while (queue.length > 0) {
        const node = queue.shift();

        if (node && Array.isArray(node.children)) {
          queue.push(...node.children);
        }

        if (!node || node.tagName !== "LABEL" || !Array.isArray(node.children)) {
          continue;
        }

        const line = node.children[0];

        if (!line || !Array.isArray(line.children)) continue;

        const input = line.children.find((child) => child?.tagName === "INPUT");
        const directName = line.children.find(
          (child) => child?.className === "control-name",
        );
        const nestedLabel = line.children.find(
          (child) => child?.className === "control-checkbox-label",
        );
        const nestedName = Array.isArray(nestedLabel?.children)
          ? nestedLabel.children.find((child) => child?.className === "control-name")
          : null;
        const name = directName ?? nestedName;

        const extractText = (element) => {
          if (!element) return "";
          if (typeof element.textContent === "string" && element.textContent.trim()) {
            return element.textContent;
          }
          if (!Array.isArray(element.children) || element.children.length === 0) {
            return "";
          }

          return element.children.map((child) => extractText(child)).join("");
        };

        if (name && extractText(name).trim() === label) {
          return input ?? null;
        }
      }

      return null;
    };

    const findSliderByLabel = (root, label) => {
      const queue = [root];

      while (queue.length > 0) {
        const node = queue.shift();

        if (node && Array.isArray(node.children)) {
          queue.push(...node.children);
        }

        if (!node || node.tagName !== "LABEL" || !Array.isArray(node.children)) {
          continue;
        }

        const name = node.children.find((child) => child?.className === "control-name");
        const line = node.children.find((child) => child?.className === "control-line");

        if (!line || !Array.isArray(line.children)) continue;

        const input = line.children.find(
          (child) => child?.tagName === "INPUT" && child?.type === "range",
        );

        if (!input) continue;

        const text =
          typeof name?.textContent === "string" ? name.textContent.trim() : "";

        if (text === label) return input;
      }

      return null;
    };

    const obstaclesInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Obstacles",
    );
    const densityInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Density Heatmap",
    );
    const energyInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Energy Heatmap",
    );
    const fitnessInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Fitness Heatmap",
    );
    const celebrationInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Celebration Glow",
    );

    assert.ok(obstaclesInput, "obstacle toggle should exist");
    assert.ok(densityInput, "density toggle should exist");
    assert.ok(energyInput, "energy toggle should exist");
    assert.ok(fitnessInput, "fitness toggle should exist");
    assert.ok(celebrationInput, "celebration toggle should exist");

    assert.is(obstaclesInput.checked, false);
    assert.is(densityInput.checked, true);
    assert.is(energyInput.checked, true);
    assert.is(fitnessInput.checked, true);
    assert.is(celebrationInput.checked, true);

    const playbackSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Playback Speed ×",
    );

    assert.ok(playbackSlider, "playback speed slider should exist");
    assert.is(
      playbackSlider.value,
      String(uiManager.speedMultiplier),
      "slider should reflect the initial playback speed",
    );

    const sliderRow = playbackSlider?.parentElement?.parentElement ?? null;
    const panelBody = uiManager.controlsPanel.children.find(
      (child) => child?.className === "panel-body",
    );

    if (panelBody && sliderRow) {
      const bodyChildren = Array.isArray(panelBody.children) ? panelBody.children : [];
      const sliderIndex = bodyChildren.indexOf(sliderRow);
      const thresholdsHeadingIndex = bodyChildren.findIndex(
        (child) =>
          child?.className === "control-section-title" &&
          child.textContent === "Similarity Thresholds",
      );

      assert.ok(
        sliderIndex > -1 && thresholdsHeadingIndex > -1,
        "playback speed slider and similarity heading should exist",
      );
      assert.ok(
        sliderIndex < thresholdsHeadingIndex,
        "playback speed slider should render before similarity tuning",
      );
    }

    simulation.destroy();
  } finally {
    restore();
  }
});

test("createSimulation keeps engine cadence in sync with speed defaults", async () => {
  const restore = setupDom();

  try {
    const [{ createSimulation }, { SIMULATION_DEFAULTS }] = await Promise.all([
      import("../src/main.js"),
      import("../src/config.js"),
    ]);

    const baseUpdates = SIMULATION_DEFAULTS.updatesPerSecond;
    const speedConfig = { speedMultiplier: 1.8, paused: true };
    const fastSimulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      config: speedConfig,
    });

    assert.is(fastSimulation.uiManager.speedMultiplier, speedConfig.speedMultiplier);
    assert.is(
      fastSimulation.engine.state.updatesPerSecond,
      Math.round(baseUpdates * speedConfig.speedMultiplier),
    );

    fastSimulation.destroy();

    const cadenceConfig = { updatesPerSecond: 90, paused: true };
    const cadenceSimulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      config: cadenceConfig,
    });

    assert.is(cadenceSimulation.engine.state.updatesPerSecond, 90);
    assert.is(cadenceSimulation.uiManager.speedMultiplier, 90 / baseUpdates);

    cadenceSimulation.destroy();
  } finally {
    restore();
  }
});

test.run();
