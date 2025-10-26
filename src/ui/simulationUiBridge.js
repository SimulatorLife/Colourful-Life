import UIManager from "./uiManager.js";
import { createHeadlessUiManager } from "./headlessUiManager.js";
import { toPlainObject } from "../utils/object.js";
import { invokeWithErrorBoundary } from "../utils/error.js";

function normalizeLayoutOptions({ engine, uiOptions = {}, sanitizedDefaults = {} }) {
  const normalizedUi = toPlainObject(uiOptions);
  const layoutConfig = toPlainObject(normalizedUi.layout);
  const initialSettings = {
    ...toPlainObject(layoutConfig.initialSettings),
    ...toPlainObject(sanitizedDefaults),
  };

  return {
    options: normalizedUi,
    layout: {
      ...layoutConfig,
      canvasElement: engine?.canvas ?? layoutConfig.canvasElement ?? null,
      initialSettings,
    },
  };
}

function createHeadlessOptions({
  engine,
  sanitizedDefaults = {},
  uiOptions = {},
  simulationCallbacks = {},
}) {
  const normalizedUi = toPlainObject(uiOptions);
  const mergedOptions = {
    ...sanitizedDefaults,
    ...normalizedUi,
    selectionManager: engine?.selectionManager ?? normalizedUi.selectionManager ?? null,
  };

  if (typeof mergedOptions.togglePause !== "function") {
    mergedOptions.togglePause =
      typeof simulationCallbacks.togglePause === "function"
        ? simulationCallbacks.togglePause
        : undefined;
  }
  if (typeof mergedOptions.pause !== "function") {
    mergedOptions.pause =
      typeof simulationCallbacks.pause === "function"
        ? simulationCallbacks.pause
        : undefined;
  }
  if (typeof mergedOptions.resume !== "function") {
    mergedOptions.resume =
      typeof simulationCallbacks.resume === "function"
        ? simulationCallbacks.resume
        : undefined;
  }
  const userOnSettingChange = mergedOptions.onSettingChange;
  const simulationOnSettingChange = simulationCallbacks.onSettingChange;

  const invokeSettingChange = (callback, key, value, context) =>
    invokeWithErrorBoundary(callback, [key, value], {
      message: (settingKey) =>
        `${context} threw while handling "${settingKey}" setting change; continuing without interruption.`,
      once: true,
    });

  mergedOptions.onSettingChange = (key, value) => {
    if (key === "updatesPerSecond") {
      engine?.setUpdatesPerSecond?.(value);
    } else {
      invokeSettingChange(
        simulationOnSettingChange,
        key,
        value,
        "Headless simulation onSettingChange callback",
      );
    }

    invokeSettingChange(
      userOnSettingChange,
      key,
      value,
      "Headless UI onSettingChange callback",
    );
  };

  return mergedOptions;
}

function subscribeEngineToUi(engine, uiManager) {
  if (!engine || !uiManager) {
    return [];
  }

  return [
    engine.on?.("metrics", ({ stats, metrics, environment }) => {
      if (typeof uiManager.renderMetrics === "function") {
        uiManager.renderMetrics(stats, metrics, environment);
      }
    }),
    engine.on?.("leaderboard", ({ entries }) => {
      if (typeof uiManager.renderLeaderboard === "function") {
        uiManager.renderLeaderboard(entries);
      }
    }),
    engine.on?.("state", ({ changes }) => {
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
        changes?.autoPausePending !== undefined &&
        typeof uiManager.setAutoPausePending === "function"
      ) {
        uiManager.setAutoPausePending(changes.autoPausePending);
      }

      if (typeof uiManager.setUpdatesPerSecond === "function") {
        if (changes?.updatesPerSecond !== undefined) {
          uiManager.setUpdatesPerSecond(changes.updatesPerSecond, { notify: false });
        } else if (changes?.speedMultiplier !== undefined) {
          const currentUpdates = Number.isFinite(engine?.state?.updatesPerSecond)
            ? engine.state.updatesPerSecond
            : undefined;

          if (currentUpdates !== undefined) {
            uiManager.setUpdatesPerSecond(currentUpdates, { notify: false });
          }
        }
      }

      if (
        changes?.lowDiversityReproMultiplier !== undefined &&
        typeof uiManager.setLowDiversityReproMultiplier === "function"
      ) {
        uiManager.setLowDiversityReproMultiplier(changes.lowDiversityReproMultiplier, {
          notify: false,
        });
      }

      if (
        changes?.initialTileEnergyFraction !== undefined &&
        typeof uiManager.setInitialTileEnergyFraction === "function"
      ) {
        uiManager.setInitialTileEnergyFraction(changes.initialTileEnergyFraction, {
          notify: false,
        });
      }

      const geometryChanged =
        typeof uiManager.setGridGeometry === "function" &&
        changes &&
        (Object.hasOwn(changes, "gridRows") ||
          Object.hasOwn(changes, "gridCols") ||
          Object.hasOwn(changes, "cellSize"));

      if (geometryChanged) {
        const geometry = {
          rows: Object.hasOwn(changes, "gridRows")
            ? changes.gridRows
            : Number.isFinite(engine?.rows)
              ? engine.rows
              : undefined,
          cols: Object.hasOwn(changes, "gridCols")
            ? changes.gridCols
            : Number.isFinite(engine?.cols)
              ? engine.cols
              : undefined,
          cellSize: Object.hasOwn(changes, "cellSize")
            ? changes.cellSize
            : Number.isFinite(engine?.cellSize)
              ? engine.cellSize
              : undefined,
        };

        uiManager.setGridGeometry(geometry);
      }
    }),
  ].filter(Boolean);
}

