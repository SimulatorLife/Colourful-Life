import UIManager from './uiManager.js';
import BrainDebugger from './brainDebugger.js';
import SimulationEngine from './simulationEngine.js';
import { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from './gridManager.js';
import { resolveSimulationDefaults } from './config.js';

const GLOBAL = typeof globalThis !== 'undefined' ? globalThis : {};

function createHeadlessUiManager(options = {}) {
  const { selectionManager, ...overrides } = options || {};
  const defaults = resolveSimulationDefaults(overrides);
  const settings = { ...defaults };

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
    selectionManager: selectionManager ?? null,
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

  if (win) {
    win.BrainDebugger = BrainDebugger;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

  const engine = new SimulationEngine({
    canvas,
    config,
    rng,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    window: injectedWindow,
    document: injectedDocument,
    autoStart: false,
  });

  const uiOptions = config.ui ?? {};
  const baseActions = {
    burst: () => engine.burstRandomCells({ count: 200, radius: 6 }),
    applyObstaclePreset: (id, options) => engine.applyObstaclePreset(id, options),
    runObstacleScenario: (id) => engine.runObstacleScenario(id),
    setLingerPenalty: (value) => engine.setLingerPenalty(value),
    obstaclePresets: OBSTACLE_PRESETS,
    obstacleScenarios: OBSTACLE_SCENARIOS,
    selectionManager: engine.selectionManager,
    getCellSize: () => engine.cellSize,
    ...(uiOptions.actions || {}),
  };

  const simulationCallbacks = {
    requestFrame: () => engine.requestFrame(),
    togglePause: () => engine.togglePause(),
    onSettingChange: (key, value) => engine.updateSetting(key, value),
  };

  const uiManager = headless
    ? createHeadlessUiManager({ ...uiOptions, selectionManager: engine.selectionManager })
    : new UIManager(simulationCallbacks, uiOptions.mountSelector ?? '#app', baseActions, {
        canvasElement: engine.canvas,
        ...(uiOptions.layout || {}),
      });

  if (!headless) {
    uiManager.setPauseState?.(engine.isPaused());
  }

  if (win) {
    win.uiManager = uiManager;
  }

  if (typeof uiManager?.getLingerPenalty === 'function') {
    engine.setLingerPenalty(uiManager.getLingerPenalty());
  }

  const unsubscribers = [];

  if (!headless && uiManager) {
    unsubscribers.push(
      engine.on('metrics', ({ stats, metrics }) => {
        if (typeof uiManager.renderMetrics === 'function') {
          uiManager.renderMetrics(stats, metrics);
        }
      })
    );

    unsubscribers.push(
      engine.on('leaderboard', ({ entries }) => {
        if (typeof uiManager.renderLeaderboard === 'function') {
          uiManager.renderLeaderboard(entries);
        }
      })
    );

    unsubscribers.push(
      engine.on('state', ({ changes }) => {
        if (changes?.paused !== undefined && typeof uiManager.setPauseState === 'function') {
          uiManager.setPauseState(changes.paused);
        }
      })
    );
  }

  const startPaused = Boolean(config.paused ?? false);

  if (autoStart) {
    engine.start();
    if (startPaused) engine.pause();
  } else if (startPaused) {
    engine.pause();
  }

  return {
    engine,
    grid: engine.grid,
    uiManager,
    eventManager: engine.eventManager,
    stats: engine.stats,
    selectionManager: engine.selectionManager,
    start: () => engine.start(),
    stop: () => engine.stop(),
    step: (timestamp) => engine.tick(timestamp),
    tick: (timestamp) => engine.tick(timestamp),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    update: (timestamp) => engine.tick(timestamp),
    destroy: () => {
      while (unsubscribers.length) {
        const unsub = unsubscribers.pop();

        if (typeof unsub === 'function') unsub();
      }
      engine.stop();
    },
  };
}

export default createSimulation;

export { SimulationEngine, createHeadlessUiManager };
