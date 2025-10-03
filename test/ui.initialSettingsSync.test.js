import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import {
  findCheckboxByLabel,
  findSelectByLabel,
  findSliderByLabel,
} from "./helpers/controlQueries.js";

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
      showLifeEventMarkers: true,
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
    assert.is(uiManager.showLifeEventMarkers, true);
    assert.is(uiManager.autoPauseOnBlur, false);

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
    const lifeEventInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );

    assert.ok(obstaclesInput, "obstacle toggle should exist");
    assert.ok(densityInput, "density toggle should exist");
    assert.ok(energyInput, "energy toggle should exist");
    assert.ok(fitnessInput, "fitness toggle should exist");
    assert.ok(lifeEventInput, "life event marker toggle should exist");

    assert.is(obstaclesInput.checked, false);
    assert.is(densityInput.checked, true);
    assert.is(energyInput.checked, true);
    assert.is(fitnessInput.checked, true);
    assert.is(lifeEventInput.checked, true);

    const playbackSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Playback Speed ×",
    );
    const profilingSelect = findSelectByLabel(
      uiManager.controlsPanel,
      "Grid Profiling",
    );

    assert.ok(playbackSlider, "playback speed slider should exist");
    assert.is(
      playbackSlider.value,
      String(uiManager.speedMultiplier),
      "slider should reflect the initial playback speed",
    );
    assert.ok(profilingSelect, "grid profiling selector should exist");
    assert.is(
      profilingSelect?.value,
      uiManager.profileGridMetrics,
      "profiling selector should match the active profiling mode",
    );
    assert.is(
      simulation.engine.state.profileGridMetrics,
      uiManager.profileGridMetrics,
      "engine state should mirror UI profiling mode",
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

test("createSimulation honours layout initial settings overrides", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");
    const simulation = createSimulation({
      canvas: new MockCanvas(160, 160),
      autoStart: false,
      config: {
        ui: {
          layout: {
            initialSettings: {
              showEnergy: true,
              showDensity: true,
              showFitness: true,
              showLifeEventMarkers: true,
              autoPauseOnBlur: true,
              updatesPerSecond: 48,
              paused: true,
              profileGridMetrics: "never",
            },
          },
        },
      },
    });

    const { uiManager } = simulation;

    assert.is(uiManager.showEnergy, true);
    assert.is(uiManager.showDensity, true);
    assert.is(uiManager.showFitness, true);
    assert.is(uiManager.showLifeEventMarkers, true);
    assert.is(uiManager.autoPauseOnBlur, true);

    const energyToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Energy Heatmap",
    );
    const densityToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Density Heatmap",
    );
    const fitnessToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Fitness Heatmap",
    );
    const lifeEventToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );
    const autoPauseToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Pause When Hidden",
    );
    const profilingSelect = findSelectByLabel(
      uiManager.controlsPanel,
      "Grid Profiling",
    );

    assert.ok(energyToggle, "energy toggle should render");
    assert.ok(densityToggle, "density toggle should render");
    assert.ok(fitnessToggle, "fitness toggle should render");
    assert.ok(lifeEventToggle, "life event toggle should render");
    assert.ok(autoPauseToggle, "auto-pause toggle should render");
    assert.ok(profilingSelect, "grid profiling selector should render");

    assert.is(energyToggle.checked, true);
    assert.is(densityToggle.checked, true);
    assert.is(fitnessToggle.checked, true);
    assert.is(lifeEventToggle.checked, true);
    assert.is(autoPauseToggle.checked, true);
    assert.is(profilingSelect?.value, "never");
    assert.is(uiManager.profileGridMetrics, "never");
    assert.is(uiManager.getUpdatesPerSecond(), 48);
    assert.is(uiManager.isPaused(), true);

    const state = simulation.engine.getStateSnapshot();

    assert.is(state.updatesPerSecond, 48);
    assert.is(state.showEnergy, true);
    assert.is(state.showDensity, true);
    assert.is(state.showFitness, true);
    assert.is(state.showLifeEventMarkers, true);
    assert.is(state.autoPauseOnBlur, true);
    assert.is(state.profileGridMetrics, "never");
    assert.is(simulation.engine.isPaused(), true);

    profilingSelect.value = "always";
    const profileChangeEvent = new window.Event("change", { bubbles: true });

    profilingSelect.dispatchEvent(profileChangeEvent);

    assert.is(uiManager.profileGridMetrics, "always");
    assert.is(simulation.engine.state.profileGridMetrics, "always");

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
