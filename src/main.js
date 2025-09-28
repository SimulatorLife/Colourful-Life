import UIManager from './uiManager.js';
import BrainDebugger from './brainDebugger.js';
import SimulationRuntime from './simulation/runtime.js';
import createRenderer from './simulation/renderer.js';
import createUiAdapter from './simulation/uiAdapter.js';
import { ensureCanvasDimensions, resolveCanvas } from './simulation/canvas.js';
import { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from './gridManager.js';
import {
  ENERGY_DIFFUSION_RATE_DEFAULT,
  ENERGY_REGEN_RATE_DEFAULT,
  UI_SLIDER_CONFIG,
} from './config.js';

const GLOBAL = typeof globalThis !== 'undefined' ? globalThis : {};

function createHeadlessUiManager(options = {}) {
  const settings = {
    paused: options.paused ?? false,
    updatesPerSecond: options.updatesPerSecond ?? 60,
    eventFrequencyMultiplier:
      options.eventFrequencyMultiplier ?? UI_SLIDER_CONFIG.eventFrequencyMultiplier.default,
    mutationMultiplier: options.mutationMultiplier ?? UI_SLIDER_CONFIG.mutationMultiplier.default,
    densityEffectMultiplier:
      options.densityEffectMultiplier ?? UI_SLIDER_CONFIG.densityEffectMultiplier.default,
    societySimilarity: options.societySimilarity ?? UI_SLIDER_CONFIG.societySimilarity.default,
    enemySimilarity: options.enemySimilarity ?? UI_SLIDER_CONFIG.enemySimilarity.default,
    eventStrengthMultiplier:
      options.eventStrengthMultiplier ?? UI_SLIDER_CONFIG.eventStrengthMultiplier.default,
    energyRegenRate: options.energyRegenRate ?? ENERGY_REGEN_RATE_DEFAULT,
    energyDiffusionRate: options.energyDiffusionRate ?? ENERGY_DIFFUSION_RATE_DEFAULT,
    matingDiversityThreshold:
      options.matingDiversityThreshold ?? UI_SLIDER_CONFIG.matingDiversityThreshold.default,
    lowDiversityReproMultiplier:
      options.lowDiversityReproMultiplier ?? UI_SLIDER_CONFIG.lowDiversityReproMultiplier.default,
    showObstacles: options.showObstacles ?? true,
    showEnergy: options.showEnergy ?? false,
    showDensity: options.showDensity ?? false,
    showFitness: options.showFitness ?? false,
    lingerPenalty: options.lingerPenalty ?? 0,
    leaderboardIntervalMs:
      options.leaderboardIntervalMs ?? UI_SLIDER_CONFIG.leaderboardIntervalMs.default,
  };

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;

  return {
    isPaused: () => settings.paused,
    setPaused: (value) => {
      settings.paused = Boolean(value);
    },
    getUpdatesPerSecond: () => settings.updatesPerSecond,
    setUpdatesPerSecond: (value) => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        settings.updatesPerSecond = value;
      }
    },
    getEventFrequencyMultiplier: () => settings.eventFrequencyMultiplier,
    getMutationMultiplier: () => settings.mutationMultiplier,
    getDensityEffectMultiplier: () => settings.densityEffectMultiplier,
    getSocietySimilarity: () => settings.societySimilarity,
    getEnemySimilarity: () => settings.enemySimilarity,
    getEventStrengthMultiplier: () => settings.eventStrengthMultiplier,
    getEnergyRegenRate: () => settings.energyRegenRate,
    getEnergyDiffusionRate: () => settings.energyDiffusionRate,
    getMatingDiversityThreshold: () => settings.matingDiversityThreshold,
    setMatingDiversityThreshold: (value) => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        settings.matingDiversityThreshold = value;
      }
    },
    getLowDiversityReproMultiplier: () => settings.lowDiversityReproMultiplier,
    setLowDiversityReproMultiplier: (value) => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        settings.lowDiversityReproMultiplier = value;
      }
    },
    getShowObstacles: () => settings.showObstacles,
    getShowEnergy: () => settings.showEnergy,
    getShowDensity: () => settings.showDensity,
    getShowFitness: () => settings.showFitness,
    shouldRenderSlowUi: (timestamp) => {
      if (typeof timestamp !== 'number') return false;
      if (timestamp - lastSlowUiRender >= settings.leaderboardIntervalMs) {
        lastSlowUiRender = timestamp;

        return true;
      }

      return false;
    },
    renderMetrics: () => {},
    renderLeaderboard: () => {},
    getLingerPenalty: () => settings.lingerPenalty,
    setLingerPenalty: (value) => {
      if (typeof value === 'number' && !Number.isNaN(value)) {
        settings.lingerPenalty = value;
      }
    },
    selectionManager: options.selectionManager ?? null,
  };
}