/**
 * Connects a {@link SimulationEngine} instance to either the browser UI or the
 * headless UI adapter, wiring metrics streams, leaderboard snapshots, and
 * state synchronisation in both directions.
 *
 * The helper normalises layout defaults, ensures headless consumers receive a
 * plain-object control surface with matching callbacks, and replays engine
 * state (pause toggle, auto-pause preference, low-diversity multiplier) back
 * into the UI on boot. When `headless` is false, the returned `uiManager`
 * exposes the mounted {@link UIManager}; otherwise it yields the plain-object
 * adapter produced by {@link createHeadlessUiManager}.
 *
 * @param {Object} options
 * @param {import('../simulationEngine.js').default} options.engine - Active
 *   simulation engine instance.
 * @param {Object} [options.uiOptions] - UI configuration overrides forwarded to
 *   either {@link UIManager} or the headless adapter.
 * @param {Object} [options.sanitizedDefaults] - Base defaults resolved from
 *   `config.ui.layout.initialSettings` and forwarded to the UI surface.
 * @param {Object} [options.baseActions] - Built-in action callbacks (pause,
 *   resume, reset) bound to the simulation.
 * @param {Object} [options.simulationCallbacks] - Hooks invoked when the UI
 *   emits events such as slider changes.
 * @param {boolean} [options.headless=false] - When true, return a headless
 *   control surface rather than mounting {@link UIManager}.
 * @returns {{
 *   uiManager: import('./uiManager.js').default | ReturnType<typeof createHeadlessUiManager>,
 *   unsubscribers: Array<() => void>,
 *   headlessOptions: Object|null,
 *   layout: Object,
 * }} Bridge context including the rendered/created UI manager and teardown hooks.
 */
export function bindSimulationToUi({
  engine,
  uiOptions = {},
  sanitizedDefaults = {},
  baseActions = {},
  simulationCallbacks = {},
  headless = false,
}) {
  const { options: normalizedUiOptions, layout } = normalizeLayoutOptions({
    engine,
    uiOptions,
    sanitizedDefaults,
  });

  let uiManager = null;
  let headlessOptions = null;

  if (headless) {
    headlessOptions = createHeadlessOptions({
      engine,
      sanitizedDefaults,
      uiOptions,
      simulationCallbacks,
    });
    uiManager = createHeadlessUiManager(headlessOptions);
  } else {
    uiManager = new UIManager(
      simulationCallbacks,
      normalizedUiOptions.mountSelector ?? "#app",
      baseActions,
      layout,
    );

    if (typeof uiManager.setPauseState === "function") {
      uiManager.setPauseState(engine?.isPaused?.());
    }
  }

  if (uiManager && typeof uiManager.setLowDiversityReproMultiplier === "function") {
    const lowDiversity = engine?.state?.lowDiversityReproMultiplier;

    if (typeof lowDiversity === "number") {
      uiManager.setLowDiversityReproMultiplier(lowDiversity, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setAutoPausePending === "function") {
    const pending = engine?.state?.autoPausePending;

    if (pending !== undefined) {
      uiManager.setAutoPausePending(Boolean(pending));
    }
  }

  const unsubscribers = subscribeEngineToUi(engine, uiManager);

  return {
    uiManager,
    unsubscribers,
    headlessOptions,
    layout,
  };
}

export default bindSimulationToUi;
