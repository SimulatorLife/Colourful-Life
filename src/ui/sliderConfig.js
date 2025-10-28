import {
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  COMBAT_TERRITORY_EDGE_FACTOR,
  LEADERBOARD_INTERVAL_MIN_MS,
  SIMULATION_DEFAULTS,
} from "../config.js";
import { clamp } from "../utils/math.js";

// UI defaults and slider bounds derived from canonical simulation defaults.
export const UI_SLIDER_CONFIG = Object.freeze({
  societySimilarity: {
    default: SIMULATION_DEFAULTS.societySimilarity,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  enemySimilarity: {
    default: SIMULATION_DEFAULTS.enemySimilarity,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  eventStrengthMultiplier: {
    default: SIMULATION_DEFAULTS.eventStrengthMultiplier,
    min: 0,
    max: 3,
    step: 0.05,
    floor: 0,
  },
  eventFrequencyMultiplier: {
    default: SIMULATION_DEFAULTS.eventFrequencyMultiplier,
    min: 0,
    max: 3,
    step: 0.1,
    floor: 0,
  },
  speedMultiplier: {
    default: SIMULATION_DEFAULTS.speedMultiplier,
    min: 0.5,
    max: 100,
    step: 0.5,
    floor: 0.1,
  },
  densityEffectMultiplier: {
    default: SIMULATION_DEFAULTS.densityEffectMultiplier,
    min: 0,
    max: 2,
    step: 0.05,
    floor: 0,
  },
  initialTileEnergyFraction: {
    default: SIMULATION_DEFAULTS.initialTileEnergyFraction,
    min: 0,
    max: 1,
    step: 0.05,
    floor: 0,
  },
  mutationMultiplier: {
    default: SIMULATION_DEFAULTS.mutationMultiplier,
    min: 0,
    max: 3,
    step: 0.05,
    floor: 0,
  },
  matingDiversityThreshold: {
    default: SIMULATION_DEFAULTS.matingDiversityThreshold,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  lowDiversityReproMultiplier: {
    default: SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
    min: 0,
    max: 1,
    step: 0.05,
    floor: 0,
  },
  combatEdgeSharpness: {
    default: COMBAT_EDGE_SHARPNESS_DEFAULT,
    min: 0.5,
    max: 6,
    step: 0.1,
    floor: 0.1,
  },
  combatTerritoryEdgeFactor: {
    default: COMBAT_TERRITORY_EDGE_FACTOR,
    min: 0,
    max: 1,
    step: 0.05,
    floor: 0,
  },
  energyRegenRate: {
    min: 0,
    max: 0.2,
    step: 0.005,
    floor: 0,
  },
  energyDiffusionRate: {
    min: 0,
    max: 0.5,
    step: 0.01,
    floor: 0,
  },
  leaderboardIntervalMs: {
    default: SIMULATION_DEFAULTS.leaderboardIntervalMs,
    min: LEADERBOARD_INTERVAL_MIN_MS,
    max: 3000,
    step: 50,
    floor: 0,
  },
});

/**
 * Merges a slider's canonical bounds with caller-specified fallbacks.
 * Centralising the lookup keeps UI modules from duplicating nullish-coalescing
 * logic every time they need to respect the shared configuration defaults.
 *
 * @param {keyof typeof UI_SLIDER_CONFIG|string} key - Slider identifier.
 * @param {{
 *   min?: number,
 *   max?: number,
 *   step?: number,
 *   floor?: number,
 *   default?: number,
 * }} [overrides] - Caller-provided fallback values used when the canonical
 *   config omits a property.
 * @returns {{
 *   min: number|undefined,
 *   max: number|undefined,
 *   step: number|undefined,
 *   floor: number|undefined,
 *   default: number|undefined,
 * }} Resolved slider bounds combining the shared config and overrides.
 */
export function resolveSliderBounds(key, overrides = {}) {
  const entry = (UI_SLIDER_CONFIG && UI_SLIDER_CONFIG[key]) || {};
  const floor = entry.floor ?? overrides.floor;
  const resolved = {
    default: entry.default ?? overrides.default,
    min: entry.min ?? overrides.min,
    max: entry.max ?? overrides.max,
    step: entry.step ?? overrides.step,
    floor,
  };

  return resolved;
}

/**
 * Coerces a slider candidate to the resolved bounds for the given key.
 * Consumers can optionally supply overrides for the canonical limits and a
 * fallback used when the candidate cannot be converted to a finite number.
 *
 * @param {keyof typeof UI_SLIDER_CONFIG|string} key - Slider identifier.
 * @param {unknown} value - Candidate value provided by the caller.
 * @param {{
 *   fallback?: unknown,
 *   min?: number,
 *   max?: number,
 *   floor?: number,
 * }} [overrides] - Optional configuration applied on top of the canonical
 *   slider config.
 * @returns {{
 *   value: unknown,
 *   bounds: {
 *     default: number | undefined,
 *     min: number | undefined,
 *     max: number | undefined,
 *     step: number | undefined,
 *     floor: number | undefined,
 *   },
 * }} Normalized slider value and the resolved bounds used for coercion.
 */
export function clampSliderValue(key, value, overrides = {}) {
  const { fallback, ...boundsOverrides } = overrides;
  const bounds = resolveSliderBounds(key, boundsOverrides);
  const floor = Number.isFinite(bounds.floor) ? bounds.floor : undefined;
  const min = Number.isFinite(bounds.min) ? bounds.min : undefined;
  const max = Number.isFinite(bounds.max) ? bounds.max : undefined;
  const lowerBound = floor ?? min ?? Number.NEGATIVE_INFINITY;
  const upperBound = max ?? Number.POSITIVE_INFINITY;
  const numeric = Number(value);
  let normalized;

  if (Number.isFinite(numeric)) {
    normalized = clamp(numeric, lowerBound, upperBound);
  } else if (Object.prototype.hasOwnProperty.call(overrides, "fallback")) {
    if (typeof fallback === "number" && Number.isFinite(fallback)) {
      normalized = clamp(fallback, lowerBound, upperBound);
    } else {
      normalized = fallback;
    }
  }

  return { value: normalized, bounds };
}
