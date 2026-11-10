import { clamp, randomRange, sanitizeNumber } from "../utils/math.js";

/**
 * Default cadence window (in ticks) used when no spawn cooldown range is
 * provided. Values are exposed as an immutable reference so callers can clone
 * the range when building their own config without risking shared mutation.
 */
export const DEFAULT_SPAWN_COOLDOWN_RANGE = Object.freeze({ min: 180, max: 480 });

/**
 * Default shape, intensity, and span ranges applied to freshly generated
 * events. The object is frozen so consumers can rely on its identity; helpers
 * that need to mutate the fields clone them first.
 */
export const DEFAULT_RANDOM_EVENT_CONFIG = Object.freeze({
  durationRange: Object.freeze({ min: 300, max: 900 }),
  strengthRange: Object.freeze({ min: 0.25, max: 1 }),
  span: Object.freeze({ min: 10, ratio: 1 / 3 }),
});

function sanitizeNumericRange(range, fallback, { min: minBound, max: maxBound } = {}) {
  const candidate = range ?? {};
  const rawMin = Number.isFinite(candidate.min)
    ? candidate.min
    : Array.isArray(candidate) && Number.isFinite(candidate[0])
      ? candidate[0]
      : undefined;
  const rawMax = Number.isFinite(candidate.max)
    ? candidate.max
    : Array.isArray(candidate) && Number.isFinite(candidate[1])
      ? candidate[1]
      : undefined;

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return { ...fallback };
  }

  let min = rawMin;
  let max = rawMax;

  if (min > max) {
    [min, max] = [max, min];
  }

  if (Number.isFinite(minBound)) {
    min = Math.max(min, minBound);
  }

  if (Number.isFinite(maxBound)) {
    max = Math.min(max, maxBound);
  }

  if (max < min) {
    return { ...fallback };
  }

  return { min, max };
}

function sanitizeSpanConfig(candidate, fallback) {
  if (!candidate || typeof candidate !== "object") {
    return { ...fallback };
  }

  const ratioCandidate = candidate.ratio ?? candidate.fraction ?? candidate.maxFraction;

  const min = sanitizeNumber(candidate.min, {
    fallback: fallback.min,
    min: 1,
    round: Math.floor,
  });

  const ratio = sanitizeNumber(ratioCandidate, {
    fallback: fallback.ratio,
    min: 0,
    max: 1,
  });

  return { min, ratio };
}

export function sanitizeRandomEventConfig(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return {
      durationRange: { ...DEFAULT_RANDOM_EVENT_CONFIG.durationRange },
      strengthRange: { ...DEFAULT_RANDOM_EVENT_CONFIG.strengthRange },
      span: { ...DEFAULT_RANDOM_EVENT_CONFIG.span },
    };
  }

  const durationRange = sanitizeNumericRange(
    candidate.durationRange,
    DEFAULT_RANDOM_EVENT_CONFIG.durationRange,
    {
      min: 1,
    },
  );
  const strengthRange = sanitizeNumericRange(
    candidate.strengthRange,
    DEFAULT_RANDOM_EVENT_CONFIG.strengthRange,
    { min: 0 },
  );
  const span = sanitizeSpanConfig(candidate.span, DEFAULT_RANDOM_EVENT_CONFIG.span);

  return { durationRange, strengthRange, span };
}

/**
 * Samples the horizontal or vertical span (in grid cells) that a randomly
 * generated event should cover. The helper defends against misconfigured
 * ranges by clamping values to sane bounds so downstream code never receives a
 * zero or negative length.
 *
 * @param {number} limit - Maximum available span, typically the grid dimension
 *   under consideration.
 * @param {() => number} rng - Random number generator returning a float in the
 *   range `[0, 1)`.
 * @param {{min?: number, ratio?: number}} [spanConfig=DEFAULT_RANDOM_EVENT_CONFIG.span]
 *   - Caller-supplied overrides for the minimum span and the fraction of the
 *   limit to target. Missing or invalid properties fall back to
 *   `DEFAULT_RANDOM_EVENT_CONFIG.span`.
 * @returns {number} Integer span guaranteed to be at least 1 and at most the
 *   provided limit.
 */
export function sampleEventSpan(
  limit,
  rng,
  spanConfig = DEFAULT_RANDOM_EVENT_CONFIG.span,
) {
  const maxSpan = Math.max(1, Math.floor(limit));
  const { min: sanitizedMin, ratio } = sanitizeSpanConfig(
    spanConfig,
    DEFAULT_RANDOM_EVENT_CONFIG.span,
  );
  const minSpan = Math.min(sanitizedMin, maxSpan);
  const spanCandidate = Math.max(minSpan, Math.floor(maxSpan * ratio));
  const upperExclusive = spanCandidate === minSpan ? minSpan + 1 : spanCandidate + 1;
  const raw = Math.floor(randomRange(minSpan, upperExclusive, rng));

  return clamp(raw, 1, maxSpan);
}

