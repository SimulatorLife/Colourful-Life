import { test } from 'uvu';
import * as assert from 'uvu/assert';

const configModulePromise = import('../src/config.js');
const uiManagerModulePromise = import('../src/uiManager.js');
const simulationEngineModulePromise = import('../src/simulationEngine.js');
const mainModulePromise = import('../src/main.js');

class MockGradient {
  addColorStop() {}
}

class MockContext {
  constructor(width, height) {
    this.canvas = { width, height };
  }

  clearRect() {}
  fillRect() {}
  strokeRect() {}
  save() {}
  restore() {}
  createLinearGradient() {
    return new MockGradient();
  }
  fillText() {}
  strokeText() {}
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.className = '';
    this.textContent = '';
    this.id = '';
    this.value = '';
    this.title = '';
    this.listeners = {};
    this.style = {};
    this.classList = {
      toggle: () => {},
      add: () => {},
      remove: () => {},
    };
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

      return child;
    }

    this.children.splice(index, 0, child);

    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);

    if (index >= 0) {
      this.children.splice(index, 1);
      child.parentElement = null;
    }

    return child;
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      return this.children.find((child) => child.id === selector.slice(1)) ?? null;
    }

    if (selector.startsWith('.')) {
      return this.children.find((child) => child.className.split(' ').includes(selector.slice(1))) ?? null;
    }

    return this.children.find((child) => child.tagName === selector.toUpperCase()) ?? null;
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.width ?? 0, height: this.height ?? 0 };
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  removeAttribute(name) {
    delete this[name];
  }
}

class MockCanvas extends MockElement {
  constructor(width, height) {
    super('canvas');
    this.width = width;
    this.height = height;
    this._context = new MockContext(width, height);
  }

  getContext(type) {
    if (type !== '2d') return null;

    return this._context;
  }
}

class MockDocument {
  constructor() {
    this.body = new MockElement('body');
    this.appRoot = new MockElement('div');
    this.appRoot.id = 'app';
    this.canvas = new MockCanvas(640, 480);
    this.body.appendChild(this.appRoot);
    this.body.appendChild(this.canvas);
    this.listeners = {};
  }

  querySelector(selector) {
    if (selector === '#app') return this.appRoot;

    if (selector === 'canvas') return this.canvas;

    return null;
  }

  createElement(tagName) {
    if (tagName.toLowerCase() === 'canvas') {
      return new MockCanvas(640, 480);
    }

    return new MockElement(tagName);
  }

  addEventListener(type, handler) {
    this.listeners[type] = handler;
  }
}

test('resolveSimulationDefaults returns expected baseline configuration', async () => {
  const {
    resolveSimulationDefaults,
    UI_SLIDER_CONFIG,
    ENERGY_REGEN_RATE_DEFAULT,
    ENERGY_DIFFUSION_RATE_DEFAULT,
  } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const expected = {
    paused: false,
    updatesPerSecond: 60,
    eventFrequencyMultiplier: UI_SLIDER_CONFIG.eventFrequencyMultiplier?.default ?? 1,
    mutationMultiplier: UI_SLIDER_CONFIG.mutationMultiplier?.default ?? 1,
    densityEffectMultiplier: UI_SLIDER_CONFIG.densityEffectMultiplier?.default ?? 1,
    societySimilarity: UI_SLIDER_CONFIG.societySimilarity?.default ?? 0.7,
    enemySimilarity: UI_SLIDER_CONFIG.enemySimilarity?.default ?? 0.4,
    eventStrengthMultiplier: UI_SLIDER_CONFIG.eventStrengthMultiplier?.default ?? 1,
    energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
    energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
    showObstacles: true,
    showEnergy: false,
    showDensity: false,
    showFitness: false,
    leaderboardIntervalMs: UI_SLIDER_CONFIG.leaderboardIntervalMs?.default ?? 750,
    matingDiversityThreshold: UI_SLIDER_CONFIG.matingDiversityThreshold?.default ?? 0.45,
    lowDiversityReproMultiplier: UI_SLIDER_CONFIG.lowDiversityReproMultiplier?.default ?? 0.1,
    speedMultiplier: UI_SLIDER_CONFIG.speedMultiplier?.default ?? 1,
    lingerPenalty: 0,
    autoRespawnEnabled: true,
    autoRespawnFloor: UI_SLIDER_CONFIG.autoRespawnFloor?.default ?? 150,
  };

  assert.equal(defaults, expected);
});

