import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findCheckboxByLabel, findSliderByLabel } from "./helpers/controlQueries.js";

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
      showAuroraVeil: true,
      showGridLines: true,
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
    assert.is(uiManager.showAuroraVeil, true);
    assert.is(uiManager.showGridLines, true);
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
    const auroraInput = findCheckboxByLabel(uiManager.controlsPanel, "Aurora Veil");
    const gridInput = findCheckboxByLabel(uiManager.controlsPanel, "Show Grid Lines");

    assert.ok(obstaclesInput, "obstacle toggle should exist");
    assert.ok(densityInput, "density toggle should exist");
    assert.ok(energyInput, "energy toggle should exist");
    assert.ok(fitnessInput, "fitness toggle should exist");
    assert.ok(lifeEventInput, "life event marker toggle should exist");
    assert.ok(auroraInput, "aurora veil toggle should exist");
    assert.ok(gridInput, "grid line toggle should exist");

    assert.is(obstaclesInput.checked, false);
    assert.is(densityInput.checked, true);
    assert.is(energyInput.checked, true);
    assert.is(fitnessInput.checked, true);
    assert.is(lifeEventInput.checked, true);
    assert.is(auroraInput.checked, true);
    assert.is(gridInput.checked, true);

    assert.is(simulation.engine.state.showGridLines, true);

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
              showAuroraVeil: true,
              showGridLines: true,
              autoPauseOnBlur: true,
              updatesPerSecond: 48,
              paused: true,
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
    assert.is(uiManager.showAuroraVeil, true);
    assert.is(uiManager.showGridLines, true);
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
    const auroraToggle = findCheckboxByLabel(uiManager.controlsPanel, "Aurora Veil");
    const gridToggle = findCheckboxByLabel(uiManager.controlsPanel, "Show Grid Lines");
    const autoPauseToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Pause When Hidden",
    );

    assert.ok(energyToggle, "energy toggle should render");
    assert.ok(densityToggle, "density toggle should render");
    assert.ok(fitnessToggle, "fitness toggle should render");
    assert.ok(lifeEventToggle, "life event toggle should render");
    assert.ok(auroraToggle, "aurora toggle should render");
    assert.ok(gridToggle, "grid toggle should render");
    assert.ok(autoPauseToggle, "auto-pause toggle should render");

    assert.is(energyToggle.checked, true);
    assert.is(densityToggle.checked, true);
    assert.is(fitnessToggle.checked, true);
    assert.is(lifeEventToggle.checked, true);
    assert.is(auroraToggle.checked, true);
    assert.is(gridToggle.checked, true);
    assert.is(autoPauseToggle.checked, true);
    assert.is(uiManager.getUpdatesPerSecond(), 48);
    assert.is(uiManager.isPaused(), true);

    const state = simulation.engine.getStateSnapshot();

    assert.is(state.updatesPerSecond, 48);
    assert.is(state.showEnergy, true);
    assert.is(state.showDensity, true);
    assert.is(state.showFitness, true);
    assert.is(state.showLifeEventMarkers, true);
    assert.is(state.showAuroraVeil, true);
    assert.is(state.showGridLines, true);
    assert.is(state.autoPauseOnBlur, true);
    assert.is(simulation.engine.isPaused(), true);

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

test("layout initial settings yield to sanitized config overrides", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");
    const config = {
      updatesPerSecond: 120,
      ui: {
        layout: {
          initialSettings: {
            updatesPerSecond: 30,
          },
        },
      },
    };

    const simulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      config,
    });

    assert.is(simulation.engine.state.updatesPerSecond, 120);
    assert.is(simulation.uiManager.getUpdatesPerSecond(), 120);
    assert.is(
      simulation.uiManager.speedMultiplier,
      simulation.engine.state.speedMultiplier,
    );

    simulation.destroy();
  } finally {
    restore();
  }
});

test("layout initial settings clamp leaderboard cadence to minimum", async () => {
  const restore = setupDom();

  try {
    const [{ createSimulation }, { LEADERBOARD_INTERVAL_MIN_MS }] = await Promise.all([
      import("../src/main.js"),
      import("../src/config.js"),
    ]);

    const simulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
      config: {
        ui: {
          layout: {
            initialSettings: {
              leaderboardIntervalMs: LEADERBOARD_INTERVAL_MIN_MS / 2,
            },
          },
        },
      },
    });

    assert.is(
      simulation.engine.state.leaderboardIntervalMs,
      LEADERBOARD_INTERVAL_MIN_MS,
    );
    assert.is(simulation.uiManager.leaderboardIntervalMs, LEADERBOARD_INTERVAL_MIN_MS);

    simulation.destroy();
  } finally {
    restore();
  }
});

test("engine cadence sync handles values below the slider minimum", async () => {
  const restore = setupDom();

  try {
    const [{ createSimulation }, { SIMULATION_DEFAULTS }] = await Promise.all([
      import("../src/main.js"),
      import("../src/config.js"),
    ]);
    const simulation = createSimulation({
      canvas: new MockCanvas(160, 160),
      autoStart: false,
    });

    const base =
      Number.isFinite(simulation.uiManager.baseUpdatesPerSecond) &&
      simulation.uiManager.baseUpdatesPerSecond > 0
        ? simulation.uiManager.baseUpdatesPerSecond
        : SIMULATION_DEFAULTS.updatesPerSecond;

    simulation.engine.setUpdatesPerSecond(3);

    assert.is(simulation.engine.state.updatesPerSecond, 3);
    assert.is(simulation.uiManager.getUpdatesPerSecond(), 3);
    assert.is(simulation.uiManager.speedMultiplier, 3 / base);
    assert.is(
      simulation.uiManager.playbackSpeedSlider.value,
      String(simulation.uiManager.speedMultiplier),
    );

    simulation.destroy();
  } finally {
    restore();
  }
});
