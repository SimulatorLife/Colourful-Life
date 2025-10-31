import UIManager, { OVERLAY_TOGGLE_SETTERS } from "./uiManager.js";
import { createHeadlessUiManager } from "./headlessUiManager.js";
import { resolveSimulationDefaults } from "../config.js";
import { toPlainObject } from "../utils/object.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

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

  for (const [key, value] of Object.entries(sanitizedLayoutOverrides)) {
    if (overrideKeySet.has(key)) {
      continue;
    }

    if (!Object.is(value, sanitizedDefaults[key])) {
      initialSettings[key] = value;
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

function subscribeEngineToUi(engine, uiManager) {
  if (!engine || !uiManager) {
    return [];
  }

  const callUi = (methodName, args = [], context = UI_WARNING_CONTEXTS.state) =>
    invokeUiManagerMethod(uiManager, methodName, args, context);

  const syncUpdatesPerSecond = (changes) => {
    const nextValue = changes?.updatesPerSecond;

    if (nextValue !== undefined) {
      callUi(
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

    callUi(
      "setUpdatesPerSecond",
      [currentValue, { notify: false }],
      UI_WARNING_CONTEXTS.speed,
    );
  };

  return [
    engine.on?.("metrics", ({ stats, metrics, environment }) => {
      callUi(
        "renderMetrics",
        [stats, metrics, environment],
        UI_WARNING_CONTEXTS.metrics,
      );
    }),
    engine.on?.("leaderboard", ({ entries }) => {
      callUi("renderLeaderboard", [entries], UI_WARNING_CONTEXTS.leaderboard);
    }),
    engine.on?.("state", ({ changes }) => {
      if (changes?.paused !== undefined) {
        callUi("setPauseState", [changes.paused], UI_WARNING_CONTEXTS.state);
      }

      if (changes?.autoPauseOnBlur !== undefined) {
        callUi(
          "setAutoPauseOnBlur",
          [changes.autoPauseOnBlur, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.autoPausePending !== undefined) {
        callUi(
          "setAutoPausePending",
          [changes.autoPausePending],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.societySimilarity !== undefined) {
        callUi(
          "setSocietySimilarity",
          [changes.societySimilarity, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.enemySimilarity !== undefined) {
        callUi(
          "setEnemySimilarity",
          [changes.enemySimilarity, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.eventStrengthMultiplier !== undefined) {
        callUi(
          "setEventStrengthMultiplier",
          [changes.eventStrengthMultiplier, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.eventFrequencyMultiplier !== undefined) {
        callUi(
          "setEventFrequencyMultiplier",
          [changes.eventFrequencyMultiplier, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.densityEffectMultiplier !== undefined) {
        callUi(
          "setDensityEffectMultiplier",
          [changes.densityEffectMultiplier, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.energyRegenRate !== undefined) {
        callUi(
          "setEnergyRegenRate",
          [changes.energyRegenRate, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.energyDiffusionRate !== undefined) {
        callUi(
          "setEnergyDiffusionRate",
          [changes.energyDiffusionRate, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.mutationMultiplier !== undefined) {
        callUi(
          "setMutationMultiplier",
          [changes.mutationMultiplier, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.maxConcurrentEvents !== undefined) {
        callUi(
          "setMaxConcurrentEvents",
          [changes.maxConcurrentEvents, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.leaderboardIntervalMs !== undefined) {
        callUi(
          "setLeaderboardIntervalMs",
          [changes.leaderboardIntervalMs, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.lifeEventFadeTicks !== undefined) {
        callUi(
          "setLifeEventFadeTicks",
          [changes.lifeEventFadeTicks, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.lifeEventLimit !== undefined) {
        callUi(
          "setLifeEventLimit",
          [changes.lifeEventLimit, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      syncUpdatesPerSecond(changes);

      if (changes?.lowDiversityReproMultiplier !== undefined) {
        callUi(
          "setLowDiversityReproMultiplier",
          [changes.lowDiversityReproMultiplier, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.combatEdgeSharpness !== undefined) {
        callUi(
          "setCombatEdgeSharpness",
          [changes.combatEdgeSharpness, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.combatTerritoryEdgeFactor !== undefined) {
        callUi(
          "setCombatTerritoryEdgeFactor",
          [changes.combatTerritoryEdgeFactor, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes?.initialTileEnergyFraction !== undefined) {
        callUi(
          "setInitialTileEnergyFraction",
          [changes.initialTileEnergyFraction, { notify: false }],
          UI_WARNING_CONTEXTS.state,
        );
      }

      if (changes) {
        for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
          if (changes[overlayKey] !== undefined) {
            callUi(
              setterName,
              [changes[overlayKey], { notify: false }],
              UI_WARNING_CONTEXTS.overlay,
            );
          }
        }
      }

      const geometryChanged =
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

        callUi("setGridGeometry", [geometry], UI_WARNING_CONTEXTS.geometry);
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

    invokeUiManagerMethod(
      uiManager,
      "setPauseState",
      [engine?.isPaused?.()],
      UI_WARNING_CONTEXTS.initial,
    );
  }

  if (uiManager) {
    const lowDiversity = engine?.state?.lowDiversityReproMultiplier;

    if (typeof lowDiversity === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setLowDiversityReproMultiplier",
        [lowDiversity, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const sharpness = engine?.state?.combatEdgeSharpness;

    if (typeof sharpness === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setCombatEdgeSharpness",
        [sharpness, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const factor = engine?.state?.combatTerritoryEdgeFactor;

    if (typeof factor === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setCombatTerritoryEdgeFactor",
        [factor, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const pending = engine?.state?.autoPausePending;

    if (pending !== undefined) {
      invokeUiManagerMethod(
        uiManager,
        "setAutoPausePending",
        [Boolean(pending)],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const societySimilarity = engine?.state?.societySimilarity;

    if (typeof societySimilarity === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setSocietySimilarity",
        [societySimilarity, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const enemySimilarity = engine?.state?.enemySimilarity;

    if (typeof enemySimilarity === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setEnemySimilarity",
        [enemySimilarity, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const eventStrength = engine?.state?.eventStrengthMultiplier;

    if (typeof eventStrength === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setEventStrengthMultiplier",
        [eventStrength, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const eventFrequency = engine?.state?.eventFrequencyMultiplier;

    if (typeof eventFrequency === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setEventFrequencyMultiplier",
        [eventFrequency, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const densityMultiplier = engine?.state?.densityEffectMultiplier;

    if (typeof densityMultiplier === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setDensityEffectMultiplier",
        [densityMultiplier, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const energyRegen = engine?.state?.energyRegenRate;

    if (typeof energyRegen === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setEnergyRegenRate",
        [energyRegen, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const energyDiffusion = engine?.state?.energyDiffusionRate;

    if (typeof energyDiffusion === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setEnergyDiffusionRate",
        [energyDiffusion, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const mutationMultiplier = engine?.state?.mutationMultiplier;

    if (typeof mutationMultiplier === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setMutationMultiplier",
        [mutationMultiplier, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const maxConcurrentEvents = engine?.state?.maxConcurrentEvents;

    if (typeof maxConcurrentEvents === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setMaxConcurrentEvents",
        [maxConcurrentEvents, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    const leaderboardInterval = engine?.state?.leaderboardIntervalMs;

    if (typeof leaderboardInterval === "number") {
      invokeUiManagerMethod(
        uiManager,
        "setLeaderboardIntervalMs",
        [leaderboardInterval, { notify: false }],
        UI_WARNING_CONTEXTS.initial,
      );
    }
  }

  if (uiManager) {
    for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
      if (engine?.state?.[overlayKey] !== undefined) {
        invokeUiManagerMethod(
          uiManager,
          setterName,
          [engine.state[overlayKey], { notify: false }],
          UI_WARNING_CONTEXTS.initial,
        );
      }
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
