import {
  resolveSimulationDefaults,
  SIMULATION_DEFAULTS,
  LEADERBOARD_INTERVAL_MIN_MS,
} from "../config.js";
import { sanitizeNumber, applyIntervalFloor } from "../utils/math.js";
import { coerceBoolean } from "../utils/primitives.js";
import { invokeWithErrorBoundary } from "../utils/error.js";

const BOOLEAN_SETTING_KEYS = Object.freeze([
  "showObstacles",
  "showEnergy",
  "showDensity",
  "showAge",
  "showFitness",
  "showLifeEventMarkers",
  "showSelectionZones",
  "showGridLines",
]);

function attachBooleanSettingAccessors(
  target,
  settings,
  notify,
  keys = BOOLEAN_SETTING_KEYS,
) {
  if (!target || typeof target !== "object") {
    return target;
  }

  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0) {
      continue;
    }

    const capitalized = key.charAt(0).toUpperCase() + key.slice(1);
    const getterName = `get${capitalized}`;
    const setterName = `set${capitalized}`;

    if (typeof target[getterName] !== "function") {
      target[getterName] = () => settings[key];
    }

    if (typeof target[setterName] !== "function") {
      target[setterName] = (value, { notify: shouldNotify = true } = {}) => {
        const normalized = coerceBoolean(value, settings[key]);

        if (settings[key] === normalized) return;

        settings[key] = normalized;

        if (shouldNotify) {
          notify(key, settings[key]);
        }
      };
    }
  }

  return target;
}

// Headless UI consumers historically depended on a single, monolithic manager
// contract. To keep responsibilities cohesive and encourage interface
// segregation we now describe the surface as a collection of role-focused
// slices (playback/autopause, tuning sliders, overlay toggles, telemetry, and
// selection plumbing). Downstream modules can reference only the facets they
// require instead of inheriting the entire manager shape.

/**
 * @typedef {(value: number, options?: { notify?: boolean }) => void} HeadlessNumberSetter
 */

/**
 * @typedef {(value: boolean, options?: { notify?: boolean }) => void} HeadlessBooleanSetter
 */

/**
 * @typedef {object} HeadlessPlaybackControls
 * @property {() => boolean} isPaused
 * @property {(value: boolean) => void} setPaused
 * @property {(value: boolean) => void} setPauseState
 * @property {() => boolean} togglePause
 * @property {() => number} getUpdatesPerSecond
 * @property {HeadlessNumberSetter} setUpdatesPerSecond
 */

/**
 * @typedef {object} HeadlessEventCadenceControls
 * @property {() => number} getEventFrequencyMultiplier
 * @property {HeadlessNumberSetter} setEventFrequencyMultiplier
 * @property {HeadlessNumberSetter} setEventStrengthMultiplier
 * @property {() => number} getMaxConcurrentEvents
 * @property {HeadlessNumberSetter} setMaxConcurrentEvents
 */

/**
 * @typedef {object} HeadlessMutationControls
 * @property {() => number} getMutationMultiplier
 * @property {HeadlessNumberSetter} setMutationMultiplier
 */

/**
 * @typedef {object} HeadlessDensityControls
 * @property {() => number} getDensityEffectMultiplier
 * @property {HeadlessNumberSetter} setDensityEffectMultiplier
 */

/**
 * @typedef {object} HeadlessSimilarityControls
 * @property {() => number} getSocietySimilarity
 * @property {HeadlessNumberSetter} setSocietySimilarity
 * @property {() => number} getEnemySimilarity
 * @property {HeadlessNumberSetter} setEnemySimilarity
 */

/**
 * @typedef {object} HeadlessReproductionControls
 * @property {() => number} getLowDiversityReproMultiplier
 * @property {HeadlessNumberSetter} setLowDiversityReproMultiplier
 * @property {() => number} getMatingDiversityThreshold
 * @property {HeadlessNumberSetter} setMatingDiversityThreshold
 */

/**
 * @typedef {object} HeadlessEnergyControls
 * @property {() => number} getEnergyRegenRate
 * @property {HeadlessNumberSetter} setEnergyRegenRate
 * @property {() => number} getEnergyDiffusionRate
 * @property {HeadlessNumberSetter} setEnergyDiffusionRate
 * @property {() => number} getInitialTileEnergyFraction
 * @property {HeadlessNumberSetter} setInitialTileEnergyFraction
 */

/**
 * @typedef {object} HeadlessCombatControls
 * @property {() => number} getCombatEdgeSharpness
 * @property {HeadlessNumberSetter} setCombatEdgeSharpness
 * @property {() => number} getCombatTerritoryEdgeFactor
 * @property {HeadlessNumberSetter} setCombatTerritoryEdgeFactor
 */

