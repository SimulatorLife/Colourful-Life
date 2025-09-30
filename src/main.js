import UIManager from "./uiManager.js";
import BrainDebugger from "./brainDebugger.js";
import SimulationEngine from "./simulationEngine.js";
import { OBSTACLE_PRESETS } from "./gridManager.js";
import { resolveSimulationDefaults } from "./config.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

function resolveHeadlessCanvasSize(config = {}) {
  const cellSize = Number.isFinite(config?.cellSize) ? config.cellSize : 5;
  const rowsFallback = Number.isFinite(config?.rows) ? config.rows : 120;
  const colsFallback = Number.isFinite(config?.cols) ? config.cols : 120;
  const widthCandidates = [
    config?.width,
    config?.canvasWidth,
    config?.canvasSize?.width,
    Number.isFinite(config?.cols) ? config.cols * cellSize : null,
  ];
  const heightCandidates = [
    config?.height,
    config?.canvasHeight,
    config?.canvasSize?.height,
    Number.isFinite(config?.rows) ? config.rows * cellSize : null,
  ];
  const fallbackWidth = colsFallback * cellSize;
  const fallbackHeight = rowsFallback * cellSize;
  const pickCandidate = (candidates, fallback) =>
    candidates.find((value) => Number.isFinite(value)) ?? fallback;

  return {
    width: pickCandidate(widthCandidates, fallbackWidth),
    height: pickCandidate(heightCandidates, fallbackHeight),
  };
}

function createHeadlessCanvas(config = {}) {
  const { width, height } = resolveHeadlessCanvasSize(config);
  const context = {
    canvas: null,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    save() {},
    restore() {},
    beginPath() {},
    stroke() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText() {},
    strokeText() {},
  };
  const canvas = {
    width,
    height,
    getContext(type) {
      if (type !== "2d") return null;

      return context;
    },
  };

  context.canvas = canvas;

  return canvas;
}

/**
 * Creates a lightweight {@link UIManager}-compatible adapter for environments
 * where no DOM-backed UI is available (e.g. tests, server-side rendering, or
 * custom render loops). The adapter mirrors the most important controls that
 * the visual UI exposes—pause state, update rates, event and mutation
 * multipliers, diversity settings, overlays (obstacles/energy/density/fitness),
 * linger penalty, and leaderboard cadence—so simulation code can interact with
 * shared settings consistently regardless of whether the real UI is mounted.
 *
 * The returned object implements a subset of {@link UIManager}'s surface area,
 * exposing getters and setters for the mirrored options plus a
 * `selectionManager` reference. Rendering hooks (`renderMetrics`,
 * `renderLeaderboard`) are provided as no-ops to satisfy consumers such as the
 * {@link SimulationEngine} when events are emitted.
 *
 * @param {Object} [options]
 * @param {boolean} [options.paused=false] Whether the simulation starts paused.
 * @param {number} [options.updatesPerSecond=60] Simulation tick frequency.
 * @param {number} [options.eventFrequencyMultiplier] Multiplier for event cadence.
 * @param {number} [options.mutationMultiplier] Mutation rate multiplier.
 * @param {number} [options.densityEffectMultiplier] Density impact multiplier.
 * @param {number} [options.societySimilarity] Preferred similarity for friendly agents.
 * @param {number} [options.enemySimilarity] Preferred similarity for hostile agents.
 * @param {number} [options.eventStrengthMultiplier] Event strength multiplier.
 * @param {number} [options.energyRegenRate] Baseline energy regeneration.
 * @param {number} [options.energyDiffusionRate] Ambient energy spread.
 * @param {number} [options.combatEdgeSharpness] Sharpness multiplier for combat odds.
 * @param {number} [options.matingDiversityThreshold] Genetic similarity tolerance for mating.
 * @param {number} [options.lowDiversityReproMultiplier] Reproduction multiplier applied when diversity is low.
 * @param {boolean} [options.showObstacles] Whether obstacle overlays are shown.
 * @param {boolean} [options.showEnergy] Whether energy overlays are shown.
 * @param {boolean} [options.showDensity] Whether population density overlays are shown.
 * @param {boolean} [options.showFitness] Whether fitness overlays are shown.
 * @param {number} [options.lingerPenalty] Penalty applied to agents that stay still.
 * @param {number} [options.leaderboardIntervalMs] Minimum time between leaderboard updates.
 * @param {Object} [options.selectionManager=null] Shared selection manager instance.
 * @returns {{
 *   isPaused: () => boolean,
 *   setPaused: (value: boolean) => void,
 *   getUpdatesPerSecond: () => number,
 *   setUpdatesPerSecond: (value: number) => void,
 *   getEventFrequencyMultiplier: () => number,
 *   getMutationMultiplier: () => number,
 *   getDensityEffectMultiplier: () => number,
 *   getSocietySimilarity: () => number,
 *   getEnemySimilarity: () => number,
 *   getEventStrengthMultiplier: () => number,
 *   getEnergyRegenRate: () => number,
 *   getEnergyDiffusionRate: () => number,
 *   getMatingDiversityThreshold: () => number,
 *   setMatingDiversityThreshold: (value: number) => void,
 *   getLowDiversityReproMultiplier: () => number,
 *   setLowDiversityReproMultiplier: (value: number) => void,
 *   getShowObstacles: () => boolean,
 *   getShowEnergy: () => boolean,
 *   getShowDensity: () => boolean,
 *   getShowFitness: () => boolean,
 *   shouldRenderSlowUi: (timestamp: number) => boolean,
 *   renderMetrics: Function,
 *   renderLeaderboard: Function,
 *   getLingerPenalty: () => number,
 *   setLingerPenalty: (value: number) => void,
 *   selectionManager: Object|null,
 * }} Headless UI facade that keeps simulation code agnostic to environment.
 */
