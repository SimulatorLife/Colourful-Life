import {
  clamp,
  sanitizeNumber,
  sanitizePositiveInteger,
  applyIntervalFloor,
} from "./utils/math.js";
import { coerceBoolean } from "./utils/primitives.js";

// Centralized simulation config defaults
const DEFAULT_MAX_TILE_ENERGY = 2;
// Relaxed slightly from 0.5 after a dense-tile probe (energy 2.4, density 0.85)
// showed regeneration recovering ~7% more energy per tick (0.0036 → 0.0039).
// The softer clamp cushions high-traffic hubs without eliminating the density
// pressure that keeps sparse foragers advantaged.
const DEFAULT_REGEN_DENSITY_PENALTY = 0.39;
// High-density probe (computeTileEnergyUpdate, density 0.85, energy 1.2)
// showed regen climbing from ~0.00309 → ~0.00321 energy per tick when the
// penalty eased to 0.39, enough headroom for crowded hubs to stop drifting
// into starvation while still suppressing runaway refills in traffic pockets.
const DEFAULT_CONSUMPTION_DENSITY_PENALTY = 0.3;
const DEFAULT_COMBAT_TERRITORY_EDGE_FACTOR = 0.25;
// Dialed back from 0.90 after a 45×45 headless run (`scripts/profile-energy.mjs`
// with 0.8 seed density, 40-tick warmup, 200-tick sample) trimmed cumulative
// starvation deaths from 875 → 861 while nudging the surviving population
// from 114 → 116. The lighter recycling still honours the decay loop but
// leaves a touch more scarcity in high-traffic graves so crowded clusters stop
// bouncing between feast and famine every decay pulse.
const DEFAULT_DECAY_RELEASE_BASE = 0.12;
const DEFAULT_DECAY_RELEASE_RATE = 0.18;
const DEFAULT_DECAY_RETURN_FRACTION = 0.89;
// Nudged from 0.88 after the dense 40×40 headless probe
// (`PERF_INCLUDE_SIM=1 PERF_SIM_ROWS=40 PERF_SIM_COLS=40 PERF_SIM_WARMUP=20`
// `PERF_SIM_ITERATIONS=80 PERF_SIM_DENSITY=0.68 node scripts/profile-energy.mjs`)
// raised the final population from 135 → 137 while trimming ms-per-tick
// from ~135ms → ~99ms. The extra retained energy lets contested graves recover
// without erasing scarcity in calmer regions.
// Nudged from 0.26 → 0.27 after rerunning the dense 40×40 headless probe
// (`PERF_INCLUDE_SIM=1 PERF_SIM_ROWS=40 PERF_SIM_COLS=40 PERF_SIM_WARMUP=20`
//  `PERF_SIM_ITERATIONS=80 PERF_SIM_DENSITY=0.68 node scripts/profile-energy.mjs`).
// Survivors climbed from 133 → 148 while trimmed ms-per-tick rose from ~86.2ms →
// ~100ms—still comfortably under the 125ms watchdog. The richer splash lets
// crowded graveyards rebound before bottlenecked colonies stall, at the cost of
// a modest scheduling tax that headless workloads can absorb.
const DEFAULT_DECAY_IMMEDIATE_SHARE = 0.27;
const DEFAULT_DECAY_MAX_AGE = 240;
const DEFAULT_TRAIT_ACTIVATION_THRESHOLD = 0.6;
// Raised from 0.28 after a compact 20×20 headless probe
// (`COLOURFUL_LIFE_ACTIVITY_BASE_RATE=0.2822 PERF_INCLUDE_SIM=1 PERF_SIM_ROWS=20`
// `PERF_SIM_COLS=20 PERF_SIM_ITERATIONS=30 node scripts/profile-energy.mjs`)
// lifted post-warmup survivors from 83 → 87 across 30 ticks while the per-tick
// runtime held near 69ms. The modest bump keeps jammed colonies foraging before
// combat drains them without tripping the benchmark's 125ms ceiling during the
// 14×14 performance probe.
const DEFAULT_ACTIVITY_BASE_RATE = 0.2822;
// Calmed from 0.15 after the dense 60×60 headless probe
// (`PERF_INCLUDE_SIM=1 PERF_SIM_ITERATIONS=120 node scripts/profile-energy.mjs`)
// trimmed tick cost from ~100.2ms → ~98.3ms while holding survivors steady at
// 282. The softer baseline tempers runaway genome churn without choking off the
// diversity trickle that keeps bottlenecked colonies adapting.
const DEFAULT_MUTATION_CHANCE = 0.142;
const DEFAULT_REPRODUCTION_COOLDOWN_BASE = 2;
// Leaned from 0.012 after rerunning the dense 60×60 headless probe
// (`PERF_INCLUDE_SIM=1 PERF_SIM_ITERATIONS=120 node scripts/profile-energy.mjs`)
// with regeneration at 0.0117. Survivors ticked up from 344 → 346 while the
// simulation benchmark's tick cost eased from ~138.4ms → ~135.1ms, signalling
// that the slightly leaner trickle calms feast/famine swings without starving
// recovering foragers.
const DEFAULT_ENERGY_REGEN_RATE = 0.0117;
const DEFAULT_INITIAL_TILE_ENERGY_FRACTION = 0.5;
const DEFAULT_ENERGY_DIFFUSION_RATE = 0.05; // smoothing between tiles (per tick)
// Relaxed from 1.11 after rerunning the 40×40 headless probe
// (`PERF_INCLUDE_SIM=1 PERF_SIM_ROWS=40 PERF_SIM_COLS=40 PERF_SIM_WARMUP=10`
// `PERF_SIM_ITERATIONS=50 PERF_SIM_DENSITY=0.65 node scripts/profile-energy.mjs`)
// bumped the post-warmup survivors from 206 → 209 while trimming the raw
// ms-per-tick from ~405.13 → ~385.57. The lighter reserve requirement lets
// crowded parents restart gestation a tick earlier once they bank safety
// margins, easing population dips without letting low-energy lineages spam
// births.
const DEFAULT_OFFSPRING_VIABILITY_BUFFER = 1.09;
const DEFAULT_MATE_DIVERSITY_SAMPLE_LIMIT = 5;
// Telemetry defaults to highlighting the top five lineages. Expose the size so
// headless consumers and UI presets can extend the leaderboard without touching
// the engine internals.
const DEFAULT_LEADERBOARD_SIZE = 5;

