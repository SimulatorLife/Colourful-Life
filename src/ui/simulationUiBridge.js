import UIManager, { OVERLAY_TOGGLE_SETTERS } from "./uiManager.js";
import { createHeadlessUiManager } from "./headlessUiManager.js";
import { resolveSimulationDefaults } from "../config.js";
import { toPlainObject } from "../utils/object.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

/**
 * @typedef {import("./headlessUiManager.js").HeadlessUiAdapter} HeadlessUiAdapter
 * @typedef {import("./headlessUiManager.js").HeadlessUiBridgeSurface} HeadlessUiBridgeSurface
 * @typedef {import("./headlessUiManager.js").HeadlessStateControlSurface} HeadlessStateControlSurface
 * @typedef {import("./headlessUiManager.js").HeadlessTelemetrySurface} HeadlessTelemetrySurface
 * @typedef {import("./headlessUiManager.js").HeadlessSelectionSurface} HeadlessSelectionSurface
 */

const DERIVED_LAYOUT_KEYS = Object.freeze({
  updatesPerSecond: ["speedMultiplier"],
  speedMultiplier: ["updatesPerSecond"],
});

function mergeLayoutInitialSettings({ sanitizedDefaults, layoutInitialSettings }) {
  const overrideKeys = Object.keys(layoutInitialSettings);

  if (overrideKeys.length === 0) {
    return { ...sanitizedDefaults };
  }

  const sanitizedLayoutOverrides = resolveSimulationDefaults(layoutInitialSettings);
  const overrideKeySet = new Set(overrideKeys);
  const initialSettings = { ...sanitizedDefaults };

  for (const key of overrideKeys) {
    if (Object.hasOwn(sanitizedLayoutOverrides, key)) {
      initialSettings[key] = sanitizedLayoutOverrides[key];
      continue;
    }

    initialSettings[key] = layoutInitialSettings[key];
  }

  for (const key of overrideKeys) {
    const derivedKeys = DERIVED_LAYOUT_KEYS[key];

    if (!derivedKeys) {
      continue;
    }

    for (const derivedKey of derivedKeys) {
      if (overrideKeySet.has(derivedKey)) {
        continue;
      }

      if (Object.hasOwn(sanitizedLayoutOverrides, derivedKey)) {
        initialSettings[derivedKey] = sanitizedLayoutOverrides[derivedKey];
      }
    }
  }

  return initialSettings;
}

function normalizeLayoutOptions({ engine, uiOptions = {}, sanitizedDefaults = {} }) {
  const normalizedUi = toPlainObject(uiOptions);
  const layoutConfig = toPlainObject(normalizedUi.layout);
  const sanitizedInitialSettings = toPlainObject(sanitizedDefaults);
  const layoutInitialSettings = toPlainObject(layoutConfig.initialSettings);
  const initialSettings = mergeLayoutInitialSettings({
    sanitizedDefaults: sanitizedInitialSettings,
    layoutInitialSettings,
  });

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
    }

    invokeSettingChange(
      simulationOnSettingChange,
      key,
      value,
      "Headless simulation onSettingChange callback",
    );

    invokeSettingChange(
      userOnSettingChange,
      key,
      value,
      "Headless UI onSettingChange callback",
    );
  };

  return mergedOptions;
}

const UI_WARNING_CONTEXTS = Object.freeze({
  metrics: "rendering metrics update",
  leaderboard: "rendering leaderboard update",
  state: "synchronizing engine state",
  initial: "initializing UI from engine snapshot",
  geometry: "applying grid geometry change",
  overlay: "synchronizing overlay toggle state",
  speed: "synchronizing updates-per-second control",
});

const DEFAULT_UI_WARNING_CONTEXT = "processing UI update";

function formatUiWarning(methodName, context = DEFAULT_UI_WARNING_CONTEXT) {
  const label =
    typeof methodName === "string" && methodName.length > 0
      ? methodName
      : "(anonymous)";
  const activity =
    typeof context === "string" && context.length > 0
      ? context
      : DEFAULT_UI_WARNING_CONTEXT;

  return `UI manager method "${label}" threw while ${activity}; ignoring failure.`;
}

function invokeUiManagerMethod(
  uiManager,
  methodName,
  args = [],
  context = UI_WARNING_CONTEXTS.state,
) {
  if (!uiManager || typeof methodName !== "string" || methodName.length === 0) {
    return undefined;
  }

  const method = uiManager[methodName];

  if (typeof method !== "function") {
    return undefined;
  }

  const message = formatUiWarning(methodName, context);

  return invokeWithErrorBoundary(method, args, {
    thisArg: uiManager,
    reporter: warnOnce,
    once: true,
    message,
  });
}

