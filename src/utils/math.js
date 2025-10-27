/**
 * Numeric and math-oriented helpers shared across the simulation.
 * Centralising the logic keeps consumers from depending on the entire
 * catch-all `utils.js` module while still providing a focused toolkit for
 * range clamping, sanitisation, interpolation, and deterministic randomness.
 */

/**
 * Generates a random floating-point number between `min` (inclusive) and
 * `max` (exclusive) using the provided RNG.
 *
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @param {() => number} [rng=Math.random] - Random source returning [0, 1).
 * @returns {number} Randomized value within the range.
 */
export function randomRange(min, max, rng = Math.random) {
  return rng() * (max - min) + min;
}

/**
 * Performs a linear interpolation between `a` and `b` clamping `t` to [0, 1].
 *
 * @param {number} a - Start value.
 * @param {number} b - End value.
 * @param {number} t - Interpolation factor.
 * @returns {number} Interpolated result.
 */
export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

/**
 * Clamps `value` to the `[min, max]` interval.
 *
 * @param {number} value - Candidate value.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} Clamped value.
 */
export function clamp(value, min, max) {
  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

/**
 * Clamps a candidate to the `[min, max]` interval after verifying it is finite.
 * When the candidate is non-finite (including `NaN`, `Infinity`, strings, etc.)
 * the provided fallback is used instead.
 *
 * @param {any} value - Candidate value supplied by callers.
 * @param {number} min - Lower bound applied to the sanitized result.
 * @param {number} max - Upper bound applied to the sanitized result.
 * @param {number} [fallback=min] - Replacement used when `value` is non-finite.
 * @returns {number} Clamped, finite number.
 */
export function clampFinite(value, min, max, fallback = min) {
  const numeric = Number(value);
  const fallbackNumeric = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumeric) ? fallbackNumeric : min;
  const candidate = Number.isFinite(numeric) ? numeric : safeFallback;

  return clamp(candidate, min, max);
}

/**
 * Clamps values to the [0, 1] range, treating non-finite inputs as 0.
 *
 * @param {number} value - Candidate value.
 * @returns {number} Clamped 0–1 result.
 */
export function clamp01(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  if (numeric <= 0) {
    return 0;
  }

  if (numeric >= 1) {
    return 1;
  }

  return numeric;
}

/**
 * Normalizes arbitrary input into a finite number, optionally constraining the
 * result to a range and applying rounding. Non-finite inputs (including
 * `NaN`, `Infinity`, empty strings, etc.) return the provided fallback.
 *
 * @param {any} value - Candidate value supplied by callers.
 * @param {Object} [options]
 * @param {number} [options.fallback=Number.NaN] - Value returned when the
 *   candidate fails the finite check.
 * @param {number} [options.min=Number.NEGATIVE_INFINITY] - Lower bound applied
 *   to the sanitized result when finite.
 * @param {number} [options.max=Number.POSITIVE_INFINITY] - Upper bound applied
 *   to the sanitized result when finite.
 * @param {boolean|((value:number)=>number)} [options.round=false] - Either a
 *   boolean that enables `Math.round` or a custom rounding function applied
 *   before range constraints.
 * @returns {number} Finite, sanitized number or the fallback when invalid.
 */
export function sanitizeNumber(
  value,
  {
    fallback = Number.NaN,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    round = false,
  } = {},
) {
  let numeric;

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return fallback;
    }

    try {
      numeric = Number(trimmed);
    } catch (error) {
      return fallback;
    }
  } else {
    try {
      numeric = Number(value);
    } catch (error) {
      return fallback;
    }
  }

  if (!Number.isFinite(numeric)) return fallback;

  let sanitized = numeric;

  if (round === true) {
    sanitized = Math.round(sanitized);
  } else if (typeof round === "function") {
    sanitized = round(sanitized);
  }

  if (!Number.isFinite(sanitized)) return fallback;

  if (Number.isFinite(min)) sanitized = Math.max(min, sanitized);
  if (Number.isFinite(max)) sanitized = Math.min(max, sanitized);

  return Number.isFinite(sanitized) ? sanitized : fallback;
}