/**
 * @typedef {object} HeadlessLifeEventControls
 * @property {() => number} getLifeEventFadeTicks
 * @property {HeadlessNumberSetter} setLifeEventFadeTicks
 * @property {() => number} getLifeEventLimit
 * @property {HeadlessNumberSetter} setLifeEventLimit
 */

/**
 * @typedef {object} HeadlessLeaderboardControls
 * @property {() => number} getLeaderboardIntervalMs
 * @property {HeadlessNumberSetter} setLeaderboardIntervalMs
 * @property {() => number} getLeaderboardSize
 * @property {HeadlessNumberSetter} setLeaderboardSize
 * @property {(timestamp: number) => boolean} shouldRenderSlowUi
 */

/**
 * @typedef {object} HeadlessTelemetryCallbacks
 * @property {(stats: any, metrics: any, environment: any) => void} renderMetrics
 * @property {(entries: any[]) => void} renderLeaderboard
 */

/**
 * @typedef {object} HeadlessOverlayToggleControls
 * @property {() => boolean} getShowObstacles
 * @property {HeadlessBooleanSetter} setShowObstacles
 * @property {() => boolean} getShowEnergy
 * @property {HeadlessBooleanSetter} setShowEnergy
 * @property {() => boolean} getShowDensity
 * @property {HeadlessBooleanSetter} setShowDensity
 * @property {() => boolean} getShowAge
 * @property {HeadlessBooleanSetter} setShowAge
 * @property {() => boolean} getShowFitness
 * @property {HeadlessBooleanSetter} setShowFitness
 * @property {() => boolean} getShowLifeEventMarkers
 * @property {HeadlessBooleanSetter} setShowLifeEventMarkers
 * @property {() => boolean} getShowSelectionZones
 * @property {HeadlessBooleanSetter} setShowSelectionZones
 * @property {() => boolean} getShowGridLines
 * @property {HeadlessBooleanSetter} setShowGridLines
 */

/**
 * @typedef {object} HeadlessAutoPauseControls
 * @property {() => boolean} getAutoPauseOnBlur
 * @property {HeadlessBooleanSetter} setAutoPauseOnBlur
 * @property {() => boolean} getAutoPausePending
 * @property {(value: boolean) => void} setAutoPausePending
 */

/**
 * @typedef {object} HeadlessSelectionAccess
 * @property {object|null} selectionManager
 */

/**
 * @typedef {HeadlessPlaybackControls & HeadlessAutoPauseControls} HeadlessPlaybackSurface
 */

/**
 * @typedef {HeadlessEventCadenceControls &
 *   HeadlessMutationControls &
 *   HeadlessDensityControls &
 *   HeadlessSimilarityControls &
 *   HeadlessReproductionControls &
 *   HeadlessEnergyControls &
 *   HeadlessCombatControls &
 *   HeadlessLifeEventControls &
 *   HeadlessLeaderboardControls} HeadlessTuningSurface
 */

/**
 * @typedef {HeadlessOverlayToggleControls} HeadlessOverlaySurface
 */

/**
 * @typedef {HeadlessPlaybackSurface &
 *   HeadlessTuningSurface &
 *   HeadlessOverlaySurface} HeadlessStateControlSurface
 */

/**
 * @typedef {HeadlessTelemetryCallbacks} HeadlessTelemetrySurface
 */

/**
 * @typedef {HeadlessSelectionAccess} HeadlessSelectionSurface
 */

/**
 * @typedef {HeadlessStateControlSurface & HeadlessTelemetrySurface} HeadlessUiControlSurface
 */

/**
 * @typedef {HeadlessStateControlSurface &
 *   HeadlessTelemetrySurface &
 *   HeadlessSelectionSurface} HeadlessUiBridgeSurface
 */

/**
 * @typedef {HeadlessUiBridgeSurface} HeadlessUiAdapter
 */