test('UIManager constructor seeds settings from resolveSimulationDefaults', async () => {
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

  const uiManager = new UIManager({}, '#app', {}, {});

  assert.is(uiManager.societySimilarity, defaults.societySimilarity);
  assert.is(uiManager.enemySimilarity, defaults.enemySimilarity);
  assert.is(uiManager.eventStrengthMultiplier, defaults.eventStrengthMultiplier);
  assert.is(uiManager.eventFrequencyMultiplier, defaults.eventFrequencyMultiplier);
  assert.is(uiManager.speedMultiplier, defaults.speedMultiplier);
  assert.is(uiManager.densityEffectMultiplier, defaults.densityEffectMultiplier);
  assert.is(uiManager.mutationMultiplier, defaults.mutationMultiplier);
  assert.is(uiManager.matingDiversityThreshold, defaults.matingDiversityThreshold);
  assert.is(uiManager.lowDiversityReproMultiplier, defaults.lowDiversityReproMultiplier);
  assert.is(uiManager.energyRegenRate, defaults.energyRegenRate);
  assert.is(uiManager.energyDiffusionRate, defaults.energyDiffusionRate);
  assert.is(uiManager.leaderboardIntervalMs, defaults.leaderboardIntervalMs);
  assert.is(uiManager.showObstacles, defaults.showObstacles);
  assert.is(uiManager.showEnergy, defaults.showEnergy);
  assert.is(uiManager.showDensity, defaults.showDensity);
  assert.is(uiManager.showFitness, defaults.showFitness);
  assert.is(uiManager.lingerPenalty, defaults.lingerPenalty);
  assert.is(uiManager.autoRespawnEnabled, defaults.autoRespawnEnabled);
  assert.is(uiManager.autoRespawnFloor, defaults.autoRespawnFloor);

  if (originalDocument === undefined) delete global.document;
  else global.document = originalDocument;
  if (originalNode === undefined) delete global.Node;
  else global.Node = originalNode;
  if (originalHTMLElement === undefined) delete global.HTMLElement;
  else global.HTMLElement = originalHTMLElement;
  if (originalWindow === undefined) delete global.window;
  else global.window = originalWindow;
});

test('SimulationEngine state initialization mirrors resolveSimulationDefaults', async () => {
  const { resolveSimulationDefaults } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const { default: SimulationEngine } = await simulationEngineModulePromise;
  const canvas = new MockCanvas(100, 100);

  const engine = new SimulationEngine({ canvas, autoStart: false });

  const expectedState = {
    paused: Boolean(defaults.paused),
    updatesPerSecond: Math.max(1, Math.round(defaults.updatesPerSecond)),
    eventFrequencyMultiplier: defaults.eventFrequencyMultiplier,
    mutationMultiplier: defaults.mutationMultiplier,
    densityEffectMultiplier: defaults.densityEffectMultiplier,
    societySimilarity: defaults.societySimilarity,
    enemySimilarity: defaults.enemySimilarity,
    eventStrengthMultiplier: defaults.eventStrengthMultiplier,
    energyRegenRate: defaults.energyRegenRate,
    energyDiffusionRate: defaults.energyDiffusionRate,
    showObstacles: defaults.showObstacles,
    showEnergy: defaults.showEnergy,
    showDensity: defaults.showDensity,
    showFitness: defaults.showFitness,
    leaderboardIntervalMs: defaults.leaderboardIntervalMs,
    matingDiversityThreshold: defaults.matingDiversityThreshold,
    lowDiversityReproMultiplier: defaults.lowDiversityReproMultiplier,
    autoRespawnEnabled: defaults.autoRespawnEnabled,
    autoRespawnFloor: defaults.autoRespawnFloor,
  };

  assert.equal(engine.state, expectedState);
  assert.is(engine.lingerPenalty, defaults.lingerPenalty);
});

test('createHeadlessUiManager exposes resolveSimulationDefaults-derived values', async () => {
  const { resolveSimulationDefaults } = await configModulePromise;
  const defaults = resolveSimulationDefaults();
  const { createHeadlessUiManager } = await mainModulePromise;

  const ui = createHeadlessUiManager();

  assert.is(ui.isPaused(), Boolean(defaults.paused));
  assert.is(ui.getUpdatesPerSecond(), defaults.updatesPerSecond);
  assert.is(ui.getEventFrequencyMultiplier(), defaults.eventFrequencyMultiplier);
  assert.is(ui.getMutationMultiplier(), defaults.mutationMultiplier);
  assert.is(ui.getDensityEffectMultiplier(), defaults.densityEffectMultiplier);
  assert.is(ui.getSocietySimilarity(), defaults.societySimilarity);
  assert.is(ui.getEnemySimilarity(), defaults.enemySimilarity);
  assert.is(ui.getEventStrengthMultiplier(), defaults.eventStrengthMultiplier);
  assert.is(ui.getEnergyRegenRate(), defaults.energyRegenRate);
  assert.is(ui.getEnergyDiffusionRate(), defaults.energyDiffusionRate);
  assert.is(ui.getMatingDiversityThreshold(), defaults.matingDiversityThreshold);
  assert.is(ui.getLowDiversityReproMultiplier(), defaults.lowDiversityReproMultiplier);
  assert.is(ui.getShowObstacles(), defaults.showObstacles);
  assert.is(ui.getShowEnergy(), defaults.showEnergy);
  assert.is(ui.getShowDensity(), defaults.showDensity);
  assert.is(ui.getShowFitness(), defaults.showFitness);
  assert.is(ui.getLingerPenalty(), defaults.lingerPenalty);
  assert.is(ui.getAutoRespawnEnabled(), defaults.autoRespawnEnabled);
  assert.is(ui.getAutoRespawnFloor(), defaults.autoRespawnFloor);
  assert.ok(ui.shouldRenderSlowUi(0));
  assert.ok(!ui.shouldRenderSlowUi(defaults.leaderboardIntervalMs - 1));
  assert.ok(ui.shouldRenderSlowUi(defaults.leaderboardIntervalMs));
});

test.run();
