import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findCheckboxByLabel } from "./helpers/controlQueries.js";

const test = suite("ui overlay toggle sync");

test("overlay checkboxes mirror engine visibility changes", async () => {
  const restore = setupDom();

  try {
    const { createSimulation } = await import("../src/main.js");

    const simulation = createSimulation({
      canvas: new MockCanvas(120, 120),
      autoStart: false,
    });

    const { engine, uiManager } = simulation;

    const energyCheckbox = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Show Energy Heatmap",
    );
    const lifeMarkersCheckbox = findCheckboxByLabel(
      uiManager.controlsPanel,
      "Life Event Markers",
    );

    assert.ok(energyCheckbox, "expected energy overlay checkbox to be rendered");
    assert.ok(
      lifeMarkersCheckbox,
      "expected life event markers overlay checkbox to be rendered",
    );

    assert.is(energyCheckbox.checked, uiManager.getShowEnergy());
    assert.is(lifeMarkersCheckbox.checked, uiManager.getShowLifeEventMarkers());

    engine.setOverlayVisibility({
      showEnergy: true,
      showLifeEventMarkers: true,
    });

    assert.is(engine.state.showEnergy, true);
    assert.is(engine.state.showLifeEventMarkers, true);
    assert.is(energyCheckbox.checked, true);
    assert.is(lifeMarkersCheckbox.checked, true);
    assert.is(uiManager.getShowEnergy(), true);
    assert.is(uiManager.getShowLifeEventMarkers(), true);

    engine.setOverlayVisibility({ showEnergy: false });
    assert.is(engine.state.showEnergy, false);
    assert.is(energyCheckbox.checked, false);
    assert.is(uiManager.getShowEnergy(), false);

    engine.setOverlayVisibility({ showLifeEventMarkers: false });
    assert.is(engine.state.showLifeEventMarkers, false);
    assert.is(lifeMarkersCheckbox.checked, false);
    assert.is(uiManager.getShowLifeEventMarkers(), false);

    simulation.destroy();
  } finally {
    restore();
  }
});
