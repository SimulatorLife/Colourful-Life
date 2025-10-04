import { resolveSimulationDefaults, SIMULATION_DEFAULTS } from "../config.js";
import { sanitizeNumber, invokeWithErrorBoundary } from "../utils.js";

function coerceBoolean(candidate, fallback = false) {
  if (typeof candidate === "boolean") {
    return candidate;
  }

  if (candidate == null) {
    return fallback;
  }

  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate !== 0 : fallback;
  }

  if (typeof candidate === "string") {
    const normalized = candidate.trim().toLowerCase();

    if (normalized.length === 0) return fallback;
    if (normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }

    const numeric = Number(normalized);

    if (!Number.isNaN(numeric)) {
      return numeric !== 0;
    }

    return fallback;
  }

  return Boolean(candidate);
}

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
 * @param {Object} [options]
 * @param {boolean} [options.paused=false] Whether the simulation starts paused.
 * @param {number} [options.updatesPerSecond=60] Simulation tick frequency.
 * @param {number} [options.eventFrequencyMultiplier] Multiplier for event cadence.
 * @param {number} [options.mutationMultiplier] Mutation rate multiplier.
 * @param {number} [options.densityEffectMultiplier] Density impact multiplier.
 * @param {number} [options.societySimilarity] Preferred similarity for friendly agents.
 * @param {number} [options.enemySimilarity] Preferred similarity for hostile agents.
 * @param {number} [options.eventStrengthMultiplier] Event strength multiplier.
 * @param {number} [options.energyRegenRate] Baseline energy regeneration.
 * @param {number} [options.energyDiffusionRate] Ambient energy spread.
 * @param {number} [options.combatEdgeSharpness] Sharpness multiplier for combat odds.
 * @param {number} [options.combatTerritoryEdgeFactor] Territory influence multiplier for combat odds.
 * @param {number} [options.matingDiversityThreshold] Genetic similarity tolerance for mating.
 * @param {number} [options.lowDiversityReproMultiplier] Reproduction multiplier applied when diversity is low.
 * @param {boolean} [options.showObstacles] Whether obstacle overlays are shown.
 * @param {boolean} [options.showEnergy] Whether energy overlays are shown.
 * @param {boolean} [options.showDensity] Whether population density overlays are shown.
 * @param {boolean} [options.showFitness] Whether fitness overlays are shown.
 * @param {number} [options.leaderboardIntervalMs] Minimum time between leaderboard updates.
 * @param {string} [options.profileGridMetrics] Profiling mode for grid instrumentation ("auto", "always", "never").
 * @param {Object} [options.selectionManager=null] Shared selection manager instance.
 * @returns {{
 *   isPaused: () => boolean,
 *   setPaused: (value: boolean) => void,
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
 *   getMatingDiversityThreshold: () => number,
 *   setMatingDiversityThreshold: (value: number) => void,
 *   getLowDiversityReproMultiplier: () => number,
 *   setLowDiversityReproMultiplier: (value: number) => void,
 *   getShowObstacles: () => boolean,
 *   getShowEnergy: () => boolean,
 *   getShowDensity: () => boolean,
 *   getShowFitness: () => boolean,
 *   getProfileGridMetrics: () => string,
 *   setProfileGridMetrics: (value: string) => void,
 *   shouldRenderSlowUi: (timestamp: number) => boolean,
 *   renderMetrics: Function,
 *   renderLeaderboard: Function,
 *   getAutoPauseOnBlur: () => boolean,
 *   setAutoPauseOnBlur: (value: boolean) => void,
 *   selectionManager: Object|null,
 * }} Headless UI facade that keeps simulation code agnostic to environment.
 */
export function createHeadlessUiManager(options = {}) {
  const { selectionManager, onSettingChange, ...overrides } = options || {};
  const defaults = resolveSimulationDefaults(overrides);
  const settings = { ...defaults };
  const baseUpdatesCandidate =
    Number.isFinite(settings.speedMultiplier) && settings.speedMultiplier > 0
      ? settings.updatesPerSecond / settings.speedMultiplier
      : settings.updatesPerSecond;
  const baseUpdatesPerSecond =
    Number.isFinite(baseUpdatesCandidate) && baseUpdatesCandidate > 0
      ? baseUpdatesCandidate
      : SIMULATION_DEFAULTS.updatesPerSecond;

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;
  const updateIfFinite = (key, value, options = {}) => {
    const { min, max, round } = options || {};
    const sanitized = sanitizeNumber(value, {
      fallback: Number.NaN,
      min,
      max,
      round,
    });

    if (!Number.isFinite(sanitized)) return false;

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
      settings.paused = Boolean(value);
    },
    getUpdatesPerSecond: () => settings.updatesPerSecond,
    setUpdatesPerSecond: (value) => {
      if (updateIfFinite("updatesPerSecond", value, { min: 1, round: true })) {
        const safeBase = baseUpdatesPerSecond > 0 ? baseUpdatesPerSecond : 1;

        settings.speedMultiplier = settings.updatesPerSecond / safeBase;
        notify("updatesPerSecond", settings.updatesPerSecond);
      }
    },
    getEventFrequencyMultiplier: () => settings.eventFrequencyMultiplier,
    setEventFrequencyMultiplier: (value) => {
      if (updateIfFinite("eventFrequencyMultiplier", value, { min: 0 })) {
        notify("eventFrequencyMultiplier", settings.eventFrequencyMultiplier);
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
    getSocietySimilarity: () => settings.societySimilarity,
    getEnemySimilarity: () => settings.enemySimilarity,
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
    getMatingDiversityThreshold: () => settings.matingDiversityThreshold,
    setMatingDiversityThreshold: (value) => {
      if (updateIfFinite("matingDiversityThreshold", value, { min: 0, max: 1 })) {
        notify("matingDiversityThreshold", settings.matingDiversityThreshold);
      }
    },
    getLowDiversityReproMultiplier: () => settings.lowDiversityReproMultiplier,
    setLowDiversityReproMultiplier: (value) => {
      if (updateIfFinite("lowDiversityReproMultiplier", value, { min: 0, max: 1 })) {
        notify("lowDiversityReproMultiplier", settings.lowDiversityReproMultiplier);
      }
    },
    setCombatEdgeSharpness: (value) => {
      if (updateIfFinite("combatEdgeSharpness", value)) {
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
    getProfileGridMetrics: () => settings.profileGridMetrics,
    setProfileGridMetrics: (value) => {
      const normalized = resolveSimulationDefaults({
        profileGridMetrics: value,
      }).profileGridMetrics;

      if (settings.profileGridMetrics === normalized) return;

      settings.profileGridMetrics = normalized;
      notify("profileGridMetrics", settings.profileGridMetrics);
    },
    shouldRenderSlowUi: (timestamp) => {
      if (!Number.isFinite(timestamp)) return false;
      if (timestamp - lastSlowUiRender >= settings.leaderboardIntervalMs) {
        lastSlowUiRender = timestamp;

        return true;
      }

      return false;
    },
    renderMetrics: () => {},
    renderLeaderboard: () => {},
    getAutoPauseOnBlur: () => settings.autoPauseOnBlur,
    setAutoPauseOnBlur: (value) => {
      const normalized = coerceBoolean(value, settings.autoPauseOnBlur);

      if (settings.autoPauseOnBlur === normalized) return;

      settings.autoPauseOnBlur = normalized;
      notify("autoPauseOnBlur", settings.autoPauseOnBlur);
    },
    selectionManager: selectionManager ?? null,
  };
}

export default createHeadlessUiManager;