export function createSimulation({
  canvas,
  config = {},
  headless = false,
  autoStart = true,
  rng = Math.random,
  requestAnimationFrame: injectedRaf,
  cancelAnimationFrame: injectedCaf,
  performanceNow: injectedNow,
  window: injectedWindow,
  document: injectedDocument,
} = {}) {
  const win = injectedWindow ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = injectedDocument ?? (typeof document !== 'undefined' ? document : undefined);

  if (win) {
    win.BrainDebugger = BrainDebugger;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

  const resolvedCanvas = resolveCanvas(canvas, doc);
  const hasVisuals = !headless && resolvedCanvas;

  let ctx = null;
  let width = config.canvasSize?.width;
  let height = config.canvasSize?.height;

  if (resolvedCanvas) {
    const dims = ensureCanvasDimensions(resolvedCanvas, config);

    width = dims.width;
    height = dims.height;
    ctx = resolvedCanvas.getContext?.('2d') ?? null;

    if (!ctx && !headless) {
      throw new Error('Visual simulation requires a 2D canvas context.');
    }
  } else if (typeof width !== 'number' || typeof height !== 'number') {
    const dims = ensureCanvasDimensions(null, config);

    width = dims.width;
    height = dims.height;
  }

  const cellSize = config.cellSize ?? 5;
  const rows = config.rows ?? Math.floor(height / cellSize);
  const cols = config.cols ?? Math.floor(width / cellSize);

  const hasInitialPreset = typeof config.initialObstaclePreset === 'string';
  const randomizeInitialObstacles =
    config.randomizeInitialObstacles ??
    (!hasInitialPreset || config.initialObstaclePreset === 'random');
  const initialObstaclePreset = hasInitialPreset
    ? config.initialObstaclePreset
    : randomizeInitialObstacles
      ? 'random'
      : 'none';

  const initialState = {
    paused: Boolean(config.paused ?? false),
    updatesPerSecond: config.updatesPerSecond ?? 60,
    eventFrequencyMultiplier: config.eventFrequencyMultiplier,
    mutationMultiplier: config.mutationMultiplier,
    densityEffectMultiplier: config.densityEffectMultiplier,
    societySimilarity: config.societySimilarity,
    enemySimilarity: config.enemySimilarity,
    eventStrengthMultiplier: config.eventStrengthMultiplier,
    energyRegenRate: config.energyRegenRate,
    energyDiffusionRate: config.energyDiffusionRate,
    showObstacles: config.showObstacles,
    showEnergy: config.showEnergy,
    showDensity: config.showDensity,
    showFitness: config.showFitness,
    leaderboardIntervalMs: config.leaderboardIntervalMs,
    matingDiversityThreshold: config.matingDiversityThreshold,
    lowDiversityReproMultiplier: config.lowDiversityReproMultiplier,
    lingerPenalty: config.lingerPenalty,
  };

  const runtime = new SimulationRuntime({
    rng,
    gridOptions: {
      rows,
      cols,
      cellSize,
      ctx,
      initialObstaclePreset,
      initialObstaclePresetOptions: config.initialObstaclePresetOptions,
      randomizeInitialObstacles,
      randomObstaclePresetPool: config.randomObstaclePresetPool,
    },
    performanceNow: injectedNow,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    renderer: null,
    initialState,
    autoStart: false,
  });

  if (win) {
    win.grid = runtime.grid;
    win.simulationEngine = runtime;
  } else {
    GLOBAL.grid = runtime.grid;
    GLOBAL.simulationEngine = runtime;
  }

  let rendererTeardown = () => {};

  if (hasVisuals && ctx) {
    const renderer = createRenderer({
      gridRenderer: runtime.grid,
      selectionManager: runtime.selectionManager,
      eventManager: runtime.eventManager,
      ctx,
      cellSize,
      drawOverlays: config.drawOverlays,
    });

    runtime.setRenderer(renderer);
    rendererTeardown = () => runtime.setRenderer(null);
  }

  const uiOptions = config.ui ?? {};
  const baseActions = {
    burst: () => runtime.burstRandomCells({ count: 200, radius: 6 }),
    applyObstaclePreset: (id, options) => runtime.applyObstaclePreset(id, options),
    runObstacleScenario: (id) => runtime.runObstacleScenario(id),
    setLingerPenalty: (value) => runtime.setLingerPenalty(value),
    obstaclePresets: OBSTACLE_PRESETS,
    obstacleScenarios: OBSTACLE_SCENARIOS,
    selectionManager: runtime.selectionManager,
    getCellSize: () => runtime.grid?.cellSize,
    ...(uiOptions.actions || {}),
  };

  const simulationCallbacks = {
    requestFrame: () => runtime.requestFrame(),
    togglePause: () => runtime.togglePause(),
    onSettingChange: (key, value) => runtime.updateSetting(key, value),
  };

  let uiManager;

  if (headless) {
    uiManager = createHeadlessUiManager({
      ...uiOptions,
      selectionManager: runtime.selectionManager,
    });
  } else if (typeof uiOptions.createManager === 'function') {
    uiManager = uiOptions.createManager(simulationCallbacks, baseActions, {
      canvas: resolvedCanvas,
    });
  } else if (uiOptions.manager) {
    uiManager = uiOptions.manager;
  } else {
    uiManager = new UIManager(simulationCallbacks, uiOptions.mountSelector ?? '#app', baseActions, {
      canvasElement: resolvedCanvas,
      ...(uiOptions.layout || {}),
    });
  }

  if (win) {
    win.uiManager = uiManager;
  }

  let detachAdapter = () => {};

  if (!headless && uiManager) {
    detachAdapter = createUiAdapter({ runtime, uiManager });
  }

  const startPaused = Boolean(config.paused ?? false);

  if (autoStart) {
    runtime.start();
    if (startPaused) runtime.pause();
  } else if (startPaused) {
    runtime.pause();
  }

  return {
    engine: runtime,
    grid: runtime.grid,
    uiManager,
    eventManager: runtime.eventManager,
    stats: runtime.stats,
    selectionManager: runtime.selectionManager,
    start: () => runtime.start(),
    stop: () => runtime.stop(),
    step: (timestamp) => runtime.tick(timestamp),
    tick: (timestamp) => runtime.tick(timestamp),
    pause: () => runtime.pause(),
    resume: () => runtime.resume(),
    update: (timestamp) => runtime.tick(timestamp),
    destroy: () => {
      detachAdapter();
      rendererTeardown();
      runtime.stop();
    },
  };
}

export default createSimulation;

export { SimulationRuntime as SimulationEngine };