/**
 * Normalizes loosely-typed input into a positive integer using the provided
 * fallback when coercion fails. Useful for dimension-like values (rows, cols,
 * cell sizes) that must stay above a minimum bound. Values are floored to the
 * nearest integer to preserve historical behaviour.
 *
 * @param {any} value - Candidate value to normalize.
 * @param {Object} [options]
 * @param {number} [options.fallback=1] - Value returned when normalization
 *   fails. The fallback is also clamped to the provided range.
 * @param {number} [options.min=1] - Minimum allowed integer. When inputs fall
 *   below this boundary the fallback is returned.
 * @param {number} [options.max=Number.POSITIVE_INFINITY] - Maximum allowed
 *   integer. When inputs exceed this boundary the fallback is returned.
 * @returns {number} Normalized positive integer value.
 */
export function sanitizePositiveInteger(
  value,
  { fallback = 1, min = 1, max = Number.POSITIVE_INFINITY } = {},
) {
  const fallbackCandidate = sanitizeNumber(fallback, {
    fallback: min,
    round: Math.floor,
  });
  const fallbackFloored = Number.isFinite(fallbackCandidate)
    ? Math.floor(fallbackCandidate)
    : min;
  const sanitizedFallback = clamp(Math.max(min, fallbackFloored), min, max);
  const candidate = sanitizeNumber(value, {
    fallback: Number.NaN,
    round: Math.floor,
  });

  if (!Number.isFinite(candidate)) {
    return sanitizedFallback;
  }

  const floored = Math.floor(candidate);

  if (floored < min || floored > max) {
    return sanitizedFallback;
  }

  return floored;
}

/**
 * Normalizes loosely-typed input into a non-negative integer, optionally
 * constraining the result to an upper bound. Invalid candidates fall back to a
 * sanitized default that also respects the provided range.
 *
 * @param {any} value - Candidate value to normalize.
 * @param {Object} [options]
 * @param {number} [options.fallback=0] - Value returned when normalization
 *   fails. The fallback is also clamped to the provided range.
 * @param {number} [options.max=Number.POSITIVE_INFINITY] - Maximum allowed
 *   integer. When inputs exceed this boundary the fallback is returned.
 * @returns {number} Normalized non-negative integer value.
 */
export function sanitizeNonNegativeInteger(
  value,
  { fallback = 0, max = Number.POSITIVE_INFINITY } = {},
) {
  return sanitizePositiveInteger(value, { fallback, min: 0, max });
}

/**
 * Returns the first finite, positive number from the provided candidates. When
 * no candidate qualifies, the supplied fallback is returned instead.
 *
 * @param {Iterable<any>} candidates - Values inspected in order.
 * @param {number|null} [fallback=null] - Value used when no positive number is found.
 * @returns {number|null} First finite positive candidate or the fallback when none qualify.
 */
export function pickFirstFinitePositive(candidates, fallback = null) {
  if (!candidates) return fallback;

  for (const candidate of candidates) {
    const numeric = toFiniteOrNull(candidate);

    if (numeric != null && numeric > 0) {
      return numeric;
    }
  }

  return fallback;
}

/**
 * Converts an arbitrary value to a finite `number` or `null` when conversion
 * fails. Useful when callers need to discard invalid inputs such as `NaN`,
 * infinities, empty strings, or non-numeric primitives before applying further
 * normalization.
 *
 * @param {any} value - Candidate value supplied by callers.
 * @returns {number|null} Finite number or `null` when conversion fails.
 */
export function toFiniteOrNull(value) {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) return null;

    const parsed = Number.parseFloat(trimmed);

    return Number.isFinite(parsed) ? parsed : null;
  }

  if (typeof value === "bigint") {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : null;
  }

  try {
    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : null;
  } catch (error) {
    return null;
  }
}

/**
 * Internal Mulberry32 generator used to create deterministic RNG instances.
 *
 * @param {number} seed - Unsigned 32-bit integer used to seed the generator.
 * @returns {() => number} Deterministic function producing values in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;

  return () => {
    a += 0x6d2b79f5;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a deterministic RNG seeded with the provided integer using the
 * Mulberry32 algorithm. Useful for reproducible tests.
 *
 * @param {number} seed - 32-bit seed value.
 * @returns {() => number} RNG that returns values in [0, 1).
 */
export function createRNG(seed) {
  return mulberry32(seed);
}