function createUpdatesPerSecondSynchronizer(engine, callControls) {
  return (changes) => {
    const nextValue = changes?.updatesPerSecond;

    if (nextValue !== undefined) {
      callControls(
        "setUpdatesPerSecond",
        [nextValue, { notify: false }],
        UI_WARNING_CONTEXTS.speed,
      );

      return;
    }

    if (changes?.speedMultiplier === undefined) {
      return;
    }

    const currentValue = Number.isFinite(engine?.state?.updatesPerSecond)
      ? engine.state.updatesPerSecond
      : undefined;

    if (currentValue === undefined) {
      return;
    }

    callControls(
      "setUpdatesPerSecond",
      [currentValue, { notify: false }],
      UI_WARNING_CONTEXTS.speed,
    );
  };
}

function createMetricsHandler(callTelemetry) {
  return ({ stats, metrics, environment }) =>
    callTelemetry(
      "renderMetrics",
      [stats, metrics, environment],
      UI_WARNING_CONTEXTS.metrics,
    );
}

function createLeaderboardHandler(callTelemetry) {
  return ({ entries }) =>
    callTelemetry("renderLeaderboard", [entries], UI_WARNING_CONTEXTS.leaderboard);
}

function propagateOverlayChanges(changes, callControls) {
  if (!changes) {
    return;
  }

  for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
    if (changes[overlayKey] === undefined) {
      continue;
    }

    callControls(
      setterName,
      [changes[overlayKey], { notify: false }],
      UI_WARNING_CONTEXTS.overlay,
    );
  }
}

function propagateGeometryChange({ changes, engine, callControls }) {
  const geometryChanged =
    changes &&
    (Object.hasOwn(changes, "gridRows") ||
      Object.hasOwn(changes, "gridCols") ||
      Object.hasOwn(changes, "cellSize"));

  if (!geometryChanged) {
    return;
  }

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

  callControls("setGridGeometry", [geometry], UI_WARNING_CONTEXTS.geometry);
}

function propagateStateChanges({
  changes,
  engine,
  callControls,
  syncUpdatesPerSecond,
}) {
  if (!changes || typeof changes !== "object") {
    return;
  }

  for (const { key, method, args = passThroughArgs } of STATE_CHANGE_HANDLERS) {
    if (changes[key] === undefined) {
      continue;
    }

    const methodArgs = typeof args === "function" ? args(changes[key]) : args;

    callControls(method, methodArgs, UI_WARNING_CONTEXTS.state);
  }

  syncUpdatesPerSecond(changes);
  propagateOverlayChanges(changes, callControls);
  propagateGeometryChange({ changes, engine, callControls });
}

function createStateChangeHandler({ engine, callControls, syncUpdatesPerSecond }) {
  return ({ changes }) =>
    propagateStateChanges({
      changes,
      engine,
      callControls,
      syncUpdatesPerSecond,
    });
}

/**
 * Wires simulation engine events to the provided UI surfaces.
 *
 * @param {import('../engine/simulationEngine.js').default} engine
 * @param {Object} surfaces
 * @param {import('./uiManager.js').default | HeadlessStateControlSurface} surfaces.controlSurface
 * @param {import('./uiManager.js').default | HeadlessTelemetrySurface} [surfaces.telemetrySurface]
 * @returns {Array<() => void>} Engine listener unsubscribe callbacks.
 */
function subscribeEngineToUi(
  engine,
  { controlSurface, telemetrySurface = controlSurface } = {},
) {
  if (!engine || !controlSurface) {
    return [];
  }

  const callControls = (methodName, args = [], context = UI_WARNING_CONTEXTS.state) =>
    invokeUiManagerMethod(controlSurface, methodName, args, context);
  const callTelemetry = (
    methodName,
    args = [],
    context = UI_WARNING_CONTEXTS.metrics,
  ) => invokeUiManagerMethod(telemetrySurface, methodName, args, context);
  const syncUpdatesPerSecond = createUpdatesPerSecondSynchronizer(engine, callControls);
  const handleMetrics = createMetricsHandler(callTelemetry);
  const handleLeaderboard = createLeaderboardHandler(callTelemetry);
  const handleStateChange = createStateChangeHandler({
    engine,
    callControls,
    syncUpdatesPerSecond,
  });

  return [
    engine.on?.("metrics", handleMetrics),
    engine.on?.("leaderboard", handleLeaderboard),
    engine.on?.("state", handleStateChange),
  ].filter(Boolean);
}

const isNumber = (value) => typeof value === "number";
const withNotifyFalse = (value) => [value, { notify: false }];
const passThroughArgs = (value) => [value];

