import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui combat controls sync");

class StubEngine {
  constructor(defaults) {
    this.canvas = {};
    this.selectionManager = null;
    this.rows = 120;
    this.cols = 120;
    this.cellSize = 5;
    this.listeners = new Map();
    this.state = {
      ...defaults,
      updatesPerSecond: defaults.updatesPerSecond ?? 60,
      speedMultiplier: defaults.speedMultiplier ?? 1,
      lowDiversityReproMultiplier: defaults.lowDiversityReproMultiplier ?? 0.57,
      initialTileEnergyFraction: defaults.initialTileEnergyFraction ?? 0.5,
      autoPauseOnBlur: defaults.autoPauseOnBlur ?? false,
      autoPausePending: false,
      gridRows: this.rows,
      gridCols: this.cols,
      cellSize: this.cellSize,
    };
  }

  on(event, handler) {
    if (typeof handler !== "function") {
      return () => {};
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const bucket = this.listeners.get(event);

    bucket.add(handler);

    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emitState(changes) {
    Object.assign(this.state, changes);
    const payload = { state: { ...this.state }, changes };

    const handlers = this.listeners.get("state");

    handlers?.forEach((handler) => handler(payload));
  }

  isPaused() {
    return Boolean(this.state.paused);
  }
}

test("combat tuning sliders mirror engine state", async () => {
  const restore = setupDom();

  try {
    const { bindSimulationToUi } = await import("../src/ui/simulationUiBridge.js");
    const { resolveSimulationDefaults } = await import("../src/config.js");

    const defaults = resolveSimulationDefaults({
      combatEdgeSharpness: 4.4,
      combatTerritoryEdgeFactor: 0.6,
    });
    const engine = new StubEngine(defaults);

    const { uiManager } = bindSimulationToUi({
      engine,
      sanitizedDefaults: defaults,
      simulationCallbacks: {
        requestFrame: () => {},
        togglePause: () => {},
        step: () => {},
        onSettingChange: () => {},
      },
    });

    const combatSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Combat Edge Sharpness",
    );

    assert.ok(combatSlider, "combat slider should be discoverable");
    assert.is(combatSlider.value, "4.4");
    const combatDisplay = Array.isArray(combatSlider?.parentElement?.children)
      ? combatSlider.parentElement.children.find(
          (child) => child?.className === "control-value",
        )
      : null;

    assert.is(combatDisplay?.textContent, "4.40");

    const territorySlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Territory Edge Influence",
    );

    assert.ok(territorySlider, "territory slider should be discoverable");
    assert.is(territorySlider.value, "0.6");
    const territoryDisplay = Array.isArray(territorySlider?.parentElement?.children)
      ? territorySlider.parentElement.children.find(
          (child) => child?.className === "control-value",
        )
      : null;

    assert.is(territoryDisplay?.textContent, "0.60");

    engine.emitState({ combatEdgeSharpness: 6.8, combatTerritoryEdgeFactor: 1.5 });

    assert.is(uiManager.combatEdgeSharpness, 6);
    assert.is(combatSlider.value, "6");
    assert.is(combatDisplay?.textContent, "6.00");

    assert.is(uiManager.combatTerritoryEdgeFactor, 1);
    assert.is(territorySlider.value, "1");
    assert.is(territoryDisplay?.textContent, "1.00");
  } finally {
    restore();
  }
});

test.run();