export const LEADERBOARD_SIZE_DEFAULT = DEFAULT_LEADERBOARD_SIZE;
export const LEADERBOARD_INTERVAL_MIN_MS = 100;
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
/**
 * Resolves the baseline tile regeneration rate applied before density and event
 * modifiers kick in. Allowing environments to override the default keeps the
 * ecosystem tunable without code edits while still constraining rates to a
 * stable 0..1 interval so tests remain deterministic.
 */
export function resolveEnergyRegenRate(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_ENERGY_REGEN_RATE", {
    fallback: DEFAULT_ENERGY_REGEN_RATE,
    min: 0,
    max: 1,
  });
}

export const ENERGY_REGEN_RATE_DEFAULT = resolveEnergyRegenRate();

/**
 * Resolves the baseline proportion of energy that diffuses from a tile to its
 * neighbours each tick. Environment overrides let deployments explore more
 * insulated or more free-flowing ecosystems without touching the simulation
 * code, while the sanitizer constrains the rate to a stable 0..1 interval so
 * headless tests and UI overlays remain deterministic.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Diffusion rate bounded between 0 and 1.
 */
export function resolveEnergyDiffusionRate(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_ENERGY_DIFFUSION_RATE", {
    fallback: DEFAULT_ENERGY_DIFFUSION_RATE,
    min: 0,
    max: 1,
  });
}

export const ENERGY_DIFFUSION_RATE_DEFAULT = resolveEnergyDiffusionRate();

/**
 * Resolves the fraction of the tile's maximum energy used to seed newly created
 * grids. Allowing overrides keeps headless probes and UI presets flexible when
 * exploring harsher or more generous starting conditions while clamping the
 * value to the stable 0..1 interval so tests remain deterministic.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Initial energy fraction clamped to the 0..1 interval.
 */
export function resolveInitialTileEnergyFraction(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_INITIAL_TILE_ENERGY_FRACTION", {
    fallback: DEFAULT_INITIAL_TILE_ENERGY_FRACTION,
    min: 0,
    max: 1,
    clampResult: true,
  });
}

export const INITIAL_TILE_ENERGY_FRACTION_DEFAULT = resolveInitialTileEnergyFraction();
export const DENSITY_RADIUS_DEFAULT = 1;

/**
 * Resolves the neighbourhood radius used when sampling crowd density around a
 * tile. Allowing environment overrides keeps the crowd feedback loop tunable
 * without code edits while clamping the value to a positive integer so grid
 * integration stays deterministic across browser and headless runs.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Positive integer radius applied when measuring density.
 */
