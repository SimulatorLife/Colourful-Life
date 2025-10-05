import { clamp, sanitizeNumber, coerceBoolean } from "./utils.js";

// Centralized simulation config defaults
const DEFAULT_MAX_TILE_ENERGY = 6;
// Relaxed slightly from 0.5 after a dense-tile probe (energy 2.4, density 0.85)
// showed regeneration recovering ~7% more energy per tick (0.0036 → 0.0039).
// The softer clamp cushions high-traffic hubs without eliminating the density
// pressure that keeps sparse foragers advantaged.
const DEFAULT_REGEN_DENSITY_PENALTY = 0.42;
const DEFAULT_CONSUMPTION_DENSITY_PENALTY = 0.3;
const DEFAULT_COMBAT_TERRITORY_EDGE_FACTOR = 0.25;
const DEFAULT_DECAY_RETURN_FRACTION = 0.9;
const DEFAULT_DECAY_SPAWN_MIN_ENERGY = 1.2;
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
// Tuned baseline regeneration and diffusion keep crowd pressure meaningful while
// still letting sparse regions recover enough to support exploration.
export const ENERGY_REGEN_RATE_DEFAULT = 0.012;
export const ENERGY_DIFFUSION_RATE_DEFAULT = 0.05; // smoothing between tiles (per tick)
export const DENSITY_RADIUS_DEFAULT = 1;
export const COMBAT_EDGE_SHARPNESS_DEFAULT = 3.2;
export const COMBAT_TERRITORY_EDGE_FACTOR = resolveCombatTerritoryEdgeFactor();
export const DECAY_RETURN_FRACTION = resolveDecayReturnFraction();
export const DECAY_SPAWN_MIN_ENERGY = resolveDecaySpawnMinEnergy();

function resolveEnvNumber(
  env,
  key,
  {
    fallback,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    clampResult = false,
  },
) {
  const raw = env?.[key];
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  let lowerBound = min;
  let upperBound = max;
  const hasMin = Number.isFinite(lowerBound);
  const hasMax = Number.isFinite(upperBound);

  if (hasMin && hasMax && lowerBound > upperBound) {
    [lowerBound, upperBound] = [upperBound, lowerBound];
  }

  const belowMin = hasMin && parsed < lowerBound;
  const aboveMax = hasMax && parsed > upperBound;

  if (clampResult) {
    const lower = hasMin ? lowerBound : Number.NEGATIVE_INFINITY;
    const upper = hasMax ? upperBound : Number.POSITIVE_INFINITY;

    return clamp(parsed, lower, upper);
  }

  if (belowMin || aboveMax) {
    return fallback;
  }

  return parsed;
}

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
  return resolveEnvNumber(env, "COLOURFUL_LIFE_REGEN_DENSITY_PENALTY", {
    fallback: DEFAULT_REGEN_DENSITY_PENALTY,
    min: 0,
    max: 1,
  });
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
  return resolveEnvNumber(env, "COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY", {
    fallback: DEFAULT_CONSUMPTION_DENSITY_PENALTY,
    min: 0,
    max: 1,
  });
}

/**
 * Density penalty applied while organisms harvest energy from a tile. Sanitizes
 * `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` into the 0..1 range to prevent
 * overrides from destabilizing tests or overlays.
 */
export const CONSUMPTION_DENSITY_PENALTY = resolveConsumptionDensityPenalty(); // 1 - penalty * density

/**
 * Resolves how much territorial advantage influences combat odds. Environment
 * overrides let deployments emphasise home-ground bonuses or flatten the
 * effect entirely while keeping the final factor within the 0..1 range.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Territory advantage multiplier between 0 and 1.
 */
export function resolveCombatTerritoryEdgeFactor(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR", {
    fallback: DEFAULT_COMBAT_TERRITORY_EDGE_FACTOR,
    min: 0,
    max: 1,
    clampResult: true,
  });
}

/**
 * Resolves how much energy returns to the environment when an organism decays.
 * Environment overrides allow deployments to explore harsher decay losses or
 * more generous recycling without touching simulation code. The helper clamps
 * values into the 0..1 range so overrides remain stable during tests.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Fraction of remaining energy returned to the environment.
 */
export function resolveDecayReturnFraction(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_DECAY_RETURN_FRACTION", {
    fallback: DEFAULT_DECAY_RETURN_FRACTION,
    min: 0,
    max: 1,
    clampResult: true,
  });
}

/**
 * Resolves the minimum amount of energy a decay pool must accumulate before it
 * attempts to seed a new organism. Keeping the limit configurable allows headless
 * experiments and UI runs to explore more opportunistic or cautious decay-driven
 * reproduction without altering simulation code.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Sanitized minimum spawn energy with a zero floor.
 */
