// Centralized simulation config defaults
export const MAX_TILE_ENERGY = 5;
export const ENERGY_REGEN_RATE_DEFAULT = 0.007; // baseline logistic regen (per tick)
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.05; // smoothing between tiles (per tick)
export const DENSITY_RADIUS_DEFAULT = 1;

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
  energyRegenRate: { min: 0, max: 0.2, step: 0.005, floor: 0 },
  energyDiffusionRate: { min: 0, max: 0.5, step: 0.01, floor: 0 },
  leaderboardIntervalMs: { default: 750, min: 100, max: 3000, step: 50, floor: 0 },
};
// Penalties (scale 0..1) used in energy model
export const REGEN_DENSITY_PENALTY = 0.5; // 1 - penalty * density
export const CONSUMPTION_DENSITY_PENALTY = 0.5; // 1 - penalty * density