export function resolveDensityRadius(env = RUNTIME_ENV) {
  return sanitizePositiveInteger(env?.COLOURFUL_LIFE_DENSITY_RADIUS, {
    fallback: DENSITY_RADIUS_DEFAULT,
    min: 1,
  });
}

export const DENSITY_RADIUS = resolveDensityRadius();
export const COMBAT_EDGE_SHARPNESS_DEFAULT = 3.2;
export const COMBAT_TERRITORY_EDGE_FACTOR = resolveCombatTerritoryEdgeFactor();
export const DECAY_RETURN_FRACTION = resolveDecayReturnFraction();
export const DECAY_IMMEDIATE_SHARE = resolveDecayImmediateShare();
export const DECAY_MAX_AGE = resolveDecayMaxAge();
export const MATE_DIVERSITY_SAMPLE_LIMIT_DEFAULT = resolveMateDiversitySampleLimit();

/**
 * Resolves the baseline energy returned to the environment whenever a decay
 * pool releases stored resources. The override lets deployments amplify or
 * soften the minimum trickle recycled from fallen organisms while keeping the
 * value bounded by the maximum tile capacity.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Baseline decay release clamped to the 0..MAX_TILE_ENERGY range.
 */
export function resolveDecayReleaseBase(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_DECAY_RELEASE_BASE", {
    fallback: DEFAULT_DECAY_RELEASE_BASE,
    min: 0,
    max: MAX_TILE_ENERGY,
    clampResult: true,
  });
}

export const DECAY_RELEASE_BASE = resolveDecayReleaseBase();
export const DECAY_RELEASE_RATE = resolveDecayReleaseRate();

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
 * Resolves the fraction of recycled energy that spills immediately into
 * neighbouring tiles when an organism decays. Environment overrides make the
 * instantaneous redistribution tunable so deployments can emphasize on-the-spot
 * feasts or longer, smouldering reserves without touching simulation code.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Immediate share fraction constrained to the 0..1 interval.
 */
export function resolveDecayImmediateShare(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE", {
    fallback: DEFAULT_DECAY_IMMEDIATE_SHARE,
    min: 0,
    max: 1,
    clampResult: true,
  });
}

/**
 * Resolves the fraction of a decay pool that dissipates each tick after the
 * baseline release applies. Environment overrides allow deployments to slow or
 * accelerate how quickly stored energy re-enters the ecosystem while keeping
 * the value bounded for deterministic tests.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Release rate multiplier constrained to the 0..1 range.
 */
export function resolveDecayReleaseRate(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_DECAY_RELEASE_RATE", {
    fallback: DEFAULT_DECAY_RELEASE_RATE,
    min: 0,
    max: 1,
    clampResult: true,
  });
}

/**
 * Resolves the maximum number of ticks a decay pool persists before it fully
 * dissipates. Allowing deployments to extend or shorten this window makes the
 * post-mortem energy trickle tunable without altering simulation code.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Positive integer limit on decay lifetime.
 */
export function resolveDecayMaxAge(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_DECAY_MAX_AGE;

  return sanitizePositiveInteger(raw, {
    fallback: DEFAULT_DECAY_MAX_AGE,
    min: 1,
  });
}

/**
 * Resolves how many high-diversity mates each organism samples when estimating
 * the opportunity landscape around them. Allowing deployments to tune the
 * window keeps the mating heuristic adaptable for denser or sparser colonies
 * without requiring code changes. The helper constrains overrides to a sensible
 * range so tests remain deterministic while still giving headless probes room
 * to explore broader sampling strategies.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Positive integer sample limit used by diversity summaries.
 */
