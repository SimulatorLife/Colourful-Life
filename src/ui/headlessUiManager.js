import { resolveSimulationDefaults } from "../config.js";

/**
 * Creates a lightweight {@link UIManager}-compatible adapter for environments
 * where no DOM-backed UI is available (e.g. tests, server-side rendering, or
 * custom render loops). The adapter mirrors the most important controls that
 * the visual UI exposes—pause state, update rates, event and mutation
 * multipliers, diversity settings, overlays (obstacles/energy/density/fitness),
 * linger penalty, and leaderboard cadence—so simulation code can interact with
 * shared settings consistently regardless of whether the real UI is mounted.
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
 * @param {number} [options.matingDiversityThreshold] Genetic similarity tolerance for mating.
 * @param {number} [options.lowDiversityReproMultiplier] Reproduction multiplier applied when diversity is low.
 * @param {boolean} [options.showObstacles] Whether obstacle overlays are shown.
 * @param {boolean} [options.showEnergy] Whether energy overlays are shown.
 * @param {boolean} [options.showDensity] Whether population density overlays are shown.
 * @param {boolean} [options.showFitness] Whether fitness overlays are shown.
 * @param {number} [options.lingerPenalty] Penalty applied to agents that stay still.
 * @param {number} [options.leaderboardIntervalMs] Minimum time between leaderboard updates.
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
 *   getEnergyDiffusionRate: () => number,
 *   getMatingDiversityThreshold: () => number,
 *   setMatingDiversityThreshold: (value: number) => void,
 *   getLowDiversityReproMultiplier: () => number,
 *   setLowDiversityReproMultiplier: (value: number) => void,
 *   getShowObstacles: () => boolean,
 *   getShowEnergy: () => boolean,
 *   getShowDensity: () => boolean,
 *   getShowFitness: () => boolean,
 *   shouldRenderSlowUi: (timestamp: number) => boolean,
 *   renderMetrics: Function,
 *   renderLeaderboard: Function,
 *   getLingerPenalty: () => number,
 *   setLingerPenalty: (value: number) => void,
 *   getAutoPauseOnBlur: () => boolean,
 *   setAutoPauseOnBlur: (value: boolean) => void,
 *   selectionManager: Object|null,
 * }} Headless UI facade that keeps simulation code agnostic to environment.
 */
export function createHeadlessUiManager(options = {}) {
  const { selectionManager, onSettingChange, ...overrides } = options || {};
  const defaults = resolveSimulationDefaults(overrides);
  const settings = { ...defaults };

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;
  const updateIfFinite = (key, value) => {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return false;

    settings[key] = numeric;

    return true;
  };
  const notify = (key, value) => {
    if (typeof onSettingChange === "function") {
      onSettingChange(key, value);
    }
  };

  return {
    isPaused: () => settings.paused,
    setPaused: (value) => {
      settings.paused = Boolean(value);
    },
    getUpdatesPerSecond: () => settings.updatesPerSecond,
    setUpdatesPerSecond: (value) => {
      if (updateIfFinite("updatesPerSecond", value)) {
        notify("updatesPerSecond", settings.updatesPerSecond);
      }
    },
    getEventFrequencyMultiplier: () => settings.eventFrequencyMultiplier,
    getMutationMultiplier: () => settings.mutationMultiplier,
    getDensityEffectMultiplier: () => settings.densityEffectMultiplier,
    getSocietySimilarity: () => settings.societySimilarity,
    getEnemySimilarity: () => settings.enemySimilarity,
    getEventStrengthMultiplier: () => settings.eventStrengthMultiplier,
    getCombatEdgeSharpness: () => settings.combatEdgeSharpness,
    getEnergyRegenRate: () => settings.energyRegenRate,
    getEnergyDiffusionRate: () => settings.energyDiffusionRate,
    getMatingDiversityThreshold: () => settings.matingDiversityThreshold,
    setMatingDiversityThreshold: (value) => {
      if (updateIfFinite("matingDiversityThreshold", value)) {
        notify("matingDiversityThreshold", settings.matingDiversityThreshold);
      }
    },
    getLowDiversityReproMultiplier: () => settings.lowDiversityReproMultiplier,
    setLowDiversityReproMultiplier: (value) => {
      if (updateIfFinite("lowDiversityReproMultiplier", value)) {
        notify("lowDiversityReproMultiplier", settings.lowDiversityReproMultiplier);
      }
    },
    setCombatEdgeSharpness: (value) => {
      if (updateIfFinite("combatEdgeSharpness", value)) {
        notify("combatEdgeSharpness", settings.combatEdgeSharpness);
      }
    },
    getShowObstacles: () => settings.showObstacles,
    getShowEnergy: () => settings.showEnergy,
    getShowDensity: () => settings.showDensity,
    getShowFitness: () => settings.showFitness,
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
    getLingerPenalty: () => settings.lingerPenalty,
    setLingerPenalty: (value) => {
      if (updateIfFinite("lingerPenalty", value)) {
        notify("lingerPenalty", settings.lingerPenalty);
      }
    },
    getAutoPauseOnBlur: () => settings.autoPauseOnBlur,
    setAutoPauseOnBlur: (value) => {
      settings.autoPauseOnBlur = Boolean(value);
      notify("autoPauseOnBlur", settings.autoPauseOnBlur);
    },
    selectionManager: selectionManager ?? null,
  };
}

export default createHeadlessUiManager;
