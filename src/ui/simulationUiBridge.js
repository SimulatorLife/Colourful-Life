import UIManager, { OVERLAY_TOGGLE_SETTERS } from "./uiManager.js";
import { createHeadlessUiManager } from "./headlessUiManager.js";
import { toPlainObject } from "../utils/object.js";
import { invokeWithErrorBoundary } from "../utils/error.js";

function normalizeLayoutOptions({ engine, uiOptions = {}, sanitizedDefaults = {} }) {
  const normalizedUi = toPlainObject(uiOptions);
  const layoutConfig = toPlainObject(normalizedUi.layout);
  const sanitizedInitialSettings = toPlainObject(sanitizedDefaults);
  const layoutInitialSettings = toPlainObject(layoutConfig.initialSettings);
  const initialSettings = {
    ...sanitizedInitialSettings,
    ...layoutInitialSettings,
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

  const syncUpdatesPerSecond = (changes) => {
    if (typeof uiManager.setUpdatesPerSecond !== "function") {
      return;
    }

    const nextValue = changes?.updatesPerSecond;

    if (nextValue !== undefined) {
      uiManager.setUpdatesPerSecond(nextValue, { notify: false });

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

    uiManager.setUpdatesPerSecond(currentValue, { notify: false });
  };

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

      if (
        changes?.societySimilarity !== undefined &&
        typeof uiManager.setSocietySimilarity === "function"
      ) {
        uiManager.setSocietySimilarity(changes.societySimilarity, { notify: false });
      }

      if (
        changes?.enemySimilarity !== undefined &&
        typeof uiManager.setEnemySimilarity === "function"
      ) {
        uiManager.setEnemySimilarity(changes.enemySimilarity, { notify: false });
      }

      if (
        changes?.eventStrengthMultiplier !== undefined &&
        typeof uiManager.setEventStrengthMultiplier === "function"
      ) {
        uiManager.setEventStrengthMultiplier(changes.eventStrengthMultiplier, {
          notify: false,
        });
      }

      if (
        changes?.eventFrequencyMultiplier !== undefined &&
        typeof uiManager.setEventFrequencyMultiplier === "function"
      ) {
        uiManager.setEventFrequencyMultiplier(changes.eventFrequencyMultiplier, {
          notify: false,
        });
      }

      if (
        changes?.densityEffectMultiplier !== undefined &&
        typeof uiManager.setDensityEffectMultiplier === "function"
      ) {
        uiManager.setDensityEffectMultiplier(changes.densityEffectMultiplier, {
          notify: false,
        });
      }

      if (
        changes?.energyRegenRate !== undefined &&
        typeof uiManager.setEnergyRegenRate === "function"
      ) {
        uiManager.setEnergyRegenRate(changes.energyRegenRate, { notify: false });
      }

      if (
        changes?.energyDiffusionRate !== undefined &&
        typeof uiManager.setEnergyDiffusionRate === "function"
      ) {
        uiManager.setEnergyDiffusionRate(changes.energyDiffusionRate, {
          notify: false,
        });
      }

      if (
        changes?.mutationMultiplier !== undefined &&
        typeof uiManager.setMutationMultiplier === "function"
      ) {
        uiManager.setMutationMultiplier(changes.mutationMultiplier, { notify: false });
      }

      if (
        changes?.leaderboardIntervalMs !== undefined &&
        typeof uiManager.setLeaderboardIntervalMs === "function"
      ) {
        uiManager.setLeaderboardIntervalMs(changes.leaderboardIntervalMs, {
          notify: false,
        });
      }

      if (
        changes?.lifeEventFadeTicks !== undefined &&
        typeof uiManager.setLifeEventFadeTicks === "function"
      ) {
        uiManager.setLifeEventFadeTicks(changes.lifeEventFadeTicks, { notify: false });
      }

      syncUpdatesPerSecond(changes);

      if (
        changes?.lowDiversityReproMultiplier !== undefined &&
        typeof uiManager.setLowDiversityReproMultiplier === "function"
      ) {
        uiManager.setLowDiversityReproMultiplier(changes.lowDiversityReproMultiplier, {
          notify: false,
        });
      }

      if (
        changes?.combatEdgeSharpness !== undefined &&
        typeof uiManager.setCombatEdgeSharpness === "function"
      ) {
        uiManager.setCombatEdgeSharpness(changes.combatEdgeSharpness, {
          notify: false,
        });
      }

      if (
        changes?.combatTerritoryEdgeFactor !== undefined &&
        typeof uiManager.setCombatTerritoryEdgeFactor === "function"
      ) {
        uiManager.setCombatTerritoryEdgeFactor(changes.combatTerritoryEdgeFactor, {
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

      if (changes) {
        for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
          if (
            changes[overlayKey] !== undefined &&
            typeof uiManager[setterName] === "function"
          ) {
            uiManager[setterName](changes[overlayKey], { notify: false });
          }
        }
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

  if (uiManager && typeof uiManager.setCombatEdgeSharpness === "function") {
    const sharpness = engine?.state?.combatEdgeSharpness;

    if (typeof sharpness === "number") {
      uiManager.setCombatEdgeSharpness(sharpness, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setCombatTerritoryEdgeFactor === "function") {
    const factor = engine?.state?.combatTerritoryEdgeFactor;

    if (typeof factor === "number") {
      uiManager.setCombatTerritoryEdgeFactor(factor, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setAutoPausePending === "function") {
    const pending = engine?.state?.autoPausePending;

    if (pending !== undefined) {
      uiManager.setAutoPausePending(Boolean(pending));
    }
  }

  if (uiManager && typeof uiManager.setSocietySimilarity === "function") {
    const similarity = engine?.state?.societySimilarity;

    if (typeof similarity === "number") {
      uiManager.setSocietySimilarity(similarity, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setEnemySimilarity === "function") {
    const similarity = engine?.state?.enemySimilarity;

    if (typeof similarity === "number") {
      uiManager.setEnemySimilarity(similarity, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setEventStrengthMultiplier === "function") {
    const strength = engine?.state?.eventStrengthMultiplier;

    if (typeof strength === "number") {
      uiManager.setEventStrengthMultiplier(strength, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setEventFrequencyMultiplier === "function") {
    const frequency = engine?.state?.eventFrequencyMultiplier;

    if (typeof frequency === "number") {
      uiManager.setEventFrequencyMultiplier(frequency, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setDensityEffectMultiplier === "function") {
    const density = engine?.state?.densityEffectMultiplier;

    if (typeof density === "number") {
      uiManager.setDensityEffectMultiplier(density, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setEnergyRegenRate === "function") {
    const regen = engine?.state?.energyRegenRate;

    if (typeof regen === "number") {
      uiManager.setEnergyRegenRate(regen, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setEnergyDiffusionRate === "function") {
    const diffusion = engine?.state?.energyDiffusionRate;

    if (typeof diffusion === "number") {
      uiManager.setEnergyDiffusionRate(diffusion, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setMutationMultiplier === "function") {
    const mutation = engine?.state?.mutationMultiplier;

    if (typeof mutation === "number") {
      uiManager.setMutationMultiplier(mutation, { notify: false });
    }
  }

  if (uiManager && typeof uiManager.setLeaderboardIntervalMs === "function") {
    const interval = engine?.state?.leaderboardIntervalMs;

    if (typeof interval === "number") {
      uiManager.setLeaderboardIntervalMs(interval, { notify: false });
    }
  }

  if (uiManager) {
    for (const [overlayKey, setterName] of Object.entries(OVERLAY_TOGGLE_SETTERS)) {
      if (
        typeof uiManager[setterName] === "function" &&
        engine?.state?.[overlayKey] !== undefined
      ) {
        uiManager[setterName](engine.state[overlayKey], { notify: false });
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
