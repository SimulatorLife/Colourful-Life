// Centralized simulation config defaults
const DEFAULT_MAX_TILE_ENERGY = 5;
const DEFAULT_REGEN_DENSITY_PENALTY = 0.5;
const DEFAULT_CONSUMPTION_DENSITY_PENALTY = 0.5;
const RUNTIME_ENV =
  typeof process !== "undefined" && typeof process.env === "object"
    ? process.env
    : undefined;

/**
 * Resolves the maximum amount of energy a single tile can store, allowing tests
 * and runtime environments to override the baseline via an environment
 * variable.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Sanitized maximum tile energy value.
 */
export function resolveMaxTileEnergy(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_MAX_TILE_ENERGY;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_TILE_ENERGY;
  }

  return parsed;
}

export const MAX_TILE_ENERGY = resolveMaxTileEnergy();
// Slightly elevated baseline regen (per tick) to soften early starvation cascades
// Bumped in vNext after tile simulations showed the previous 0.0075 rate often
// stalled around 57% of the max energy under moderate density (see docs for
// before/after notes).
export const ENERGY_REGEN_RATE_DEFAULT = 0.0082;
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.05; // smoothing between tiles (per tick)
export const DENSITY_RADIUS_DEFAULT = 1;
export const COMBAT_EDGE_SHARPNESS_DEFAULT = 3.2;

/**
 * Resolves the density penalty applied during tile regeneration. Allows
 * environments to fine-tune how strongly crowding suppresses energy recovery.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Sanitized density penalty coefficient in the 0..1 range.
 */
export function resolveRegenDensityPenalty(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_REGEN_DENSITY_PENALTY;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_REGEN_DENSITY_PENALTY;
  }

  return parsed;
}

/**
 * Density penalty applied during energy regeneration. Values outside the 0..1
 * interval fall back to {@link DEFAULT_REGEN_DENSITY_PENALTY} so both headless
 * and browser runs remain deterministic.
 */
export const REGEN_DENSITY_PENALTY = resolveRegenDensityPenalty(); // 1 - penalty * density

/**
 * Resolves the density penalty applied during energy consumption. Like the
 * regeneration penalty resolver, the helper keeps overrides constrained to the
 * 0..1 range while allowing environments to dial in how harshly crowding
 * suppresses harvesting. This makes it easy to experiment with sparser or more
 * competitive ecosystems without code changes.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Sanitized density penalty coefficient in the 0..1 range.
 */
export function resolveConsumptionDensityPenalty(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return DEFAULT_CONSUMPTION_DENSITY_PENALTY;
  }

  return parsed;
}

/**
 * Density penalty applied while organisms harvest energy from a tile. Sanitizes
 * `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` into the 0..1 range to prevent
 * overrides from destabilizing tests or overlays.
 */
export const CONSUMPTION_DENSITY_PENALTY = resolveConsumptionDensityPenalty(); // 1 - penalty * density

export const SIMULATION_DEFAULTS = Object.freeze({
  paused: false,
  updatesPerSecond: 60,
  eventFrequencyMultiplier: 1,
  mutationMultiplier: 1,
  densityEffectMultiplier: 1,
  societySimilarity: 0.7,
  enemySimilarity: 0.4,
  eventStrengthMultiplier: 1,
  energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
  energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
  combatEdgeSharpness: COMBAT_EDGE_SHARPNESS_DEFAULT,
  showObstacles: true,
  showEnergy: false,
  showDensity: false,
  showFitness: false,
  showCelebrationAuras: false,
  leaderboardIntervalMs: 750,
  matingDiversityThreshold: 0.45,
  lowDiversityReproMultiplier: 0.1,
  speedMultiplier: 1,
  autoPauseOnBlur: true,
});

/**
 * Resolves simulation defaults while allowing selective overrides.
 *
 * The helper keeps UI builders and headless adapters in sync by ensuring any
 * omitted setting falls back to the canonical baseline defined above.
 *
 * @param {Partial<typeof SIMULATION_DEFAULTS>} [overrides] - Custom values
 *   to merge into the defaults.
 * @returns {typeof SIMULATION_DEFAULTS} Finalized defaults object.
 */
export function resolveSimulationDefaults(overrides = {}) {
  const defaults = { ...SIMULATION_DEFAULTS };

  if (!overrides || typeof overrides !== "object") {
    return { ...defaults };
  }

  return { ...defaults, ...overrides };
}
