import { sanitizeNumber } from "./utils.js";

// Centralized simulation config defaults
const DEFAULT_MAX_TILE_ENERGY = 6;
const DEFAULT_REGEN_DENSITY_PENALTY = 0.5;
const DEFAULT_CONSUMPTION_DENSITY_PENALTY = 0.5;
const DEFAULT_TRAIT_ACTIVATION_THRESHOLD = 0.6;
// Slightly calmer baseline keeps resting viable when resources tighten.
const DEFAULT_ACTIVITY_BASE_RATE = 0.28;
const DEFAULT_MUTATION_CHANCE = 0.15;
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
// Elevated baseline regen/diffusion to keep population energy budgets viable and prevent
// early simulation collapses while still enforcing per-action energy costs.
export const ENERGY_REGEN_RATE_DEFAULT = 0.0105;
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.06; // smoothing between tiles (per tick)
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

/**
 * Resolves the baseline mutation probability applied when genomes reproduce
 * without a DNA-provided override. Environment overrides allow experiments to
 * globally calm or accelerate evolutionary churn without code changes.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Mutation probability constrained to the 0..1 interval.
 */
export function resolveMutationChance(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_MUTATION_CHANCE;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_MUTATION_CHANCE;
  }

  if (parsed <= 0) {
    return 0;
  }

  if (parsed >= 1) {
    return 1;
  }

  return parsed;
}

export const MUTATION_CHANCE_BASELINE = resolveMutationChance();

export const SIMULATION_DEFAULTS = Object.freeze({
  paused: false,
  updatesPerSecond: 60,
  // Law 5 (External Influence Restraint): disable environmental events until
  // the user opts in via controls. The multiplier remains configurable but
  // defaults to zero so simulations begin without background interventions.
  eventFrequencyMultiplier: 0,
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
  showLifeEventMarkers: false,
  leaderboardIntervalMs: 750,
  // Lowered from 0.45 after a 300-tick headless sample (60x60 grid, RNG seed
  // 12345) nudged mean diversity from ~0.27 to ~0.30 and bumped successful
  // matings from five to six without eliminating scarcity pressure. The softer
  // gate reduces reproduction stalls in homogenised stretches while keeping the
  // diversity incentive in place.
  matingDiversityThreshold: 0.42,
  // Raised from 0.12 after the population stability harness exposed sporadic
  // collapses in smaller headless runs where kin-heavy pairings dominated.
  // A 0.2 floor keeps similarity penalties meaningful while guaranteeing the
  // ecosystem can recover instead of sliding into extinction spirals when
  // diversity temporarily stalls.
  lowDiversityReproMultiplier: 0.2,
  speedMultiplier: 1,
  autoPauseOnBlur: false,
});

const BOOLEAN_DEFAULT_KEYS = Object.freeze([
  "paused",
  "showObstacles",
  "showEnergy",
  "showDensity",
  "showFitness",
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

  if (
    typeof merged.eventFrequencyMultiplier === "number" ||
    typeof merged.eventFrequencyMultiplier === "string"
  ) {
    merged.eventFrequencyMultiplier = sanitizeNumber(merged.eventFrequencyMultiplier, {
      fallback: defaults.eventFrequencyMultiplier,
      min: 0,
    });
  } else {
    merged.eventFrequencyMultiplier = defaults.eventFrequencyMultiplier;
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