export function resolveMateDiversitySampleLimit(env = RUNTIME_ENV) {
  const raw = env?.COLOURFUL_LIFE_MATE_DIVERSITY_SAMPLE_LIMIT;

  return sanitizePositiveInteger(raw, {
    fallback: DEFAULT_MATE_DIVERSITY_SAMPLE_LIMIT,
    min: 1,
    max: 32,
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

/**
 * Resolves the minimum reproduction cooldown applied after a successful birth
 * when genomes do not specify their own duration or attempt to undercut the
 * global pacing. Environment overrides let deployments slow or accelerate the
 * reproductive cadence without rewriting DNA accessors, while the sanitizer
 * keeps values non-negative so tests remain deterministic.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Non-negative cooldown baseline applied as a floor.
 */
export function resolveReproductionCooldownBase(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_REPRODUCTION_COOLDOWN_BASE", {
    fallback: DEFAULT_REPRODUCTION_COOLDOWN_BASE,
    min: 0,
  });
}

export const REPRODUCTION_COOLDOWN_BASE = resolveReproductionCooldownBase();
/**
 * Resolves the multiplier applied to the higher of two parents' minimum energy
 * demand when determining whether offspring are viable. This keeps the
 * reproduction gate configurable so deployments can tighten or loosen how much
 * surplus energy lineages must hold before investing in offspring.
 *
 * @param {Record<string, string | undefined>} [env=RUNTIME_ENV]
 *   Environment-like object to inspect. Defaults to `process.env` when
 *   available so browser builds can safely skip the lookup.
 * @returns {number} Viability multiplier clamped to the 1..2 interval.
 */
export function resolveOffspringViabilityBuffer(env = RUNTIME_ENV) {
  return resolveEnvNumber(env, "COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER", {
    fallback: DEFAULT_OFFSPRING_VIABILITY_BUFFER,
    min: 1,
    max: 2,
    clampResult: true,
  });
}

export const OFFSPRING_VIABILITY_BUFFER = resolveOffspringViabilityBuffer();
export const SIMULATION_DEFAULTS = Object.freeze({
  paused: false,
  updatesPerSecond: 60,
  // Law 6 (External Influence Restraint): disable environmental events until
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
  initialTileEnergyFraction: INITIAL_TILE_ENERGY_FRACTION_DEFAULT,
  showObstacles: true,
  showEnergy: false,
  showDensity: false,
  showAge: false,
  showFitness: false,
  showLifeEventMarkers: false,
  showGridLines: false,
  showReproductiveZones: true,
  lifeEventFadeTicks: 36,
  lifeEventLimit: 24,
  leaderboardIntervalMs: 750,
  leaderboardSize: LEADERBOARD_SIZE_DEFAULT,
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
});

const BOOLEAN_DEFAULT_KEYS = Object.freeze([
  "paused",
  "showObstacles",
  "showEnergy",
  "showDensity",
  "showAge",
  "showFitness",
  "showLifeEventMarkers",
  "showGridLines",
  "showReproductiveZones",
  "autoPauseOnBlur",
]);

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

  const concurrencyValue = sanitizeNumber(merged.maxConcurrentEvents, {
    fallback: defaults.maxConcurrentEvents,
    min: 0,
    round: Math.floor,
  });

  merged.maxConcurrentEvents = Number.isFinite(concurrencyValue)
    ? concurrencyValue
    : defaults.maxConcurrentEvents;

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

  const initialEnergyFraction = sanitizeNumber(merged.initialTileEnergyFraction, {
    fallback: defaults.initialTileEnergyFraction,
    min: 0,
    max: 1,
  });

  merged.initialTileEnergyFraction = Number.isFinite(initialEnergyFraction)
    ? initialEnergyFraction
    : defaults.initialTileEnergyFraction;

  const sanitizeNumeric = (key, options = {}) => {
    merged[key] = sanitizeNumber(merged[key], {
      fallback: defaults[key],
      ...options,
    });
  };

  sanitizeNumeric("mutationMultiplier", { min: 0 });
  sanitizeNumeric("densityEffectMultiplier", { min: 0 });
  sanitizeNumeric("societySimilarity", { min: 0, max: 1 });
  sanitizeNumeric("enemySimilarity", { min: 0, max: 1 });
  sanitizeNumeric("eventStrengthMultiplier", { min: 0 });
  sanitizeNumeric("energyRegenRate", { min: 0, max: 1 });
  sanitizeNumeric("energyDiffusionRate", { min: 0, max: 1 });
  sanitizeNumeric("combatEdgeSharpness", { min: 0.1 });
  sanitizeNumeric("combatTerritoryEdgeFactor", { min: 0, max: 1 });
  sanitizeNumeric("lifeEventFadeTicks", {
    min: 1,
    round: Math.round,
  });
  sanitizeNumeric("lifeEventLimit", {
    min: 0,
    round: Math.floor,
  });
  const intervalCandidate = sanitizeNumber(merged.leaderboardIntervalMs, {
    fallback: Number.NaN,
  });

  if (Number.isFinite(intervalCandidate)) {
    merged.leaderboardIntervalMs = applyIntervalFloor(
      intervalCandidate,
      LEADERBOARD_INTERVAL_MIN_MS,
    );
  } else {
    merged.leaderboardIntervalMs = defaults.leaderboardIntervalMs;
  }
  sanitizeNumeric("leaderboardSize", { min: 0, round: Math.floor });
  sanitizeNumeric("matingDiversityThreshold", { min: 0, max: 1 });
  sanitizeNumeric("lowDiversityReproMultiplier", { min: 0, max: 1 });

  return merged;
}
