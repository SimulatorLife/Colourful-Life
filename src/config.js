// Centralized simulation config defaults
const DEFAULT_MAX_TILE_ENERGY = 5;
const DEFAULT_REGEN_DENSITY_PENALTY = 0.5;
const DEFAULT_CONSUMPTION_DENSITY_PENALTY = 0.5;
const DEFAULT_TRAIT_ACTIVATION_THRESHOLD = 0.6;
const DEFAULT_ACTIVITY_BASE_RATE = 0.3;
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

/**
 * Resolves the minimum normalized trait value required for stats to count an
 * organism as "active" in a category. Defaults to {@link
 * DEFAULT_TRAIT_ACTIVATION_THRESHOLD} but allows deployments to tune the
 * sensitivity via an environment variable so trait presence charts can be
 * calibrated without touching code.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Sanitized activation threshold in the 0..1 range.
 */
export function resolveTraitActivationThreshold(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_TRAIT_ACTIVATION_THRESHOLD;
  }

  if (parsed <= 0) {
    return 0;
  }

  if (parsed >= 1) {
    return 1;
  }

  return parsed;
}

export const TRAIT_ACTIVATION_THRESHOLD = resolveTraitActivationThreshold();

/**
 * Resolves the baseline activity rate applied to every genome before the DNA's
 * activity locus is considered. This keeps the ecosystem responsive while
 * enabling environments to globally calm or energize organisms without
 * rewriting DNA accessors.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Activity baseline clamped to the 0..1 interval.
 */
export function resolveActivityBaseRate(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_ACTIVITY_BASE_RATE;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_ACTIVITY_BASE_RATE;
  }

  if (parsed <= 0) {
    return 0;
  }

  if (parsed >= 1) {
    return 1;
  }

  return parsed;
}

export const ACTIVITY_BASE_RATE = resolveActivityBaseRate();

export const SIMULATION_DEFAULTS = Object.freeze({
  paused: false,
  updatesPerSecond: 60,
  eventFrequencyMultiplier: 1,
  mutationMultiplier: 1,
  densityEffectMultiplier: 1,
  societySimilarity: 0.7,
  enemySimilarity: 0.4,
  eventStrengthMultiplier: 1,
  maxConcurrentEvents: 2,
  energyRegenRate: ENERGY_REGEN_RATE_DEFAULT,
  energyDiffusionRate: ENERGY_DIFFUSION_RATE_DEFAULT,
  combatEdgeSharpness: COMBAT_EDGE_SHARPNESS_DEFAULT,
  showObstacles: true,
  showEnergy: false,
  showDensity: false,
  showFitness: false,
  showCelebrationAuras: false,
  showLifeEventMarkers: false,
  leaderboardIntervalMs: 750,
  matingDiversityThreshold: 0.45,
  // Lifted from 0.1 after sampling 10k similarity-penalized pairings showed
  // roughly 7.5% of outcomes collapsing below a 0.2 multiplier. Settling on
  // 0.12 trimmed those near-zero cases without materially raising the average
  // reproduction probability, softening homogenization stalls while preserving
  // pressure to diversify.
  lowDiversityReproMultiplier: 0.12,
  speedMultiplier: 1,
  autoPauseOnBlur: false,
});

const BOOLEAN_DEFAULT_KEYS = Object.freeze([
  "paused",
  "showObstacles",
  "showEnergy",
  "showDensity",
  "showFitness",
  "showCelebrationAuras",
  "showLifeEventMarkers",
  "autoPauseOnBlur",
]);

function coerceBoolean(candidate, fallback) {
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
 * Resolves simulation defaults while allowing selective overrides.
 *
 * The helper keeps UI builders and headless adapters in sync by ensuring any
 * omitted setting falls back to the canonical baseline defined above.
 * Boolean overrides are coerced so persisted string values such as "false"
 * do not accidentally flip toggles on when simulations are rehydrated.
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

  const merged = { ...defaults, ...overrides };

  for (const key of BOOLEAN_DEFAULT_KEYS) {
    merged[key] = coerceBoolean(merged[key], defaults[key]);
  }

  const concurrencyValue = Number(merged.maxConcurrentEvents);

  if (!Number.isFinite(concurrencyValue)) {
    merged.maxConcurrentEvents = defaults.maxConcurrentEvents;
  } else {
    merged.maxConcurrentEvents = Math.max(0, Math.floor(concurrencyValue));
  }

  const hasUpdatesOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "updatesPerSecond",
  );
  const hasSpeedOverride = Object.prototype.hasOwnProperty.call(
    overrides,
    "speedMultiplier",
  );
  const baseUpdates = Number.isFinite(defaults.updatesPerSecond)
    ? defaults.updatesPerSecond
    : SIMULATION_DEFAULTS.updatesPerSecond;

  if (hasUpdatesOverride) {
    const numeric = Number(merged.updatesPerSecond);

    if (Number.isFinite(numeric) && numeric > 0) {
      merged.updatesPerSecond = Math.max(1, Math.round(numeric));
    } else {
      merged.updatesPerSecond = baseUpdates;
    }

    const derivedMultiplier = merged.updatesPerSecond / baseUpdates;

    merged.speedMultiplier = Number.isFinite(derivedMultiplier)
      ? derivedMultiplier
      : defaults.speedMultiplier;
  } else if (hasSpeedOverride) {
    const numeric = Number(merged.speedMultiplier);

    if (Number.isFinite(numeric) && numeric > 0) {
      merged.speedMultiplier = numeric;
      merged.updatesPerSecond = Math.max(
        1,
        Math.round(baseUpdates * merged.speedMultiplier),
      );
    } else {
      merged.speedMultiplier = defaults.speedMultiplier;
      merged.updatesPerSecond = baseUpdates;
    }
  } else {
    const numericUpdates = Number(merged.updatesPerSecond);
    const numericSpeed = Number(merged.speedMultiplier);

    merged.updatesPerSecond =
      Number.isFinite(numericUpdates) && numericUpdates > 0
        ? Math.max(1, Math.round(numericUpdates))
        : baseUpdates;
    merged.speedMultiplier =
      Number.isFinite(numericSpeed) && numericSpeed > 0
        ? numericSpeed
        : defaults.speedMultiplier;
  }

  return merged;
}
