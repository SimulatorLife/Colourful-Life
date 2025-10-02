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

    simulation.destroy();
  } finally {
    restore();
  }
});

test.run();
