import {
  resolveSimulationDefaults,
  SIMULATION_DEFAULTS,
  LEADERBOARD_INTERVAL_MIN_MS,
} from "../config.js";
import { sanitizeNumber } from "../utils/math.js";
import { coerceBoolean } from "../utils/primitives.js";
import { invokeWithErrorBoundary } from "../utils/error.js";

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
 * {@link SimulationEngine} when events are emitted.
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
 * @param {boolean} [options.showFitness] - Whether fitness overlays are shown.
 * @param {boolean} [options.showLifeEventMarkers] - Whether life event markers are shown.
 * @param {boolean} [options.showAuroraVeil] - Whether the aurora whimsy overlay is shown.
 * @param {boolean} [options.showGridLines] - Whether grid lines outlining each tile are shown.
 * @param {boolean} [options.showReproductiveZones] - Whether reproductive zone shading is shown.
 * @param {number} [options.leaderboardIntervalMs] - Minimum time between leaderboard updates.
 * @param {Object} [options.selectionManager=null] - Shared selection manager instance.
 * @returns {{
 *   isPaused: () => boolean,
 *   setPaused: (value: boolean) => void,
 *   setPauseState: (value: boolean) => void,
 *   togglePause: () => boolean,
 *   getUpdatesPerSecond: () => number,
 *   setUpdatesPerSecond: (value: number) => void,
 *   getEventFrequencyMultiplier: () => number,
 *   getMutationMultiplier: () => number,
 *   getDensityEffectMultiplier: () => number,
 *   getSocietySimilarity: () => number,
 *   getEnemySimilarity: () => number,
 *   getEventStrengthMultiplier: () => number,
 *   getEnergyRegenRate: () => number,
 *   setEnergyRegenRate: (value: number) => void,
 *   getEnergyDiffusionRate: () => number,
 *   setEnergyDiffusionRate: (value: number) => void,
 *   getInitialTileEnergyFraction: () => number,
 *   setInitialTileEnergyFraction: (value: number) => void,
 *   getMatingDiversityThreshold: () => number,
 *   setMatingDiversityThreshold: (value: number) => void,
 *   getLowDiversityReproMultiplier: () => number,
 *   setLowDiversityReproMultiplier: (value: number) => void,
 *   getShowObstacles: () => boolean,
 *   getShowEnergy: () => boolean,
 *   getShowDensity: () => boolean,
 *   getShowFitness: () => boolean,
 *   getShowLifeEventMarkers: () => boolean,
 *   getShowAuroraVeil: () => boolean,
 *   getShowGridLines: () => boolean,
 *   shouldRenderSlowUi: (timestamp: number) => boolean,
 *   renderMetrics: Function,
 *   renderLeaderboard: Function,
 *   getAutoPauseOnBlur: () => boolean,
 *   setAutoPauseOnBlur: (value: boolean) => void,
 *   selectionManager: Object|null,
 * }} - Headless UI facade that keeps simulation code agnostic to environment.
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

  return {
    isPaused: () => settings.paused,
    setPaused: (value) => {
      const next = Boolean(value);

      if (settings.paused === next) return;

      const result = next ? callPause() : callResume();
      const resolved = typeof result === "boolean" ? result : next;

      applyPauseState(resolved);
    },
    setPauseState: (value) => {
      const next = Boolean(value);

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
    setEventFrequencyMultiplier: (value) => {
      if (updateIfFinite("eventFrequencyMultiplier", value, { min: 0 })) {
        notify("eventFrequencyMultiplier", settings.eventFrequencyMultiplier);
      }
    },
    setEventStrengthMultiplier: (value) => {
      if (updateIfFinite("eventStrengthMultiplier", value, { min: 0 })) {
        notify("eventStrengthMultiplier", settings.eventStrengthMultiplier);
      }
    },
    getMaxConcurrentEvents: () => settings.maxConcurrentEvents,
    getMutationMultiplier: () => settings.mutationMultiplier,
    setMutationMultiplier: (value) => {
      if (updateIfFinite("mutationMultiplier", value, { min: 0 })) {
        notify("mutationMultiplier", settings.mutationMultiplier);
      }
    },
    getDensityEffectMultiplier: () => settings.densityEffectMultiplier,
    setDensityEffectMultiplier: (value) => {
      if (updateIfFinite("densityEffectMultiplier", value, { min: 0 })) {
        notify("densityEffectMultiplier", settings.densityEffectMultiplier);
      }
    },
    getSocietySimilarity: () => settings.societySimilarity,
    setSocietySimilarity: (value) => {
      if (updateIfFinite("societySimilarity", value, { min: 0, max: 1 })) {
        notify("societySimilarity", settings.societySimilarity);
      }
    },
    getEnemySimilarity: () => settings.enemySimilarity,
    setEnemySimilarity: (value) => {
      if (updateIfFinite("enemySimilarity", value, { min: 0, max: 1 })) {
        notify("enemySimilarity", settings.enemySimilarity);
      }
    },
    getEventStrengthMultiplier: () => settings.eventStrengthMultiplier,
    getCombatEdgeSharpness: () => settings.combatEdgeSharpness,
    getCombatTerritoryEdgeFactor: () => settings.combatTerritoryEdgeFactor,
    getEnergyRegenRate: () => settings.energyRegenRate,
    setEnergyRegenRate: (value) => {
      if (updateIfFinite("energyRegenRate", value, { min: 0 })) {
        notify("energyRegenRate", settings.energyRegenRate);
      }
    },
    getEnergyDiffusionRate: () => settings.energyDiffusionRate,
    setEnergyDiffusionRate: (value) => {
      if (updateIfFinite("energyDiffusionRate", value, { min: 0 })) {
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
    setCombatEdgeSharpness: (value) => {
      if (updateIfFinite("combatEdgeSharpness", value, { min: 0.1 })) {
        notify("combatEdgeSharpness", settings.combatEdgeSharpness);
      }
    },
    setCombatTerritoryEdgeFactor: (value) => {
      if (updateIfFinite("combatTerritoryEdgeFactor", value, { min: 0, max: 1 })) {
        notify("combatTerritoryEdgeFactor", settings.combatTerritoryEdgeFactor);
      }
    },
    setMaxConcurrentEvents: (value) => {
      if (
        updateIfFinite("maxConcurrentEvents", value, {
          min: 0,
          round: (candidate) => Math.floor(candidate),
        })
      ) {
        notify("maxConcurrentEvents", settings.maxConcurrentEvents);
      }
    },
    getShowObstacles: () => settings.showObstacles,
    getShowEnergy: () => settings.showEnergy,
    getShowDensity: () => settings.showDensity,
    getShowFitness: () => settings.showFitness,
    getShowLifeEventMarkers: () => settings.showLifeEventMarkers,
    getShowAuroraVeil: () => settings.showAuroraVeil,
    getShowGridLines: () => settings.showGridLines,
    getShowReproductiveZones: () => settings.showReproductiveZones,
    setShowObstacles: (value) => {
      const normalized = coerceBoolean(value, settings.showObstacles);

      if (settings.showObstacles === normalized) return;

      settings.showObstacles = normalized;
      notify("showObstacles", settings.showObstacles);
    },
    setShowEnergy: (value) => {
      const normalized = coerceBoolean(value, settings.showEnergy);

      if (settings.showEnergy === normalized) return;

      settings.showEnergy = normalized;
      notify("showEnergy", settings.showEnergy);
    },
    setShowDensity: (value) => {
      const normalized = coerceBoolean(value, settings.showDensity);

      if (settings.showDensity === normalized) return;

      settings.showDensity = normalized;
      notify("showDensity", settings.showDensity);
    },
    setShowFitness: (value) => {
      const normalized = coerceBoolean(value, settings.showFitness);

      if (settings.showFitness === normalized) return;

      settings.showFitness = normalized;
      notify("showFitness", settings.showFitness);
    },
    setShowLifeEventMarkers: (value) => {
      const normalized = coerceBoolean(value, settings.showLifeEventMarkers);

      if (settings.showLifeEventMarkers === normalized) return;

      settings.showLifeEventMarkers = normalized;
      notify("showLifeEventMarkers", settings.showLifeEventMarkers);
    },
    setShowAuroraVeil: (value) => {
      const normalized = coerceBoolean(value, settings.showAuroraVeil);

      if (settings.showAuroraVeil === normalized) return;

      settings.showAuroraVeil = normalized;
      notify("showAuroraVeil", settings.showAuroraVeil);
    },
    setShowGridLines: (value) => {
      const normalized = coerceBoolean(value, settings.showGridLines);

      if (settings.showGridLines === normalized) return;

      settings.showGridLines = normalized;
      notify("showGridLines", settings.showGridLines);
    },
    setShowReproductiveZones: (value) => {
      const normalized = coerceBoolean(value, settings.showReproductiveZones);

      if (settings.showReproductiveZones === normalized) return;

      settings.showReproductiveZones = normalized;
      notify("showReproductiveZones", settings.showReproductiveZones);
    },
    getLeaderboardIntervalMs: () => settings.leaderboardIntervalMs,
    setLeaderboardIntervalMs: (value) => {
      const sanitized = sanitizeNumber(value, {
        fallback: Number.NaN,
        min: 0,
        round: Math.round,
      });

      if (!Number.isFinite(sanitized)) return;

      const normalized =
        sanitized <= 0 ? 0 : Math.max(LEADERBOARD_INTERVAL_MIN_MS, sanitized);

      if (Object.is(settings.leaderboardIntervalMs, normalized)) return;

      settings.leaderboardIntervalMs = normalized;
      notify("leaderboardIntervalMs", settings.leaderboardIntervalMs);
    },
    getLeaderboardSize: () => settings.leaderboardSize,
    setLeaderboardSize: (value) => {
      if (
        updateIfFinite("leaderboardSize", value, {
          min: 0,
          round: Math.floor,
        })
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
}

export default createHeadlessUiManager;
