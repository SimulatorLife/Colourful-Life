import BrainDebugger from "./ui/brainDebugger.js";
import SimulationEngine from "./simulationEngine.js";
import SelectionManager from "./grid/selectionManager.js";
import { drawOverlays as defaultDrawOverlays } from "./ui/overlays.js";
import { bindSimulationToUi } from "./ui/simulationUiBridge.js";
import { resolveSimulationDefaults } from "./config.js";
import { toPlainObject } from "./utils.js";
import {
  createHeadlessCanvas,
  resolveHeadlessCanvasSize,
} from "./engine/environment.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

/**
 * Derives width/height overrides for headless canvases so both the generated
 * canvas and simulation config stay in sync. Returns `null` when no positive
 * dimensions are supplied by the resolver.
 */
function buildHeadlessCanvasOverrides(config, size) {
  if (!size) return null;

  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : null;
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : null;

  if (width == null && height == null) {
    return null;
  }

  const canvasSize = { ...toPlainObject(config?.canvasSize) };

  if (width != null) {
    canvasSize.width = width;
  }

  if (height != null) {
    canvasSize.height = height;
  }

  const overrides = {
    canvasSize,
  };

  if (width != null) {
    overrides.width = width;
    overrides.canvasWidth = width;
  }

  if (height != null) {
    overrides.height = height;
    overrides.canvasHeight = height;
  }

  return overrides;
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
 *   `config.initialTileEnergyFraction` can be provided to set the fraction of
 *   the tile energy cap applied to empty tiles during world resets and
 *   constructor seeding. The value is clamped to the 0..1 range and defaults to
 *   0.5.
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
  brainSnapshotCollector: injectedBrainSnapshotCollector,
} = {}) {
  const win = injectedWindow ?? (typeof window !== "undefined" ? window : undefined);

  config = toPlainObject(config);
  const layoutInitialSettings = toPlainObject(config?.ui?.layout?.initialSettings);
  let configWithLayoutDefaults = { ...layoutInitialSettings, ...config };

  if (win) {
    win.BrainDebugger = BrainDebugger;
  } else {
    GLOBAL.BrainDebugger = BrainDebugger;
  }

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

  if (createdHeadlessCanvas && headlessOverrides) {
    configWithLayoutDefaults = {
      ...configWithLayoutDefaults,
      ...headlessOverrides,
    };
  }

  const selectionManagerFactory =
    typeof configWithLayoutDefaults.selectionManagerFactory === "function"
      ? configWithLayoutDefaults.selectionManagerFactory
      : (rows, cols) => new SelectionManager(rows, cols);
  const overlayRenderer =
    typeof configWithLayoutDefaults.drawOverlays === "function"
      ? configWithLayoutDefaults.drawOverlays
      : defaultDrawOverlays;
  const brainSnapshotCollector =
    injectedBrainSnapshotCollector !== undefined
      ? injectedBrainSnapshotCollector
      : configWithLayoutDefaults.brainSnapshotCollector;
  const resolvedBrainSnapshotCollector =
    brainSnapshotCollector === undefined ? BrainDebugger : brainSnapshotCollector;

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
    brainSnapshotCollector: resolvedBrainSnapshotCollector,
    drawOverlays: overlayRenderer,
    selectionManagerFactory,
  });

  const uiOptions = config.ui ?? {};
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
      if (uiManager && typeof uiManager.destroy === "function") {
        uiManager.destroy();
      }
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

export { SimulationEngine };
export { createHeadlessUiManager } from "./ui/headlessUiManager.js";
