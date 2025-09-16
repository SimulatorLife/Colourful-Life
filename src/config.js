// Centralized simulation config defaults
export const MAX_TILE_ENERGY = 5;
export const ENERGY_REGEN_RATE_DEFAULT = 0.09; // baseline logistic regen (per tick)
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.18; // smoothing between tiles (per tick)
export const DENSITY_RADIUS_DEFAULT = 1;

// Penalties (scale 0..1) used in energy model
export const REGEN_DENSITY_PENALTY = 0.5; // 1 - penalty * density
export const CONSUMPTION_DENSITY_PENALTY = 0.5; // 1 - penalty * density