/**
 * Creates a lightweight {@link UIManager}-compatible adapter for environments
 * where no DOM-backed UI is available (e.g. tests, server-side rendering, or
 * custom render loops). The adapter mirrors the most important controls that
 * the visual UI exposes—pause state, update rates, event and mutation
 * multipliers, diversity settings (including the low-diversity reproduction
 * multiplier), overlays (obstacles/energy/density/fitness), and leaderboard
 * cadence—so simulation code can interact with shared settings consistently
 * regardless of whether the real UI is mounted.
 *
 * The returned object implements a subset of {@link UIManager}'s surface area,
 * exposing getters and setters for the mirrored options plus a
 * `selectionManager` reference. Rendering hooks (`renderMetrics`,
 * `renderLeaderboard`) are provided as no-ops to satisfy consumers such as the
 * {@link SimulationEngine} when events are emitted. The engine always invokes
 * those hooks during its frame cycle, and the headless adapter deliberately
 * leaves them empty so CI, profiling scripts, and other non-DOM environments can
 * run without stubbing their own renderers. See the
 * {@link docs/architecture-overview.md#high-level-loop Architecture Overview} for
 * how the bridge keeps headless and browser sessions aligned.
 *
 * @param {Object} [options] - Optional configuration overrides.
 * @param {boolean} [options.paused=false] - Whether the simulation starts paused.
 * @param {number} [options.updatesPerSecond=60] - Simulation tick frequency.
 * @param {number} [options.eventFrequencyMultiplier] - Multiplier for event cadence.
 * @param {number} [options.mutationMultiplier] - Mutation rate multiplier.
 * @param {number} [options.densityEffectMultiplier] - Density impact multiplier.
 * @param {number} [options.societySimilarity] - Preferred similarity for friendly agents.
 * @param {number} [options.enemySimilarity] - Preferred similarity for hostile agents.
 * @param {number} [options.eventStrengthMultiplier] - Event strength multiplier.
 * @param {number} [options.energyRegenRate] - Baseline energy regeneration.
 * @param {number} [options.energyDiffusionRate] - Ambient energy spread.
 * @param {number} [options.initialTileEnergyFraction] - Fraction of tile energy cap applied to empty tiles.
 * @param {number} [options.combatEdgeSharpness] - Sharpness multiplier for combat odds.
 * @param {number} [options.combatTerritoryEdgeFactor] - Territory influence multiplier for combat odds.
 * @param {number} [options.matingDiversityThreshold] - Genetic similarity tolerance for mating.
 * @param {number} [options.lowDiversityReproMultiplier] - Reproduction multiplier applied when diversity is low.
 * @param {boolean} [options.showObstacles] - Whether obstacle overlays are shown.
 * @param {boolean} [options.showEnergy] - Whether energy overlays are shown.
 * @param {boolean} [options.showDensity] - Whether population density overlays are shown.
 * @param {boolean} [options.showAge] - Whether organism age overlays are shown.
 * @param {boolean} [options.showFitness] - Whether fitness overlays are shown.
 * @param {boolean} [options.showLifeEventMarkers] - Whether life event markers are shown.
 * @param {boolean} [options.showSelectionZones] - Whether reproductive zone overlays are shown.
 * @param {boolean} [options.showGridLines] - Whether grid lines outlining each tile are shown.
 * @param {number} [options.lifeEventFadeTicks] - Number of ticks life event markers remain visible.
 * @param {number} [options.lifeEventLimit] - Maximum life event markers rendered at once.
 * @param {number} [options.leaderboardIntervalMs] - Minimum time between leaderboard updates.
 * @param {Object} [options.selectionManager=null] - Shared selection manager instance.
 * @returns {HeadlessUiAdapter} Headless UI facade that keeps simulation code agnostic to environment.
 */
