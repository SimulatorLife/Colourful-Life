import UIManager from "./uiManager.js";
import { createHeadlessUiManager } from "./headlessUiManager.js";
import { toPlainObject } from "../utils.js";

function normalizeLayoutOptions({ engine, uiOptions = {}, sanitizedDefaults = {} }) {
  const normalizedUi = toPlainObject(uiOptions);
  const layoutConfig = toPlainObject(normalizedUi.layout);
  const initialSettings = {
    ...sanitizedDefaults,
    ...toPlainObject(layoutConfig.initialSettings),
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
  const userOnSettingChange = mergedOptions.onSettingChange;

  mergedOptions.onSettingChange = (key, value) => {
    if (key === "updatesPerSecond") {
      engine?.setUpdatesPerSecond?.(value);
    } else if (typeof simulationCallbacks.onSettingChange === "function") {
      simulationCallbacks.onSettingChange(key, value);
    }

    if (typeof userOnSettingChange === "function") {
      userOnSettingChange(key, value);
    }
  };

  return mergedOptions;
}

function subscribeEngineToUi(engine, uiManager) {
  const unsubscribers = [];

  if (!engine || !uiManager) {
    return unsubscribers;
  }

  unsubscribers.push(
    engine.on?.("metrics", ({ stats, metrics, environment }) => {
      if (typeof uiManager.renderMetrics === "function") {
        uiManager.renderMetrics(stats, metrics, environment);
      }
    }),
  );

  unsubscribers.push(
    engine.on?.("leaderboard", ({ entries }) => {
      if (typeof uiManager.renderLeaderboard === "function") {
        uiManager.renderLeaderboard(entries);
      }
    }),
  );

  unsubscribers.push(
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
        changes?.lowDiversityReproMultiplier !== undefined &&
        typeof uiManager.setLowDiversityReproMultiplier === "function"
      ) {
        uiManager.setLowDiversityReproMultiplier(changes.lowDiversityReproMultiplier, {
          notify: false,
        });
      }
    }),
  );

  return unsubscribers.filter(Boolean);
}

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

  const unsubscribers = headless ? [] : subscribeEngineToUi(engine, uiManager);

  return {
    uiManager,
    unsubscribers,
    headlessOptions,
    layout,
  };
}

export default bindSimulationToUi;
