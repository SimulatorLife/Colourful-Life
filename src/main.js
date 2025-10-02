import UIManager from "./ui/uiManager.js";
import BrainDebugger from "./ui/brainDebugger.js";
import SimulationEngine from "./simulationEngine.js";
import SelectionManager from "./grid/selectionManager.js";
import { drawOverlays as defaultDrawOverlays } from "./ui/overlays.js";
import { createHeadlessUiManager } from "./ui/headlessUiManager.js";
import { resolveSimulationDefaults } from "./config.js";
import { toPlainObject, toFiniteNumber } from "./utils.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

function resolveHeadlessCanvasSize(config = {}) {
  const toFinite = (value) => toFiniteNumber(value, { fallback: null });

  const cellSize = toFinite(config?.cellSize) ?? 5;
  const rows = toFinite(config?.rows);
  const cols = toFinite(config?.cols);
  const defaultWidth = (cols ?? 120) * cellSize;
  const defaultHeight = (rows ?? 120) * cellSize;
  const pickFirstFinite = (candidates, fallback) => {
    for (const candidate of candidates) {
      const normalized = toFinite(candidate);

      if (normalized != null) {
        return normalized;
      }
    }

    return fallback;
  };

  return {
    width: pickFirstFinite(
      [
        toFinite(config?.width),
        toFinite(config?.canvasWidth),
        toFinite(config?.canvasSize?.width),
        cols != null ? cols * cellSize : null,
      ],
      defaultWidth,
    ),
    height: pickFirstFinite(
      [
        toFinite(config?.height),
        toFinite(config?.canvasHeight),
        toFinite(config?.canvasSize?.height),
        rows != null ? rows * cellSize : null,
      ],
      defaultHeight,
    ),
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
 * - `resetWorld(options)`: clears the grid, reseeds organisms, and refreshes stats.
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
 *   grid: import('./grid/gridManager.js').default,
 *   uiManager: ReturnType<typeof UIManager> | ReturnType<typeof createHeadlessUiManager>,
 *   eventManager: import('./events/eventManager.js').default,
 *   stats: import('./stats.js').default,
 *   selectionManager: import('./grid/selectionManager.js').default,
 *   start: () => void,
 *   stop: () => void,
 *   step: (timestamp?: number) => void,
 *   tick: (timestamp?: number) => void,
 *   pause: () => void,
 *   resume: () => void,
 *   update: (timestamp?: number) => void,
 *   resetWorld: (options?: Record<string, any>) => void,
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

  config = toPlainObject(config);
  const layoutInitialSettings = toPlainObject(config?.ui?.layout?.initialSettings);
  const configWithLayoutDefaults = { ...layoutInitialSettings, ...config };

  if (win) {
    win.BrainDebugger = BrainDebugger;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

  let resolvedCanvas = canvas;

  if (headless && !resolvedCanvas) {
    resolvedCanvas = createHeadlessCanvas(configWithLayoutDefaults);
  }

  const selectionManagerFactory =
    typeof configWithLayoutDefaults.selectionManagerFactory === "function"
      ? configWithLayoutDefaults.selectionManagerFactory
      : (rows, cols) => new SelectionManager(rows, cols);
  const overlayRenderer =
    typeof configWithLayoutDefaults.drawOverlays === "function"
      ? configWithLayoutDefaults.drawOverlays
      : defaultDrawOverlays;

  const sanitizedDefaults = resolveSimulationDefaults(configWithLayoutDefaults);

  const engine = new SimulationEngine({
    canvas: resolvedCanvas,
    config: configWithLayoutDefaults,
    rng,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    window: injectedWindow,
    document: injectedDocument,
    autoStart: false,
    brainSnapshotCollector: BrainDebugger,
    drawOverlays: overlayRenderer,
    selectionManagerFactory,
  });

  const uiOptions = config.ui ?? {};
  const userLayout = toPlainObject(uiOptions.layout);
  const mergedInitialSettings = {
    ...sanitizedDefaults,
    ...toPlainObject(userLayout.initialSettings),
  };
  const uiLayoutOptions = {
    canvasElement: engine.canvas,
    ...userLayout,
    initialSettings: mergedInitialSettings,
  };
  const baseActions = {
    burst: () => engine.burstRandomCells({ count: 200, radius: 6 }),
    applyObstaclePreset: (id, options) => engine.applyObstaclePreset(id, options),
    obstaclePresets: engine.obstaclePresets,
    getCurrentObstaclePreset: () => engine.getCurrentObstaclePreset(),
    selectionManager: engine.selectionManager,
    getCellSize: () => engine.cellSize,
    getGridDimensions: () => ({ rows: engine.rows, cols: engine.cols }),
    setWorldGeometry: (geometry) => engine.setWorldGeometry(geometry),
    ...(uiOptions.actions || {}),
  };

  const simulationCallbacks = {
    requestFrame: () => engine.requestFrame(),
    togglePause: () => engine.togglePause(),
    step: () => engine.step(),
    onSettingChange: (key, value) => engine.updateSetting(key, value),
    resetWorld: (options) => engine.resetWorld(options),
  };

  let headlessOptions = null;

  if (headless) {
    headlessOptions = {
      ...sanitizedDefaults,
      ...uiOptions,
      selectionManager: engine.selectionManager,
    };
    const userOnSettingChange = headlessOptions.onSettingChange;

    headlessOptions.onSettingChange = (key, value) => {
      if (key === "updatesPerSecond") {
        engine.setUpdatesPerSecond(value);
      } else if (typeof simulationCallbacks.onSettingChange === "function") {
        simulationCallbacks.onSettingChange(key, value);
      }
      if (typeof userOnSettingChange === "function") {
        userOnSettingChange(key, value);
      }
    };
  }

  const uiManager = headless
    ? createHeadlessUiManager(headlessOptions)
    : new UIManager(
        simulationCallbacks,
        uiOptions.mountSelector ?? "#app",
        baseActions,
        uiLayoutOptions,
      );

  if (!headless) {
    uiManager.setPauseState?.(engine.isPaused());
  }

  if (win) {
    win.uiManager = uiManager;
  }

  const syncLowDiversity = engine.state?.lowDiversityReproMultiplier;

  if (
    typeof syncLowDiversity === "number" &&
    typeof uiManager?.setLowDiversityReproMultiplier === "function"
  ) {
    uiManager.setLowDiversityReproMultiplier(syncLowDiversity, { notify: false });
  }

  const unsubscribers = [];

  if (!headless && uiManager) {
    unsubscribers.push(
      engine.on("metrics", ({ stats, metrics, environment }) => {
        if (typeof uiManager.renderMetrics === "function") {
          uiManager.renderMetrics(stats, metrics, environment);
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
          uiManager.setAutoPauseOnBlur(changes.autoPauseOnBlur, { notify: false });
        }
        if (
          changes?.lowDiversityReproMultiplier !== undefined &&
          typeof uiManager.setLowDiversityReproMultiplier === "function"
        ) {
          uiManager.setLowDiversityReproMultiplier(
            changes.lowDiversityReproMultiplier,
            { notify: false },
          );
        }
      }),
    );
  }

  const startPaused = Boolean(sanitizedDefaults.paused);

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
    step: (timestamp) => engine.step(timestamp),
    tick: (timestamp) => engine.tick(timestamp),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    update: (timestamp) => engine.tick(timestamp),
    resetWorld: (options) => engine.resetWorld(options),
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