const STATE_CHANGE_HANDLERS = [
  { key: "paused", method: "setPauseState", args: passThroughArgs },
  {
    key: "autoPauseOnBlur",
    method: "setAutoPauseOnBlur",
    args: withNotifyFalse,
  },
  { key: "autoPausePending", method: "setAutoPausePending", args: passThroughArgs },
  {
    key: "societySimilarity",
    method: "setSocietySimilarity",
    args: withNotifyFalse,
  },
  {
    key: "enemySimilarity",
    method: "setEnemySimilarity",
    args: withNotifyFalse,
  },
  {
    key: "eventStrengthMultiplier",
    method: "setEventStrengthMultiplier",
    args: withNotifyFalse,
  },
  {
    key: "eventFrequencyMultiplier",
    method: "setEventFrequencyMultiplier",
    args: withNotifyFalse,
  },
  {
    key: "densityEffectMultiplier",
    method: "setDensityEffectMultiplier",
    args: withNotifyFalse,
  },
  {
    key: "energyRegenRate",
    method: "setEnergyRegenRate",
    args: withNotifyFalse,
  },
  {
    key: "energyDiffusionRate",
    method: "setEnergyDiffusionRate",
    args: withNotifyFalse,
  },
  {
    key: "mutationMultiplier",
    method: "setMutationMultiplier",
    args: withNotifyFalse,
  },
  {
    key: "maxConcurrentEvents",
    method: "setMaxConcurrentEvents",
    args: withNotifyFalse,
  },
  {
    key: "leaderboardIntervalMs",
    method: "setLeaderboardIntervalMs",
    args: withNotifyFalse,
  },
  {
    key: "lifeEventFadeTicks",
    method: "setLifeEventFadeTicks",
    args: withNotifyFalse,
  },
  {
    key: "lifeEventLimit",
    method: "setLifeEventLimit",
    args: withNotifyFalse,
  },
  {
    key: "lowDiversityReproMultiplier",
    method: "setLowDiversityReproMultiplier",
    args: withNotifyFalse,
  },
  {
    key: "combatEdgeSharpness",
    method: "setCombatEdgeSharpness",
    args: withNotifyFalse,
  },
  {
    key: "combatTerritoryEdgeFactor",
    method: "setCombatTerritoryEdgeFactor",
    args: withNotifyFalse,
  },
  {
    key: "initialTileEnergyFraction",
    method: "setInitialTileEnergyFraction",
    args: withNotifyFalse,
  },
];

const INITIAL_STATE_SYNCERS = [
  {
    key: "lowDiversityReproMultiplier",
    method: "setLowDiversityReproMultiplier",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "combatEdgeSharpness",
    method: "setCombatEdgeSharpness",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "combatTerritoryEdgeFactor",
    method: "setCombatTerritoryEdgeFactor",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "autoPausePending",
    method: "setAutoPausePending",
    guard: (value) => value !== undefined,
    args: (value) => [Boolean(value)],
  },
  {
    key: "societySimilarity",
    method: "setSocietySimilarity",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "enemySimilarity",
    method: "setEnemySimilarity",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "eventStrengthMultiplier",
    method: "setEventStrengthMultiplier",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "eventFrequencyMultiplier",
    method: "setEventFrequencyMultiplier",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "densityEffectMultiplier",
    method: "setDensityEffectMultiplier",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "energyRegenRate",
    method: "setEnergyRegenRate",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "energyDiffusionRate",
    method: "setEnergyDiffusionRate",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "mutationMultiplier",
    method: "setMutationMultiplier",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "maxConcurrentEvents",
    method: "setMaxConcurrentEvents",
    guard: isNumber,
    args: withNotifyFalse,
  },
  {
    key: "leaderboardIntervalMs",
    method: "setLeaderboardIntervalMs",
    guard: isNumber,
    args: withNotifyFalse,
  },
];

/**
 * Replays the engine's persisted state into the UI surface so sliders and
 * toggles reflect the latest configuration before live updates resume.
 *
 * @param {import('../engine/simulationEngine.js').default} engine
 * @param {import('./uiManager.js').default | HeadlessStateControlSurface} uiManager
 */
function syncInitialStateToUi(engine, uiManager) {
  if (!uiManager || !engine?.state) {
    return;
  }

  for (const { key, method, guard, args } of INITIAL_STATE_SYNCERS) {
    const value = engine.state[key];

    if (!guard(value)) {
      continue;
    }

    const methodArgs = typeof args === "function" ? args(value) : [value];

    invokeUiManagerMethod(uiManager, method, methodArgs, UI_WARNING_CONTEXTS.initial);
  }

  for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
    if (engine.state[overlayKey] === undefined) {
      continue;
    }

    invokeUiManagerMethod(
      uiManager,
      setterName,
      [engine.state[overlayKey], { notify: false }],
      UI_WARNING_CONTEXTS.initial,
    );
  }
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
 * @param {import('../engine/simulationEngine.js').default} options.engine - Active
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
 *   uiManager: import('./uiManager.js').default |
 *     (HeadlessStateControlSurface & HeadlessTelemetrySurface & HeadlessSelectionSurface),
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

    invokeUiManagerMethod(
      uiManager,
      "setPauseState",
      [engine?.isPaused?.()],
      UI_WARNING_CONTEXTS.initial,
    );
  }

  syncInitialStateToUi(engine, uiManager);

  const unsubscribers = subscribeEngineToUi(engine, {
    controlSurface: uiManager,
    telemetrySurface: uiManager,
  });

  return {
    uiManager,
    unsubscribers,
    headlessOptions,
    layout,
  };
}

export default bindSimulationToUi;