/**
 * Ensures an event's starting coordinate keeps the requested span within the
 * grid bounds. When the grid is smaller than the span, the event is forced to
 * start at `0`, which effectively covers the entire axis without wrapping.
 *
 * @param {number} rawStart - Proposed starting index for the event.
 * @param {number} span - Number of cells the event should cover.
 * @param {number} limit - Total number of cells along the axis being targeted.
 * @returns {number} Clamped starting index in the inclusive range `[0, limit - span]`.
 */
export function clampEventStart(rawStart, span, limit) {
  const maxStart = Math.max(0, Math.floor(limit) - span);

  if (maxStart <= 0) {
    return 0;
  }

  return clamp(rawStart, 0, maxStart);
}

/**
 * Resolves the cadence window used between spawns. Cloning the source range
 * ensures downstream code can mutate the returned object without disturbing
 * shared defaults.
 *
 * @param {{min?: number, max?: number} | number[] | null | undefined} candidate
 * @returns {{min: number, max: number}}
 */
export function resolveSpawnCooldownRange(candidate) {
  return sanitizeNumericRange(candidate, DEFAULT_SPAWN_COOLDOWN_RANGE, { min: 0 });
}

/**
 * Pure policy helper: describes "what" an event should look like without
 * performing any state mutation. The returned plan is consumed by the
 * {@link EventManager} mechanism to construct and append a new event.
 *
 * @param {Object} params
 * @param {() => string} params.pickEventType - Resolved event-type selector
 *   (already wrapped with fallbacks by the manager).
 * @param {{durationRange:{min:number,max:number}, strengthRange:{min:number,max:number}, span:{min:number,ratio:number}}} params.randomEventConfig
 *   - Sanitized ranges for duration, strength, and span.
 * @param {number} params.rows - Grid row count (used to bound the area).
 * @param {number} params.cols - Grid column count (used to bound the area).
 * @param {() => number} params.rng - Random source returning `[0, 1)`.
 * @returns {{eventType:string, duration:number, strength:number, affectedArea:{x:number,y:number,width:number,height:number}}}
 */
export function planRandomEvent({ pickEventType, randomEventConfig, rows, cols, rng }) {
  if (typeof pickEventType !== "function") {
    throw new TypeError(
      "planRandomEvent requires a pickEventType function for event-type selection.",
    );
  }

  const { durationRange, strengthRange, span } = randomEventConfig;

  const eventType = pickEventType();
  const duration = Math.floor(randomRange(durationRange.min, durationRange.max, rng));
  const strength = randomRange(strengthRange.min, strengthRange.max, rng);
  const rawX = Math.floor(randomRange(0, cols, rng));
  const rawY = Math.floor(randomRange(0, rows, rng));
  const width = sampleEventSpan(cols, rng, span);
  const height = sampleEventSpan(rows, rng, span);
  const x = clampEventStart(rawX, width, cols);
  const y = clampEventStart(rawY, height, rows);

  return {
    eventType,
    duration,
    strength,
    affectedArea: { x, y, width, height },
  };
}

/**
 * Pure policy helper: computes the cooldown (in ticks) before the next event
 * can spawn, scaled by the configured frequency multiplier. Larger multipliers
 * shorten the wait; non-positive values fall back to a minimum divisor so the
 * manager never divides by zero or produces a negative cooldown.
 *
 * @param {Object} params
 * @param {() => number} params.rng - Random source returning `[0, 1)`.
 * @param {number} params.frequencyMultiplier - Tunable that compresses the
 *   cadence; `> 0` is expected, but values `<= 0` are tolerated as "disabled".
 * @param {{min:number,max:number}} [params.cooldownRange=DEFAULT_SPAWN_COOLDOWN_RANGE]
 *   - Inclusive `[min, max)` window sampled before frequency scaling.
 * @returns {number} Integer cooldown in `[0, ∞)` ticks.
 */
export function planSpawnCooldown({ rng, frequencyMultiplier, cooldownRange } = {}) {
  const range = resolveSpawnCooldownRange(cooldownRange);
  const base = Math.floor(randomRange(range.min, range.max, rng));
  const divisor = Math.max(0.01, Number(frequencyMultiplier) || 0);

  return Math.max(0, Math.floor(base / divisor));
}