function createHeadlessUiManager(options = {}) {
  const { selectionManager, ...overrides } = options || {};
  const defaults = resolveSimulationDefaults(overrides);
  const settings = { ...defaults };

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;
  const updateIfFinite = (key, value) => {
    if (!Number.isFinite(value)) return false;

    settings[key] = value;

    return true;
  };

  return {
    isPaused: () => settings.paused,
    setPaused: (value) => {
      settings.paused = Boolean(value);
    },
    getUpdatesPerSecond: () => settings.updatesPerSecond,
    setUpdatesPerSecond: (value) => {
      updateIfFinite("updatesPerSecond", value);
    },
    getEventFrequencyMultiplier: () => settings.eventFrequencyMultiplier,
    getMutationMultiplier: () => settings.mutationMultiplier,
    getDensityEffectMultiplier: () => settings.densityEffectMultiplier,
    getSocietySimilarity: () => settings.societySimilarity,
    getEnemySimilarity: () => settings.enemySimilarity,
    getEventStrengthMultiplier: () => settings.eventStrengthMultiplier,
    getCombatEdgeSharpness: () => settings.combatEdgeSharpness,
    getEnergyRegenRate: () => settings.energyRegenRate,
    getEnergyDiffusionRate: () => settings.energyDiffusionRate,
    getMatingDiversityThreshold: () => settings.matingDiversityThreshold,
    setMatingDiversityThreshold: (value) => {
      updateIfFinite("matingDiversityThreshold", value);
    },
    getLowDiversityReproMultiplier: () => settings.lowDiversityReproMultiplier,
    setLowDiversityReproMultiplier: (value) => {
      updateIfFinite("lowDiversityReproMultiplier", value);
    },
    setCombatEdgeSharpness: (value) => {
      updateIfFinite("combatEdgeSharpness", value);
    },
    getShowObstacles: () => settings.showObstacles,
    getShowEnergy: () => settings.showEnergy,
    getShowDensity: () => settings.showDensity,
    getShowFitness: () => settings.showFitness,
    shouldRenderSlowUi: (timestamp) => {
      if (!Number.isFinite(timestamp)) return false;
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
      updateIfFinite("lingerPenalty", value);
    },
    getAutoPauseOnBlur: () => settings.autoPauseOnBlur,
    setAutoPauseOnBlur: (value) => {
      settings.autoPauseOnBlur = Boolean(value);
    },
    selectionManager: selectionManager ?? null,
  };
}

