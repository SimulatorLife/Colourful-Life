import { assert, test } from "#tests/harness";
import { MockCanvas } from "./helpers/simulationEngine.js";

const configModulePromise = import("../src/config.js");
const sliderConfigModulePromise = import("../src/ui/sliderConfig.js");
const uiManagerModulePromise = import("../src/ui/uiManager.js");
const simulationEngineModulePromise = import("../src/simulationEngine.js");
const mainModulePromise = import("../src/main.js");

class MockElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = "";
    this.textContent = "";
    this.id = "";
    this.value = "";
    this.title = "";
    this.listeners = {};
    this.style = {};
    this.classList = {
      toggle: () => {},
      add: () => {},
      remove: () => {},
    };
    this.attributes = Object.create(null);
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }

    return child;
  }

  insertBefore(child, anchor) {
    if (!child) return null;
    child.parentElement = this;

    if (!anchor) {
      this.children.push(child);

      return child;
    }

    const index = this.children.indexOf(anchor);

    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }

    return child;
  }

  querySelector() {
    return null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width ?? 0, height: this.height ?? 0 };
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement("body");
    this.appRoot = new MockElement("div");
    this.appRoot.id = "app";
    this.body.appendChild(this.appRoot);
    this.listeners = {};
  }

  querySelector(selector) {
    if (selector === "#app") return this.appRoot;

    return null;
  }

  createElement(tagName) {
    return new MockElement(tagName);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

test("resolveSimulationDefaults returns expected baseline configuration", async () => {
  const {
    resolveSimulationDefaults,
    ENERGY_REGEN_RATE_DEFAULT,
    ENERGY_DIFFUSION_RATE_DEFAULT,
    COMBAT_EDGE_SHARPNESS_DEFAULT,
    SIMULATION_DEFAULTS,
  } = await configModulePromise;
  const { UI_SLIDER_CONFIG } = await sliderConfigModulePromise;
  const defaults = resolveSimulationDefaults();
  const expected = {
    ...SIMULATION_DEFAULTS,
    energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
    energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
    combatEdgeSharpness:
      SIMULATION_DEFAULTS.combatEdgeSharpness ?? COMBAT_EDGE_SHARPNESS_DEFAULT,
    autoPauseOnBlur: defaults.autoPauseOnBlur,
  };

  assert.equal(defaults, expected);
  assert.is(defaults.maxConcurrentEvents, SIMULATION_DEFAULTS.maxConcurrentEvents);

  // Slider defaults should mirror the canonical simulation defaults so UI wiring stays in sync.
  assert.is(
    UI_SLIDER_CONFIG.societySimilarity.default,
    SIMULATION_DEFAULTS.societySimilarity,
  );
  assert.is(
    UI_SLIDER_CONFIG.enemySimilarity.default,
    SIMULATION_DEFAULTS.enemySimilarity,
  );
  assert.is(
    UI_SLIDER_CONFIG.matingDiversityThreshold.default,
    SIMULATION_DEFAULTS.matingDiversityThreshold,
  );
  assert.is(
    UI_SLIDER_CONFIG.lowDiversityReproMultiplier.default,
    SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
  );
  assert.is(
    UI_SLIDER_CONFIG.combatTerritoryEdgeFactor.default,
    SIMULATION_DEFAULTS.combatTerritoryEdgeFactor,
  );
});

test("resolveSimulationDefaults coerces string boolean overrides", async () => {
  const { resolveSimulationDefaults, SIMULATION_DEFAULTS } = await configModulePromise;
  const defaults = resolveSimulationDefaults({
    paused: "false",
    showObstacles: "false",
    showEnergy: "true",
    showDensity: "0",
    showFitness: "1",
    showLifeEventMarkers: "on",
    autoPauseOnBlur: "off",
  });

  assert.is(defaults.paused, false);
  assert.is(defaults.showObstacles, false);
  assert.is(defaults.showEnergy, true);
  assert.is(defaults.showDensity, false);
  assert.is(defaults.showFitness, true);
  assert.is(defaults.showLifeEventMarkers, true);
  assert.is(defaults.autoPauseOnBlur, false);

  // Non-boolean defaults remain untouched when not overridden.
  assert.is(defaults.updatesPerSecond, SIMULATION_DEFAULTS.updatesPerSecond);
});

test("resolveSimulationDefaults keeps event frequency overrides opt-in", async () => {
  const { resolveSimulationDefaults, SIMULATION_DEFAULTS } = await configModulePromise;

  const booleanOverride = resolveSimulationDefaults({
    eventFrequencyMultiplier: true,
  });

  assert.is(
    booleanOverride.eventFrequencyMultiplier,
    SIMULATION_DEFAULTS.eventFrequencyMultiplier,
    "non-numeric overrides should fall back so events stay disabled",
  );

  const negativeOverride = resolveSimulationDefaults({
    eventFrequencyMultiplier: -2,
  });

  assert.is(
    negativeOverride.eventFrequencyMultiplier,
    SIMULATION_DEFAULTS.eventFrequencyMultiplier,
    "negative overrides clamp to the baseline instead of enabling events",
  );
});

test("resolveSimulationDefaults derives cadence from speed overrides", async () => {
  const { resolveSimulationDefaults, SIMULATION_DEFAULTS } = await configModulePromise;
  const defaults = resolveSimulationDefaults({ speedMultiplier: 2 });

  assert.is(defaults.speedMultiplier, 2);
  assert.is(
    defaults.updatesPerSecond,
    Math.round(SIMULATION_DEFAULTS.updatesPerSecond * 2),
  );
});

test("resolveSimulationDefaults backfills speed multiplier from cadence overrides", async () => {
  const { resolveSimulationDefaults, SIMULATION_DEFAULTS } = await configModulePromise;
  const defaults = resolveSimulationDefaults({ updatesPerSecond: 45 });

  assert.is(defaults.updatesPerSecond, 45);
  assert.is(defaults.speedMultiplier, 45 / SIMULATION_DEFAULTS.updatesPerSecond);
});

test("resolveSimulationDefaults clamps initial tile energy overrides", async () => {
  const { resolveSimulationDefaults, SIMULATION_DEFAULTS } = await configModulePromise;

  const capped = resolveSimulationDefaults({ initialTileEnergyFraction: 1.25 });

  assert.is(capped.initialTileEnergyFraction, 1);

  const fallback = resolveSimulationDefaults({
    initialTileEnergyFraction: "not-a-number",
  });

  assert.is(
    fallback.initialTileEnergyFraction,
    SIMULATION_DEFAULTS.initialTileEnergyFraction,
    "non-numeric overrides should fall back to the baseline",
  );
});

test("UIManager constructor seeds settings from resolveSimulationDefaults", async () => {
  const originalDocument = global.document;
  const originalNode = global.Node;
  const originalHTMLElement = global.HTMLElement;
  const originalWindow = global.window;

  const mockDocument = new MockDocument();

  global.document = mockDocument;
  global.Node = MockElement;
  global.HTMLElement = MockElement;
  global.window = { grid: null };

  const { resolveSimulationDefaults } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const { default: UIManager } = await uiManagerModulePromise;

  const uiManager = new UIManager({}, "#app", {}, {});

  assert.is(uiManager.societySimilarity, defaults.societySimilarity);
  assert.is(uiManager.enemySimilarity, defaults.enemySimilarity);
  assert.is(uiManager.eventStrengthMultiplier, defaults.eventStrengthMultiplier);
  assert.is(uiManager.eventFrequencyMultiplier, defaults.eventFrequencyMultiplier);
  assert.is(uiManager.maxConcurrentEvents, defaults.maxConcurrentEvents);
  assert.is(uiManager.speedMultiplier, defaults.speedMultiplier);
  assert.is(uiManager.densityEffectMultiplier, defaults.densityEffectMultiplier);
  assert.is(uiManager.mutationMultiplier, defaults.mutationMultiplier);
  assert.is(uiManager.combatEdgeSharpness, defaults.combatEdgeSharpness);
  assert.is(uiManager.combatTerritoryEdgeFactor, defaults.combatTerritoryEdgeFactor);
  assert.is(uiManager.matingDiversityThreshold, defaults.matingDiversityThreshold);
  assert.is(
    uiManager.lowDiversityReproMultiplier,
    defaults.lowDiversityReproMultiplier,
  );
  assert.is(uiManager.energyRegenRate, defaults.energyRegenRate);
  assert.is(uiManager.energyDiffusionRate, defaults.energyDiffusionRate);
  assert.is(uiManager.leaderboardIntervalMs, defaults.leaderboardIntervalMs);
  assert.is(uiManager.showObstacles, defaults.showObstacles);
  assert.is(uiManager.showEnergy, defaults.showEnergy);
  assert.is(uiManager.showDensity, defaults.showDensity);
  assert.is(uiManager.showFitness, defaults.showFitness);
  assert.is(uiManager.showLifeEventMarkers, defaults.showLifeEventMarkers);
  assert.is(uiManager.autoPauseOnBlur, defaults.autoPauseOnBlur);

  if (originalDocument === undefined) delete global.document;
  else global.document = originalDocument;
  if (originalNode === undefined) delete global.Node;
  else global.Node = originalNode;
  if (originalHTMLElement === undefined) delete global.HTMLElement;
  else global.HTMLElement = originalHTMLElement;
  if (originalWindow === undefined) delete global.window;
  else global.window = originalWindow;
});

test("SimulationEngine state initialization mirrors resolveSimulationDefaults", async () => {
  const { resolveSimulationDefaults } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const { default: SimulationEngine } = await simulationEngineModulePromise;
  const canvas = new MockCanvas(100, 100);

  const engine = new SimulationEngine({ canvas, autoStart: false });

  const expectedState = {
    paused: Boolean(defaults.paused),
    updatesPerSecond: Math.max(1, Math.round(defaults.updatesPerSecond)),
    speedMultiplier: defaults.speedMultiplier,
    eventFrequencyMultiplier: defaults.eventFrequencyMultiplier,
    mutationMultiplier: defaults.mutationMultiplier,
    densityEffectMultiplier: defaults.densityEffectMultiplier,
    societySimilarity: defaults.societySimilarity,
    enemySimilarity: defaults.enemySimilarity,
    eventStrengthMultiplier: defaults.eventStrengthMultiplier,
    maxConcurrentEvents: defaults.maxConcurrentEvents,
    energyRegenRate: defaults.energyRegenRate,
    energyDiffusionRate: defaults.energyDiffusionRate,
    combatEdgeSharpness: defaults.combatEdgeSharpness,
    combatTerritoryEdgeFactor: defaults.combatTerritoryEdgeFactor,
    showObstacles: defaults.showObstacles,
    showEnergy: defaults.showEnergy,
    showDensity: defaults.showDensity,
    showFitness: defaults.showFitness,
    showLifeEventMarkers: defaults.showLifeEventMarkers,
    leaderboardIntervalMs: defaults.leaderboardIntervalMs,
    matingDiversityThreshold: defaults.matingDiversityThreshold,
    lowDiversityReproMultiplier: defaults.lowDiversityReproMultiplier,
    initialTileEnergyFraction: defaults.initialTileEnergyFraction,
    autoPauseOnBlur: defaults.autoPauseOnBlur,
    autoPausePending: false,
  };

  expectedState.gridRows = engine.rows;
  expectedState.gridCols = engine.cols;
  expectedState.cellSize = engine.cellSize;

  assert.equal(engine.state, expectedState);
});

test("createHeadlessUiManager exposes resolveSimulationDefaults-derived values", async () => {
  const { resolveSimulationDefaults } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const { createHeadlessUiManager } = await mainModulePromise;

  const ui = createHeadlessUiManager();

  assert.is(ui.isPaused(), Boolean(defaults.paused));
  assert.is(ui.getUpdatesPerSecond(), defaults.updatesPerSecond);
  assert.is(ui.getEventFrequencyMultiplier(), defaults.eventFrequencyMultiplier);
  assert.is(ui.getMaxConcurrentEvents(), defaults.maxConcurrentEvents);
  assert.is(ui.getMutationMultiplier(), defaults.mutationMultiplier);
  assert.is(ui.getDensityEffectMultiplier(), defaults.densityEffectMultiplier);
  assert.is(ui.getSocietySimilarity(), defaults.societySimilarity);
  assert.is(ui.getEnemySimilarity(), defaults.enemySimilarity);
  assert.is(ui.getEventStrengthMultiplier(), defaults.eventStrengthMultiplier);
  assert.is(ui.getCombatEdgeSharpness(), defaults.combatEdgeSharpness);
  assert.is(ui.getCombatTerritoryEdgeFactor(), defaults.combatTerritoryEdgeFactor);
  assert.is(ui.getEnergyRegenRate(), defaults.energyRegenRate);
  assert.is(ui.getEnergyDiffusionRate(), defaults.energyDiffusionRate);
  assert.is(ui.getMatingDiversityThreshold(), defaults.matingDiversityThreshold);
  assert.is(ui.getLowDiversityReproMultiplier(), defaults.lowDiversityReproMultiplier);
  ui.setCombatEdgeSharpness(4.2);
  assert.is(ui.getCombatEdgeSharpness(), 4.2);
  ui.setCombatTerritoryEdgeFactor(0.55);
  assert.is(ui.getCombatTerritoryEdgeFactor(), 0.55);
  ui.setMaxConcurrentEvents(5.6);
  assert.is(ui.getMaxConcurrentEvents(), 5);
  assert.is(ui.getShowObstacles(), defaults.showObstacles);
  assert.is(ui.getShowEnergy(), defaults.showEnergy);
  assert.is(ui.getShowDensity(), defaults.showDensity);
  assert.is(ui.getShowFitness(), defaults.showFitness);
  assert.is(ui.getShowLifeEventMarkers(), defaults.showLifeEventMarkers);
  assert.is(ui.getAutoPauseOnBlur(), defaults.autoPauseOnBlur);
  assert.ok(ui.shouldRenderSlowUi(0));
  assert.ok(!ui.shouldRenderSlowUi(defaults.leaderboardIntervalMs - 1));
  assert.ok(ui.shouldRenderSlowUi(defaults.leaderboardIntervalMs));
});