export function resolveDecaySpawnMinEnergy(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_DECAY_SPAWN_MIN_ENERGY;
  const parsed = Number.parseFloat(raw);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_DECAY_SPAWN_MIN_ENERGY;
  }

  return sanitizeNumber(parsed, {
    fallback: DEFAULT_DECAY_SPAWN_MIN_ENERGY,
    min: 0,
  });
}

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
  return resolveEnvNumber(env, "COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD", {
    fallback: DEFAULT_TRAIT_ACTIVATION_THRESHOLD,
    min: 0,
    max: 1,
    clampResult: true,
  });
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
  return resolveEnvNumber(env, "COLOURFUL_LIFE_ACTIVITY_BASE_RATE", {
    fallback: DEFAULT_ACTIVITY_BASE_RATE,
    min: 0,
    max: 1,
    clampResult: true,
  });
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
  return resolveEnvNumber(env, "COLOURFUL_LIFE_MUTATION_CHANCE", {
    fallback: DEFAULT_MUTATION_CHANCE,
    min: 0,
    max: 1,
    clampResult: true,
  });
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
  combatTerritoryEdgeFactor: COMBAT_TERRITORY_EDGE_FACTOR,
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
  // Raised from 0.55 after a 600-tick headless probe (30×30 grid, seed 1337)
  // lifted the post-warmup population floor from 47 → 76 and trimmed recent
  // starvation pressure from 0.104 → 0.077 by easing how hard the strategy
  // penalty suppresses kin-heavy stretches. The 0.57 floor keeps similarity
  // pressure meaningful while giving bottlenecked colonies enough births to
  // stabilise.
  lowDiversityReproMultiplier: 0.57,
  speedMultiplier: 1,
  autoPauseOnBlur: false,
  autoReseed: true,
  profileGridMetrics: "auto",
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

const PROFILING_MODE_ALWAYS = "always";
const PROFILING_MODE_NEVER = "never";
const PROFILING_MODE_AUTO = "auto";

const PROFILING_KEYWORD_MAP = Object.freeze({
  always: PROFILING_MODE_ALWAYS,
  auto: PROFILING_MODE_AUTO,
  automatic: PROFILING_MODE_AUTO,
  default: PROFILING_MODE_AUTO,
  enable: PROFILING_MODE_ALWAYS,
  enabled: PROFILING_MODE_ALWAYS,
  disable: PROFILING_MODE_NEVER,
  disabled: PROFILING_MODE_NEVER,
  metrics: PROFILING_MODE_ALWAYS,
  never: PROFILING_MODE_NEVER,
  off: PROFILING_MODE_NEVER,
  on: PROFILING_MODE_ALWAYS,
  profile: PROFILING_MODE_ALWAYS,
  profiling: PROFILING_MODE_ALWAYS,
  stats: PROFILING_MODE_AUTO,
  true: PROFILING_MODE_ALWAYS,
  false: PROFILING_MODE_NEVER,
  yes: PROFILING_MODE_ALWAYS,
  no: PROFILING_MODE_NEVER,
});

function normalizeProfileGridMetrics(value, fallback = PROFILING_MODE_AUTO) {
  const fallbackMode =
    typeof fallback === "string" && fallback.length > 0
      ? fallback
      : PROFILING_MODE_AUTO;

  if (value === true) return PROFILING_MODE_ALWAYS;
  if (value === false) return PROFILING_MODE_NEVER;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return fallbackMode;
    }

    if (value > 0) return PROFILING_MODE_ALWAYS;
    if (value === 0) return PROFILING_MODE_NEVER;

    return fallbackMode;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized.length === 0) {
      return fallbackMode;
    }

    if (Object.hasOwn(PROFILING_KEYWORD_MAP, normalized)) {
      return PROFILING_KEYWORD_MAP[normalized];
    }
  }

  if (value == null) {
    return fallbackMode;
  }

  return fallbackMode;
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

  merged.autoReseed = coerceBoolean(overrides.autoReseed, defaults.autoReseed);

  merged.profileGridMetrics = normalizeProfileGridMetrics(
    Object.hasOwn(overrides, "profileGridMetrics")
      ? overrides.profileGridMetrics
      : merged.profileGridMetrics,
    defaults.profileGridMetrics ?? PROFILING_MODE_AUTO,
  );

  const concurrencyValue = Number(merged.maxConcurrentEvents);

  if (!Number.isFinite(concurrencyValue)) {
    merged.maxConcurrentEvents = defaults.maxConcurrentEvents;
  } else {
    merged.maxConcurrentEvents = Math.max(0, Math.floor(concurrencyValue));
  }

  const hasUpdatesOverride = Object.hasOwn(overrides, "updatesPerSecond");
  const hasSpeedOverride = Object.hasOwn(overrides, "speedMultiplier");
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