export function createHeadlessUiManager(options = {}) {
  const {
    selectionManager,
    onSettingChange,
    pause: pauseControl,
    resume: resumeControl,
    togglePause: toggleControl,
    ...overrides
  } = options;
  const defaults = resolveSimulationDefaults(overrides);
  const settings = { ...defaults };

  settings.autoPausePending = false;
  const baseUpdatesCandidate =
    Number.isFinite(settings.speedMultiplier) && settings.speedMultiplier > 0
      ? settings.updatesPerSecond / settings.speedMultiplier
      : settings.updatesPerSecond;
  const baseUpdatesPerSecond =
    Number.isFinite(baseUpdatesCandidate) && baseUpdatesCandidate > 0
      ? baseUpdatesCandidate
      : SIMULATION_DEFAULTS.updatesPerSecond;

  const callPause = () => {
    if (typeof pauseControl === "function") {
      const result = pauseControl();

      return typeof result === "boolean" ? result : true;
    }

    if (typeof toggleControl === "function") {
      const result = toggleControl();

      return typeof result === "boolean" ? result : !settings.paused;
    }

    return true;
  };

  const callResume = () => {
    if (typeof resumeControl === "function") {
      const result = resumeControl();

      return typeof result === "boolean" ? result : false;
    }

    if (typeof toggleControl === "function") {
      const result = toggleControl();

      return typeof result === "boolean" ? result : !settings.paused;
    }

    return false;
  };

  const applyPauseState = (nextPaused) => {
    settings.paused = nextPaused;
    if (!settings.paused && settings.autoPausePending) {
      settings.autoPausePending = false;
    }
  };

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;
  const updateIfFinite = (key, value, options = {}) => {
    const { min, max, round } = options;
    const sanitized = sanitizeNumber(value, {
      fallback: Number.NaN,
      min,
      max,
      round,
    });

    if (!Number.isFinite(sanitized)) return false;
    if (Object.is(settings[key], sanitized)) return false;

    settings[key] = sanitized;

    return true;
  };
  const notify = (key, value) => {
    invokeWithErrorBoundary(onSettingChange, [key, value], {
      message: (settingKey) =>
        `Headless UI onSettingChange handler threw while processing "${settingKey}"; continuing without interruption.`,
      once: true,
    });
  };

  const manager = {
    isPaused: () => settings.paused,
    setPaused: (value) => {
      const next = coerceBoolean(value, settings.paused);

      if (settings.paused === next) return;

      const result = next ? callPause() : callResume();
      const resolved = typeof result === "boolean" ? result : next;

      applyPauseState(resolved);
    },
    setPauseState: (value) => {
      const next = coerceBoolean(value, settings.paused);

      if (settings.paused === next) return;

      applyPauseState(next);
    },
    togglePause: () => {
      const result =
        typeof toggleControl === "function"
          ? toggleControl()
          : settings.paused
            ? callResume()
            : callPause();
      const resolved = typeof result === "boolean" ? result : !settings.paused;

      applyPauseState(resolved);

      return settings.paused;
    },
    getUpdatesPerSecond: () => settings.updatesPerSecond,
    setUpdatesPerSecond: (value, { notify: shouldNotify = true } = {}) => {
      if (updateIfFinite("updatesPerSecond", value, { min: 1, round: true })) {
        const safeBase = baseUpdatesPerSecond > 0 ? baseUpdatesPerSecond : 1;

        settings.speedMultiplier = settings.updatesPerSecond / safeBase;
        if (shouldNotify) {
          notify("updatesPerSecond", settings.updatesPerSecond);
        }
      }
    },
    getEventFrequencyMultiplier: () => settings.eventFrequencyMultiplier,
    setEventFrequencyMultiplier: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("eventFrequencyMultiplier", value, { min: 0 }) &&
        shouldNotify
      ) {
        notify("eventFrequencyMultiplier", settings.eventFrequencyMultiplier);
      }
    },
    setEventStrengthMultiplier: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("eventStrengthMultiplier", value, { min: 0 }) &&
        shouldNotify
      ) {
        notify("eventStrengthMultiplier", settings.eventStrengthMultiplier);
      }
    },
    getMaxConcurrentEvents: () => settings.maxConcurrentEvents,
    getMutationMultiplier: () => settings.mutationMultiplier,
    setMutationMultiplier: (value, { notify: shouldNotify = true } = {}) => {
      if (updateIfFinite("mutationMultiplier", value, { min: 0 }) && shouldNotify) {
        notify("mutationMultiplier", settings.mutationMultiplier);
      }
    },
    getDensityEffectMultiplier: () => settings.densityEffectMultiplier,
    setDensityEffectMultiplier: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("densityEffectMultiplier", value, { min: 0 }) &&
        shouldNotify
      ) {
        notify("densityEffectMultiplier", settings.densityEffectMultiplier);
      }
    },
    getSocietySimilarity: () => settings.societySimilarity,
    setSocietySimilarity: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("societySimilarity", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("societySimilarity", settings.societySimilarity);
      }
    },
    getEnemySimilarity: () => settings.enemySimilarity,
    setEnemySimilarity: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("enemySimilarity", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("enemySimilarity", settings.enemySimilarity);
      }
    },
    getEventStrengthMultiplier: () => settings.eventStrengthMultiplier,
    getCombatEdgeSharpness: () => settings.combatEdgeSharpness,
    getCombatTerritoryEdgeFactor: () => settings.combatTerritoryEdgeFactor,
    getEnergyRegenRate: () => settings.energyRegenRate,
    setEnergyRegenRate: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("energyRegenRate", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("energyRegenRate", settings.energyRegenRate);
      }
    },
    getEnergyDiffusionRate: () => settings.energyDiffusionRate,
    setEnergyDiffusionRate: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("energyDiffusionRate", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("energyDiffusionRate", settings.energyDiffusionRate);
      }
    },
    getInitialTileEnergyFraction: () => settings.initialTileEnergyFraction,
    setInitialTileEnergyFraction: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("initialTileEnergyFraction", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("initialTileEnergyFraction", settings.initialTileEnergyFraction);
      }
    },
    getMatingDiversityThreshold: () => settings.matingDiversityThreshold,
    setMatingDiversityThreshold: (value) => {
      if (updateIfFinite("matingDiversityThreshold", value, { min: 0, max: 1 })) {
        notify("matingDiversityThreshold", settings.matingDiversityThreshold);
      }
    },
    getLowDiversityReproMultiplier: () => settings.lowDiversityReproMultiplier,
    setLowDiversityReproMultiplier: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("lowDiversityReproMultiplier", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("lowDiversityReproMultiplier", settings.lowDiversityReproMultiplier);
      }
    },
    setCombatEdgeSharpness: (value, { notify: shouldNotify = true } = {}) => {
      if (updateIfFinite("combatEdgeSharpness", value, { min: 0.1 }) && shouldNotify) {
        notify("combatEdgeSharpness", settings.combatEdgeSharpness);
      }
    },
    setCombatTerritoryEdgeFactor: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("combatTerritoryEdgeFactor", value, { min: 0, max: 1 }) &&
        shouldNotify
      ) {
        notify("combatTerritoryEdgeFactor", settings.combatTerritoryEdgeFactor);
      }
    },
    setMaxConcurrentEvents: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("maxConcurrentEvents", value, {
          min: 0,
          round: (candidate) => Math.floor(candidate),
        }) &&
        shouldNotify
      ) {
        notify("maxConcurrentEvents", settings.maxConcurrentEvents);
      }
    },
    getLifeEventFadeTicks: () => settings.lifeEventFadeTicks,
    getLifeEventLimit: () => settings.lifeEventLimit,
    setLifeEventFadeTicks: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("lifeEventFadeTicks", value, { min: 1, round: Math.round }) &&
        shouldNotify
      ) {
        notify("lifeEventFadeTicks", settings.lifeEventFadeTicks);
      }
    },
    setLifeEventLimit: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("lifeEventLimit", value, { min: 0, round: Math.floor }) &&
        shouldNotify
      ) {
        notify("lifeEventLimit", settings.lifeEventLimit);
      }
    },
    getLeaderboardIntervalMs: () => settings.leaderboardIntervalMs,
    setLeaderboardIntervalMs: (value, { notify: shouldNotify = true } = {}) => {
      const sanitized = sanitizeNumber(value, {
        fallback: Number.NaN,
        min: 0,
        round: Math.round,
      });

      if (!Number.isFinite(sanitized)) return;

      const normalized = applyIntervalFloor(sanitized, LEADERBOARD_INTERVAL_MIN_MS);

      if (Object.is(settings.leaderboardIntervalMs, normalized)) return;

      settings.leaderboardIntervalMs = normalized;
      if (shouldNotify) {
        notify("leaderboardIntervalMs", settings.leaderboardIntervalMs);
      }
    },
    getLeaderboardSize: () => settings.leaderboardSize,
    setLeaderboardSize: (value, { notify: shouldNotify = true } = {}) => {
      if (
        updateIfFinite("leaderboardSize", value, {
          min: 0,
          round: Math.floor,
        }) &&
        shouldNotify
      ) {
        notify("leaderboardSize", settings.leaderboardSize);
      }
    },
    shouldRenderSlowUi: (timestamp) => {
      if (!Number.isFinite(timestamp)) return false;

      const intervalCandidate = Number(settings.leaderboardIntervalMs);
      const interval = Number.isFinite(intervalCandidate)
        ? Math.max(0, intervalCandidate)
        : 0;

      if (timestamp < lastSlowUiRender) {
        lastSlowUiRender = timestamp;

        return true;
      }

      if (interval === 0 || timestamp - lastSlowUiRender >= interval) {
        lastSlowUiRender = timestamp;

        return true;
      }

      return false;
    },
    renderMetrics: () => {},
    renderLeaderboard: () => {},
    getAutoPauseOnBlur: () => settings.autoPauseOnBlur,
    setAutoPauseOnBlur: (value, { notify: shouldNotify = true } = {}) => {
      const normalized = coerceBoolean(value, settings.autoPauseOnBlur);

      if (settings.autoPauseOnBlur === normalized) return;

      settings.autoPauseOnBlur = normalized;
      if (!settings.autoPauseOnBlur) {
        settings.autoPausePending = false;
      }
      if (shouldNotify) {
        notify("autoPauseOnBlur", settings.autoPauseOnBlur);
      }
    },
    getAutoPausePending: () => settings.autoPausePending,
    setAutoPausePending: (value) => {
      settings.autoPausePending = Boolean(value);
    },
    selectionManager: selectionManager ?? null,
  };

  return attachBooleanSettingAccessors(manager, settings, notify);
}

export default createHeadlessUiManager;
