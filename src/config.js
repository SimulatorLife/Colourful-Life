// Centralized simulation config defaults
export const MAX_TILE_ENERGY = 5;
export const ENERGY_REGEN_RATE_DEFAULT = 0.007; // baseline logistic regen (per tick)
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.05; // smoothing between tiles (per tick)
export const DENSITY_RADIUS_DEFAULT = 1;
export const COMBAT_EDGE_SHARPNESS_DEFAULT = 3.2;

// UI defaults and slider bounds
export const UI_SLIDER_CONFIG = {
  societySimilarity: { default: 0.7, min: 0, max: 1, step: 0.01, floor: 0 },
  enemySimilarity: { default: 0.4, min: 0, max: 1, step: 0.01, floor: 0 },
  eventStrengthMultiplier: { default: 1, min: 0, max: 3, step: 0.05, floor: 0 },
  eventFrequencyMultiplier: { default: 1, min: 0, max: 3, step: 0.1, floor: 0 },
  speedMultiplier: { default: 1, min: 0.5, max: 100, step: 0.5, floor: 0.1 },
  densityEffectMultiplier: { default: 1, min: 0, max: 2, step: 0.05, floor: 0 },
  mutationMultiplier: { default: 1, min: 0, max: 3, step: 0.05, floor: 0 },
  matingDiversityThreshold: { default: 0.45, min: 0, max: 1, step: 0.01, floor: 0 },
  lowDiversityReproMultiplier: { default: 0.1, min: 0, max: 1, step: 0.05, floor: 0 },
  combatEdgeSharpness: {
    default: COMBAT_EDGE_SHARPNESS_DEFAULT,
    min: 0.5,
    max: 6,
    step: 0.1,
    floor: 0.1,
  },
  energyRegenRate: { min: 0, max: 0.2, step: 0.005, floor: 0 },
  energyDiffusionRate: { min: 0, max: 0.5, step: 0.01, floor: 0 },
  leaderboardIntervalMs: { default: 750, min: 100, max: 3000, step: 50, floor: 0 },
};

// Penalties (scale 0..1) used in energy model
export const REGEN_DENSITY_PENALTY = 0.5; // 1 - penalty * density
export const CONSUMPTION_DENSITY_PENALTY = 0.5; // 1 - penalty * density

const SLIDER_DEFAULTS = {
  eventFrequencyMultiplier: UI_SLIDER_CONFIG.eventFrequencyMultiplier?.default ?? 1,
  mutationMultiplier: UI_SLIDER_CONFIG.mutationMultiplier?.default ?? 1,
  densityEffectMultiplier: UI_SLIDER_CONFIG.densityEffectMultiplier?.default ?? 1,
  societySimilarity: UI_SLIDER_CONFIG.societySimilarity?.default ?? 0.7,
  enemySimilarity: UI_SLIDER_CONFIG.enemySimilarity?.default ?? 0.4,
  eventStrengthMultiplier: UI_SLIDER_CONFIG.eventStrengthMultiplier?.default ?? 1,
  speedMultiplier: UI_SLIDER_CONFIG.speedMultiplier?.default ?? 1,
  combatEdgeSharpness:
    UI_SLIDER_CONFIG.combatEdgeSharpness?.default ?? COMBAT_EDGE_SHARPNESS_DEFAULT,
  leaderboardIntervalMs: UI_SLIDER_CONFIG.leaderboardIntervalMs?.default ?? 750,
  matingDiversityThreshold: UI_SLIDER_CONFIG.matingDiversityThreshold?.default ?? 0.45,
  lowDiversityReproMultiplier: UI_SLIDER_CONFIG.lowDiversityReproMultiplier?.default ?? 0.1,
};

const BASE_SIMULATION_DEFAULTS = {
  paused: false,
  updatesPerSecond: 60,
  eventFrequencyMultiplier: SLIDER_DEFAULTS.eventFrequencyMultiplier,
  mutationMultiplier: SLIDER_DEFAULTS.mutationMultiplier,
  densityEffectMultiplier: SLIDER_DEFAULTS.densityEffectMultiplier,
  societySimilarity: SLIDER_DEFAULTS.societySimilarity,
  enemySimilarity: SLIDER_DEFAULTS.enemySimilarity,
  eventStrengthMultiplier: SLIDER_DEFAULTS.eventStrengthMultiplier,
  energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
  energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
  combatEdgeSharpness: COMBAT_EDGE_SHARPNESS_DEFAULT,
  showObstacles: true,
  showEnergy: false,
  showDensity: false,
  showFitness: false,
  leaderboardIntervalMs: SLIDER_DEFAULTS.leaderboardIntervalMs,
  matingDiversityThreshold: SLIDER_DEFAULTS.matingDiversityThreshold,
  lowDiversityReproMultiplier: SLIDER_DEFAULTS.lowDiversityReproMultiplier,
  speedMultiplier: SLIDER_DEFAULTS.speedMultiplier,
  lingerPenalty: 0,
  autoPauseOnBlur: true,
};

/**
 * Resolves simulation defaults while allowing selective overrides.
 *
 * The helper keeps UI builders and headless adapters in sync by ensuring any
 * omitted setting falls back to the canonical baseline defined above.
 *
 * @param {Partial<typeof BASE_SIMULATION_DEFAULTS>} [overrides] - Custom values
 *   to merge into the defaults.
 * @returns {typeof BASE_SIMULATION_DEFAULTS} Finalized defaults object.
 */
export function resolveSimulationDefaults(overrides = {}) {
  const entries = Object.entries(BASE_SIMULATION_DEFAULTS).map(([key, value]) => [
    key,
    overrides[key] ?? value,
  ]);

  return Object.fromEntries(entries);
}