/**
 * Bootstraps a {@link SimulationEngine} instance together with its associated
 * UI layer, returning a collection of helpers for controlling the lifecycle of
 * the simulation. Designed as the primary entry point for consumers embedding
 * the Colourful Life experience.
 *
 * The function accepts a single options object supporting:
 *
 * - `canvas` (`HTMLCanvasElement` | `OffscreenCanvas` | `null`): canvas to
 *   render into. If omitted, the {@link SimulationEngine} will create its own.
 * - `config` (`Object`): base configuration forwarded to the engine. Supports
 *   `config.ui` for {@link UIManager} overrides (e.g. `mountSelector`,
 *   `layout`, `actions`) and `config.paused` to start paused.
 * - `headless` (`boolean`, default `false`): create a headless UI adapter via
 *   {@link createHeadlessUiManager} instead of mounting the {@link UIManager}.
 * - `autoStart` (`boolean`, default `true`): whether to call `engine.start()`
 *   automatically. When `false`, the returned controller can start manually.
 * - `rng` (`Function`, default `Math.random`): random number generator injected
 *   into the {@link SimulationEngine}.
 * - `requestAnimationFrame` / `cancelAnimationFrame`: dependency injections for
 *   the browser timing APIs, useful for tests or custom environments.
 * - `performanceNow`: injected high-resolution timer compatible with
 *   `performance.now`.
 * - `window` / `document`: injected globals when not running in a browser.
 *
 * Defaults are applied using sensible fallbacks mirroring the browser runtime
 * (e.g. `Math.random`, `window.requestAnimationFrame`). When `config.ui` is
 * provided it is shallow-merged with internal actions so custom controls can be
 * exposed alongside the built-in presets for obstacles and selection tooling.
 *
 * The returned controller exposes both low-level engine references and high
 * level helpers:
 *
 * - `engine`: the underlying {@link SimulationEngine} instance.
 * - `grid`, `eventManager`, `stats`, `selectionManager`: convenience accessors
 *   to important subsystems.
 * - `uiManager`: either the mounted {@link UIManager} instance or the headless
 *   adapter.
 * - Lifecycle helpers: `start`, `stop`, `pause`, `resume`, `step`/`tick`/`update`.
 * - `destroy()`: cleans up subscriptions and stops the engine.
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement|OffscreenCanvas|null} [options.canvas]
 *   Canvas target for rendering.
 * @param {Object} [options.config={}] Configuration forwarded to the engine and
 *   UI. Supports `config.ui` for UI overrides and `config.paused` to begin
 *   paused.
 * @param {boolean} [options.headless=false] Use the headless UI adapter.
 * @param {boolean} [options.autoStart=true] Start the engine immediately.
 * @param {Function} [options.rng=Math.random] Random number generator.
 * @param {Function} [options.requestAnimationFrame]
 *   Custom RAF implementation.
 * @param {Function} [options.cancelAnimationFrame]
 *   Custom CAF implementation.
 * @param {Function} [options.performanceNow]
 *   Custom high resolution timer.
 * @param {Window} [options.window]
 *   Window-like object for attaching debugger/UI references.
 * @param {Document} [options.document]
 *   Document used by the {@link UIManager} when mounting.
 * @returns {{
 *   engine: SimulationEngine,
 *   grid: import('./gridManager.js').default,
 *   uiManager: ReturnType<typeof UIManager> | ReturnType<typeof createHeadlessUiManager>,
 *   eventManager: import('./eventManager.js').default,
 *   stats: import('./stats.js').default,
 *   selectionManager: import('./selectionManager.js').default,
 *   start: () => void,
 *   stop: () => void,
 *   step: (timestamp?: number) => void,
 *   tick: (timestamp?: number) => void,
 *   pause: () => void,
 *   resume: () => void,
 *   update: (timestamp?: number) => void,
 *   destroy: () => void,
 * }} Simulation controller composed of engine, UI, and lifecycle helpers.
 */
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
  const win = injectedWindow ?? (typeof window !== "undefined" ? window : undefined);

  if (win) {
    win.BrainDebugger = BrainDebugger;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

  let resolvedCanvas = canvas;

  if (headless && !resolvedCanvas) {
    resolvedCanvas = createHeadlessCanvas(config);
  }

  const engine = new SimulationEngine({
    canvas: resolvedCanvas,
    config,
    rng,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    window: injectedWindow,
    document: injectedDocument,
    autoStart: false,
    brainSnapshotCollector: BrainDebugger,
  });

  const uiOptions = config.ui ?? {};
  const baseActions = {
    burst: () => engine.burstRandomCells({ count: 200, radius: 6 }),
    applyObstaclePreset: (id, options) => engine.applyObstaclePreset(id, options),
    setLingerPenalty: (value) => engine.setLingerPenalty(value),
    obstaclePresets: OBSTACLE_PRESETS,
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
    ? createHeadlessUiManager({
        ...uiOptions,
        selectionManager: engine.selectionManager,
      })
    : new UIManager(
        simulationCallbacks,
        uiOptions.mountSelector ?? "#app",
        baseActions,
        {
          canvasElement: engine.canvas,
          ...(uiOptions.layout || {}),
        },
      );

  if (!headless) {
    uiManager.setPauseState?.(engine.isPaused());
  }

  if (win) {
    win.uiManager = uiManager;
  }

  if (typeof uiManager?.getLingerPenalty === "function") {
    engine.setLingerPenalty(uiManager.getLingerPenalty());
  }

  const unsubscribers = [];

  if (!headless && uiManager) {
    unsubscribers.push(
      engine.on("metrics", ({ stats, metrics }) => {
        if (typeof uiManager.renderMetrics === "function") {
          uiManager.renderMetrics(stats, metrics);
        }
      }),
    );

    unsubscribers.push(
      engine.on("leaderboard", ({ entries }) => {
        if (typeof uiManager.renderLeaderboard === "function") {
          uiManager.renderLeaderboard(entries);
        }
      }),
    );

    unsubscribers.push(
      engine.on("state", ({ changes }) => {
        if (
          changes?.paused !== undefined &&
          typeof uiManager.setPauseState === "function"
        ) {
          uiManager.setPauseState(changes.paused);
        }
        if (
          changes?.autoPauseOnBlur !== undefined &&
          typeof uiManager.setAutoPauseOnBlur === "function"
        ) {
          uiManager.setAutoPauseOnBlur(changes.autoPauseOnBlur);
        }
      }),
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

        if (typeof unsub === "function") unsub();
      }
      if (typeof engine.destroy === "function") {
        engine.destroy();
      } else {
        engine.stop();
      }
    },
  };
}

export default createSimulation;

export { SimulationEngine, createHeadlessUiManager };
