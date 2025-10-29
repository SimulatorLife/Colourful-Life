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
      showAge: true,
      showFitness: true,
      showLifeEventMarkers: true,
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
    assert.is(uiManager.showAge, true);
    assert.is(uiManager.showFitness, true);
    assert.is(uiManager.showLifeEventMarkers, true);
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
    const ageInput = findCheckboxByLabel(uiManager.controlsPanel, "Show Age Heatmap");
    const lifeEventInput = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );
    const gridInput = findCheckboxByLabel(uiManager.controlsPanel, "Show Grid Lines");

    assert.ok(obstaclesInput, "obstacle toggle should exist");
    assert.ok(densityInput, "density toggle should exist");
    assert.ok(energyInput, "energy toggle should exist");
    assert.ok(ageInput, "age toggle should exist");
    assert.ok(fitnessInput, "fitness toggle should exist");
    assert.ok(lifeEventInput, "life event marker toggle should exist");
    assert.ok(gridInput, "grid line toggle should exist");

    assert.is(obstaclesInput.checked, false);
    assert.is(densityInput.checked, true);
    assert.is(energyInput.checked, true);
    assert.is(ageInput.checked, true);
    assert.is(fitnessInput.checked, true);
    assert.is(lifeEventInput.checked, true);
    assert.is(gridInput.checked, true);

    assert.is(simulation.engine.state.showGridLines, true);
    assert.is(simulation.engine.state.showAge, true);

    const playbackSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Playback Speed ×",
    );
    const fadeSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Fade Window",
    );
    const limitSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Marker Limit",
    );

    assert.ok(playbackSlider, "playback speed slider should exist");
    assert.is(
      playbackSlider.value,
      String(uiManager.speedMultiplier),
      "slider should reflect the initial playback speed",
    );
    assert.ok(fadeSlider, "life event fade slider should exist");
    assert.is(
      fadeSlider.value,
      String(uiManager.getLifeEventFadeTicks()),
      "fade slider should match the default fade window",
    );
    assert.ok(limitSlider, "life event marker limit slider should exist");
    assert.is(
      limitSlider.value,
      String(uiManager.getLifeEventLimit()),
      "limit slider should match the default marker cap",
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
              showAge: true,
              showFitness: true,
              showLifeEventMarkers: true,
              showGridLines: true,
              autoPauseOnBlur: true,
              updatesPerSecond: 48,
              paused: true,
              lifeEventFadeTicks: 72,
              lifeEventLimit: 10,
            },
          },
        },
      },
    });

    const { uiManager } = simulation;

    assert.is(uiManager.showEnergy, true);
    assert.is(uiManager.showDensity, true);
    assert.is(uiManager.showAge, true);
    assert.is(uiManager.showFitness, true);
    assert.is(uiManager.showLifeEventMarkers, true);
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
    const ageToggle = findCheckboxByLabel(uiManager.controlsPanel, "Show Age Heatmap");
    const lifeEventToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );
    const gridToggle = findCheckboxByLabel(uiManager.controlsPanel, "Show Grid Lines");
    const autoPauseToggle = findCheckboxByLabel(
      uiManager.pauseOverlay,
      "Pause When Hidden",
    );

    assert.ok(energyToggle, "energy toggle should render");
    assert.ok(densityToggle, "density toggle should render");
    assert.ok(ageToggle, "age toggle should render");
    assert.ok(fitnessToggle, "fitness toggle should render");
    assert.ok(lifeEventToggle, "life event toggle should render");
    assert.ok(gridToggle, "grid toggle should render");
    assert.ok(autoPauseToggle, "auto-pause toggle should render");
    const fadeSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Fade Window",
    );
    const limitSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Marker Limit",
    );

    assert.ok(fadeSlider, "life event fade slider should render");
    assert.ok(limitSlider, "life event marker limit slider should render");

    assert.is(energyToggle.checked, true);
    assert.is(densityToggle.checked, true);
    assert.is(ageToggle.checked, true);
    assert.is(fitnessToggle.checked, true);
    assert.is(lifeEventToggle.checked, true);
    assert.is(gridToggle.checked, true);
    assert.is(autoPauseToggle.checked, true);
    assert.is(fadeSlider.value, String(uiManager.getLifeEventFadeTicks()));
    assert.is(limitSlider.value, String(uiManager.getLifeEventLimit()));
    assert.is(uiManager.getUpdatesPerSecond(), 48);
    assert.is(uiManager.isPaused(), true);

    const state = simulation.engine.getStateSnapshot();

    assert.is(state.updatesPerSecond, 48);
    assert.is(state.showEnergy, true);
    assert.is(state.showDensity, true);
    assert.is(state.showAge, true);
    assert.is(state.showFitness, true);
    assert.is(state.showLifeEventMarkers, true);
    assert.is(state.showGridLines, true);
    assert.is(state.autoPauseOnBlur, true);
    assert.is(state.lifeEventFadeTicks, 72);
    assert.is(state.lifeEventLimit, 10);
    assert.is(simulation.engine.isPaused(), true);

    simulation.destroy();
  } finally {
    restore();
  }
});

test("layout initial settings override conflicting base config", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");
    const simulation = createSimulation({
      canvas: new MockCanvas(160, 160),
      autoStart: false,
      config: {
        showEnergy: false,
        ui: {
          layout: {
            initialSettings: {
              showEnergy: true,
            },
          },
        },
      },
    });

    const { engine, uiManager } = simulation;

    assert.is(engine.state.showEnergy, true);
    assert.is(uiManager.showEnergy, true);

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

test("energy regeneration slider stays aligned with engine state", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");
    const simulation = createSimulation({
      canvas: new MockCanvas(160, 160),
      autoStart: false,
      config: { paused: true },
    });

    const { engine, uiManager } = simulation;

    engine.setEnergyRates({ regen: 0.09 });

    assert.is(engine.state.energyRegenRate, 0.09);
    assert.is(uiManager.energyRegenRate, 0.09);

    const slider = findSliderByLabel(uiManager.controlsPanel, "Energy Regen Rate");

    assert.ok(slider, "energy regeneration slider should render");
    assert.equal(Number(slider.value), 0.09);

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
