import UIManager from './uiManager.js';
import EventManager from './eventManager.js';
import Stats from './stats.js';
import GridManager, { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from './gridManager.js';
import SelectionManager from './selectionManager.js';
import { drawOverlays } from './overlays.js';
import { computeLeaderboard } from './leaderboard.js';
import BrainDebugger from './brainDebugger.js';
import {
  ENERGY_DIFFUSION_RATE_DEFAULT,
  ENERGY_REGEN_RATE_DEFAULT,
  UI_SLIDER_CONFIG,
} from './config.js';

const GLOBAL = typeof globalThis !== 'undefined' ? globalThis : {};

const defaultNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
};

const defaultRequestAnimationFrame = (cb) => setTimeout(() => cb(defaultNow()), 16);
const defaultCancelAnimationFrame = (id) => clearTimeout(id);

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

function resolveCanvas(canvas, documentRef) {
  if (canvas) return canvas;

  if (documentRef && typeof documentRef.getElementById === 'function') {
    return documentRef.getElementById('gameCanvas');
  }

  return null;
}

function ensureCanvasDimensions(canvas, config) {
  const candidates = [config?.width, config?.canvasWidth, config?.canvasSize?.width, canvas?.width];
  const heightCandidates = [
    config?.height,
    config?.canvasHeight,
    config?.canvasSize?.height,
    canvas?.height,
  ];

  const width = candidates.find((value) => typeof value === 'number');
  const height = heightCandidates.find((value) => typeof value === 'number');

  if (canvas && typeof width === 'number') canvas.width = width;
  if (canvas && typeof height === 'number') canvas.height = height;

  if (typeof canvas?.width === 'number' && typeof canvas?.height === 'number') {
    return { width: canvas.width, height: canvas.height };
  }

  if (typeof width === 'number' && typeof height === 'number') {
    return { width, height };
  }

  throw new Error('createSimulation requires canvas dimensions to be specified.');
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
  const resolvedCanvas = resolveCanvas(canvas, doc);

  if (!resolvedCanvas) {
    throw new Error('createSimulation requires a canvas element.');
  }

  const ctx = resolvedCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('createSimulation requires a 2D canvas context.');
  }

  const { width, height } = ensureCanvasDimensions(resolvedCanvas, config);
  const cellSize = config.cellSize ?? 5;
  const rows = config.rows ?? Math.floor(height / cellSize);
  const cols = config.cols ?? Math.floor(width / cellSize);

  const now = typeof injectedNow === 'function' ? injectedNow : defaultNow;
  const raf =
    typeof injectedRaf === 'function'
      ? injectedRaf
      : win && typeof win.requestAnimationFrame === 'function'
        ? win.requestAnimationFrame.bind(win)
        : defaultRequestAnimationFrame;
  const caf =
    typeof injectedCaf === 'function'
      ? injectedCaf
      : win && typeof win.cancelAnimationFrame === 'function'
        ? win.cancelAnimationFrame.bind(win)
        : defaultCancelAnimationFrame;

  const eventManager = new EventManager(rows, cols, rng);
  const stats = new Stats();
  const selectionManager = new SelectionManager(rows, cols);
  const grid = new GridManager(rows, cols, {
    eventManager,
    ctx,
    cellSize,
    stats,
    selectionManager,
  });

  if (win) {
    win.BrainDebugger = BrainDebugger;
    win.grid = grid;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

  let lastSnapshot = grid.getLastSnapshot();
  let pendingSlowUiUpdate = false;
  let lastMetrics = null;
  let lastUpdateTime = 0;
  let running = false;
  let frameHandle = null;

  const uiOptions = config.ui ?? {};
  const uiManager = headless
    ? createHeadlessUiManager({ ...uiOptions, selectionManager })
    : new UIManager(
        () => update(),
        uiOptions.mountSelector ?? '#app',
        {
          burst: () => grid.burstRandomCells({ count: 200, radius: 6 }),
          applyObstaclePreset: (id, options) => grid.applyObstaclePreset(id, options),
          runObstacleScenario: (id) => grid.runObstacleScenario(id),
          setLingerPenalty: (value) => grid.setLingerPenalty(value),
          obstaclePresets: OBSTACLE_PRESETS,
          obstacleScenarios: OBSTACLE_SCENARIOS,
          selectionManager,
          getCellSize: () => cellSize,
          ...(uiOptions.actions || {}),
        },
        {
          canvasElement: resolvedCanvas,
          ...(uiOptions.layout || {}),
        }
      );

  grid.setLingerPenalty(uiManager.getLingerPenalty?.() ?? 0);

  if (win) {
    win.uiManager = uiManager;
  }

  function scheduleNextFrame() {
    if (!running) return;
    frameHandle = raf((timestamp) => update(typeof timestamp === 'number' ? timestamp : now()));
  }

  function update(timestamp = now()) {
    if (!running) return;

    if (typeof uiManager.isPaused === 'function' && uiManager.isPaused()) {
      scheduleNextFrame();

      return;
    }

    const interval = 1000 / Math.max(1, uiManager.getUpdatesPerSecond?.() ?? 60);
    let tickOccurred = false;

    if (timestamp - lastUpdateTime >= interval) {
      lastUpdateTime = timestamp;
      tickOccurred = true;
      stats.resetTick();
      eventManager.updateEvent?.(uiManager.getEventFrequencyMultiplier?.() ?? 1, 2);
      const mutationMultiplier = uiManager.getMutationMultiplier?.() ?? 1;
      const snapshot = grid.update({
        densityEffectMultiplier: uiManager.getDensityEffectMultiplier?.() ?? 1,
        societySimilarity:
          uiManager.getSocietySimilarity?.() ?? UI_SLIDER_CONFIG.societySimilarity.default,
        enemySimilarity:
          uiManager.getEnemySimilarity?.() ?? UI_SLIDER_CONFIG.enemySimilarity.default,
        eventStrengthMultiplier: uiManager.getEventStrengthMultiplier?.() ?? 1,
        energyRegenRate: uiManager.getEnergyRegenRate?.() ?? ENERGY_REGEN_RATE_DEFAULT,
        energyDiffusionRate: uiManager.getEnergyDiffusionRate?.() ?? ENERGY_DIFFUSION_RATE_DEFAULT,
        mutationMultiplier,
      });

      lastSnapshot = snapshot;
      stats.logEvent?.(eventManager.currentEvent, uiManager.getEventStrengthMultiplier?.() ?? 1);
      stats.setMutationMultiplier?.(mutationMultiplier);
      const metrics = stats.updateFromSnapshot?.(snapshot);

      lastMetrics = metrics;
      pendingSlowUiUpdate = true;
    }

    grid.draw({ showObstacles: uiManager.getShowObstacles?.() ?? true });
    drawOverlays(grid, ctx, cellSize, {
      showEnergy: uiManager.getShowEnergy?.() ?? false,
      showDensity: uiManager.getShowDensity?.() ?? false,
      showFitness: uiManager.getShowFitness?.() ?? false,
      showObstacles: uiManager.getShowObstacles?.() ?? true,
      maxTileEnergy: GridManager.maxTileEnergy,
      snapshot: lastSnapshot,
      activeEvents: eventManager.activeEvents,
      getEventColor: eventManager.getColor?.bind(eventManager),
      mutationMultiplier: uiManager.getMutationMultiplier?.() ?? 1,
      selectionManager,
    });

    if (pendingSlowUiUpdate && uiManager.shouldRenderSlowUi?.(timestamp)) {
      if (lastMetrics && typeof uiManager.renderMetrics === 'function') {
        uiManager.renderMetrics(stats, lastMetrics);
      }
      if (typeof uiManager.renderLeaderboard === 'function') {
        const top = computeLeaderboard(lastSnapshot, 5);

        uiManager.renderLeaderboard(top);
      }
      pendingSlowUiUpdate = false;
    }

    scheduleNextFrame();

    return tickOccurred;
  }

  function start() {
    if (running) return;
    running = true;
    lastUpdateTime = 0;
    scheduleNextFrame();
  }

  function stop() {
    running = false;
    if (frameHandle != null) {
      caf(frameHandle);
      frameHandle = null;
    }
  }

  function step() {
    if (!running) {
      running = true;
      const result = update(now());

      running = false;

      return result;
    }

    return update(now());
  }

  if (autoStart) {
    start();
  }

  return {
    grid,
    uiManager,
    eventManager,
    stats,
    selectionManager,
    start,
    stop,
    step,
    update,
  };
}

export default createSimulation;
