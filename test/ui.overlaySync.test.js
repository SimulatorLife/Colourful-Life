import { assert, suite } from "#tests/harness";
import { setupDom, MockCanvas } from "./helpers/mockDom.js";
import { findCheckboxByLabel } from "./helpers/controlQueries.js";

const test = suite("ui overlay sync");

test("engine overlay visibility changes update UI controls", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const simulation = createSimulation({
      canvas: new MockCanvas(200, 200),
      autoStart: false,
      config: {
        showEnergy: true,
        showLifeEventMarkers: true,
        showReproductiveZones: true,
      },
    });

    const { engine, uiManager } = simulation;
    const energyToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Energy Heatmap",
    );
    const lifeEventOverlayToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );
    const lifeEventPanelToggle = findCheckboxByLabel(
      uiManager.lifeEventsPanel,
      "Life Event Markers",
    );
    const reproductiveZonesToggle = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Highlight Reproductive Zones",
    );

    assert.ok(energyToggle, "energy overlay checkbox should render");
    assert.ok(lifeEventOverlayToggle, "life event overlay checkbox should render");
    assert.ok(lifeEventPanelToggle, "life events panel checkbox should render");
    assert.ok(reproductiveZonesToggle, "reproductive zone checkbox should render");

    engine.setOverlayVisibility({
      showEnergy: false,
      showLifeEventMarkers: false,
      showReproductiveZones: false,
    });

    assert.is(
      uiManager.showEnergy,
      false,
      "UI state should track engine energy visibility",
    );
    assert.is(
      energyToggle.checked,
      false,
      "energy overlay checkbox should uncheck when engine disables overlay",
    );
    assert.is(
      uiManager.showLifeEventMarkers,
      false,
      "UI state should track engine life event marker visibility",
    );
    assert.is(
      lifeEventOverlayToggle.checked,
      false,
      "life event overlay checkbox should uncheck when engine disables overlay",
    );
    assert.is(
      lifeEventPanelToggle.checked,
      false,
      "life events panel checkbox should mirror engine-driven changes",
    );
    assert.is(
      uiManager.showReproductiveZones,
      false,
      "UI state should reflect reproductive zone visibility",
    );
    assert.is(
      reproductiveZonesToggle.checked,
      false,
      "reproductive zone checkbox should uncheck when engine disables overlay",
    );

    engine.setOverlayVisibility({ showEnergy: true, showLifeEventMarkers: true });

    assert.is(
      uiManager.showEnergy,
      true,
      "UI state should reflect engine re-enabling energy overlay",
    );
    assert.is(
      energyToggle.checked,
      true,
      "energy overlay checkbox should check when re-enabled",
    );
    assert.is(
      uiManager.showLifeEventMarkers,
      true,
      "UI state should reflect engine re-enabling life event markers",
    );
    assert.is(
      lifeEventOverlayToggle.checked,
      true,
      "life event overlay checkbox should check when re-enabled",
    );
    assert.is(
      lifeEventPanelToggle.checked,
      true,
      "life events panel checkbox should mirror engine-driven re-enabling",
    );

    simulation.destroy();
  } finally {
    restore();
  }
});
