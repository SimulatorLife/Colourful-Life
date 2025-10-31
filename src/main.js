import SimulationEngine from "./engine/simulationEngine.js";
import SelectionManager from "./grid/selectionManager.js";
import { drawOverlays as defaultDrawOverlays } from "./ui/overlays.js";
import { bindSimulationToUi } from "./ui/simulationUiBridge.js";
import { resolveSimulationDefaults } from "./config.js";
import { toPlainObject } from "./utils/object.js";
import { warnOnce, invokeWithErrorBoundary } from "./utils/error.js";

const DESTROY_WARNINGS = Object.freeze({
  uiDestroy: "UI manager destroy handler threw; continuing cleanup.",
  unsubscribe: "Simulation cleanup handler threw during destroy; continuing cleanup.",
  engineDestroy:
    "Simulation engine destroy handler threw; attempting graceful shutdown.",
  engineStop: "Simulation engine stop handler threw; shutdown may be incomplete.",
});

import {
  buildHeadlessCanvasOverrides,
  createHeadlessCanvas,
  resolveHeadlessCanvasSize,
} from "./engine/environment.js";

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
 *   `config.initialTileEnergyFraction` can be provided to set the fraction of
 *   the tile energy cap applied to empty tiles during world resets and
 *   constructor seeding. The value is clamped to the 0..1 range and defaults to
 *   0.5.
 * - `defaultCanvasId` (`string`, default `"gameCanvas"`): identifier used when
 *   resolving a fallback canvas from the document.
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
 * - `resetWorld(options)`: clears the grid and refreshes stats. Pass `reseed: true`
 *   to perform a fresh initial seeding.
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
 *   stats: import('./stats/index.js').default,
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
  defaultCanvasId,
} = {}) {
  const win = injectedWindow ?? (typeof window !== "undefined" ? window : undefined);

  config = toPlainObject(config);
  const layoutInitialSettings = toPlainObject(config?.ui?.layout?.initialSettings);
  // Apply layout-provided defaults last so UI initial settings and engine state stay aligned.
  let configWithLayoutDefaults = { ...config, ...layoutInitialSettings };

  let resolvedCanvas = canvas;
  const headlessCanvasSize = headless
    ? resolveHeadlessCanvasSize(configWithLayoutDefaults)
    : null;
  const headlessOverrides = headless
    ? buildHeadlessCanvasOverrides(configWithLayoutDefaults, headlessCanvasSize)
    : null;
  let createdHeadlessCanvas = false;

  if (headless && !resolvedCanvas) {
    const canvasConfig = headlessOverrides
      ? { ...configWithLayoutDefaults, ...headlessOverrides }
      : configWithLayoutDefaults;

    resolvedCanvas = createHeadlessCanvas(canvasConfig);
    createdHeadlessCanvas = true;
  }

  if (headlessOverrides) {
    const hasPositiveDimension = (value) => Number.isFinite(value) && value > 0;
    const canvasHasSize =
      resolvedCanvas &&
      hasPositiveDimension(resolvedCanvas.width) &&
      hasPositiveDimension(resolvedCanvas.height);

    if (createdHeadlessCanvas || !canvasHasSize) {
      configWithLayoutDefaults = {
        ...configWithLayoutDefaults,
        ...headlessOverrides,
      };
    }
  }

  const providedSelectionManager =
    configWithLayoutDefaults.selectionManager != null &&
    typeof configWithLayoutDefaults.selectionManager === "object"
      ? configWithLayoutDefaults.selectionManager
      : undefined;
  const selectionManagerFactory =
    typeof configWithLayoutDefaults.selectionManagerFactory === "function"
      ? configWithLayoutDefaults.selectionManagerFactory
      : (rows, cols) => new SelectionManager(rows, cols);
  const overlayRenderer =
    typeof configWithLayoutDefaults.drawOverlays === "function"
      ? configWithLayoutDefaults.drawOverlays
      : defaultDrawOverlays;

  const sanitizedDefaults = resolveSimulationDefaults(configWithLayoutDefaults);

  const engineConfig = { ...configWithLayoutDefaults };

  if (Object.hasOwn(engineConfig, "selectionManager")) {
    delete engineConfig.selectionManager;
  }

  const engine = new SimulationEngine({
    canvas: resolvedCanvas,
    config: engineConfig,
    rng,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    window: injectedWindow,
    document: injectedDocument,
    autoStart: false,
    drawOverlays: overlayRenderer,
    selectionManager: providedSelectionManager,
    selectionManagerFactory,
    defaultCanvasId,
  });

  const uiOptions = config.ui ?? {};
  const baseActions = {
    burst: (options = {}) => {
      const { count = 200, radius = 6 } = options;

      return engine.burstRandomCells({ count, radius });
    },
    applyObstaclePreset: (id, options) => engine.applyObstaclePreset(id, options),
    obstaclePresets: engine.obstaclePresets,
    getCurrentObstaclePreset: () => engine.getCurrentObstaclePreset(),
    selectionManager: engine.selectionManager,
    getCellSize: () => engine.cellSize,
    getGridDimensions: () => ({
      rows: engine.rows,
      cols: engine.cols,
      cellSize: engine.cellSize,
    }),
    setWorldGeometry: (geometry) => engine.setWorldGeometry(geometry),
    ...(uiOptions.actions || {}),
  };

  const simulationCallbacks = {
    requestFrame: () => engine.requestFrame(),
    togglePause: () => engine.togglePause(),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    step: () => engine.step(),
    onSettingChange: (key, value) => engine.updateSetting(key, value),
    resetWorld: (options) => engine.resetWorld(options),
  };

  const { uiManager, unsubscribers: uiUnsubscribers } = bindSimulationToUi({
    engine,
    uiOptions,
    sanitizedDefaults,
    baseActions,
    simulationCallbacks,
    headless,
  });

  if (win) {
    win.uiManager = uiManager;
  }

  const unsubscribers = Array.isArray(uiUnsubscribers) ? [...uiUnsubscribers] : [];

  const startPaused = Boolean(sanitizedDefaults.paused);

  if (autoStart) {
    engine.start();
    if (startPaused) engine.pause();
  } else if (engine.isPaused() !== startPaused) {
    engine.setPaused(startPaused);
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
    update: (timestamp) => engine.tick(timestamp),
    pause: () => engine.pause(),
    resume: () => engine.resume(),
    resetWorld: (options) => engine.resetWorld(options),
    destroy: () => {
      if (uiManager && typeof uiManager.destroy === "function") {
        invokeWithErrorBoundary(uiManager.destroy, [], {
          thisArg: uiManager,
          reporter: warnOnce,
          once: true,
          message: DESTROY_WARNINGS.uiDestroy,
        });
      }
      const unsubscribeFns = unsubscribers.splice(0).reverse();

      unsubscribeFns.forEach((unsubscribe) => {
        if (typeof unsubscribe !== "function") {
          return;
        }

        invokeWithErrorBoundary(unsubscribe, [], {
          reporter: warnOnce,
          once: true,
          message: DESTROY_WARNINGS.unsubscribe,
        });
      });
      if (typeof engine.destroy === "function") {
        invokeWithErrorBoundary(engine.destroy, [], {
          thisArg: engine,
          reporter: warnOnce,
          once: true,
          message: DESTROY_WARNINGS.engineDestroy,
        });
      } else if (typeof engine.stop === "function") {
        invokeWithErrorBoundary(engine.stop, [], {
          thisArg: engine,
          reporter: warnOnce,
          once: true,
          message: DESTROY_WARNINGS.engineStop,
        });
      }
    },
  };
}

export default createSimulation;

export { SimulationEngine };
export { createHeadlessUiManager } from "./ui/headlessUiManager.js";
