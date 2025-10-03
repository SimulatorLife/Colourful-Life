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
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamps values to the [0, 1] range, treating non-finite inputs as 0.
 *
 * @param {number} value - Candidate value.
 * @returns {number} Clamped 0–1 result.
 */
export function clamp01(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return 0;

  return clamp(numeric, 0, 1);
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
  const numeric = Number(value);

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

  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Normalizes an arbitrary candidate to a plain object. Non-object values are
 * coerced to an empty object so callers can safely destructure nested options
 * without additional guards.
 *
 * @template T
 * @param {T} candidate - Potential object-like value supplied by callers.
 * @returns {T extends object ? T : Object} An object suitable for
 *   destructuring.
 */
export function toPlainObject(candidate) {
  return candidate && typeof candidate === "object" ? candidate : {};
}

/**
 * Deep clones the sensor/node trace payloads used by the brain debugger so the
 * UI can mutate copies without affecting simulation state.
 *
 * @param {Object} trace - Snapshot returned by `brain.snapshot()`.
 * @returns {Object|null} Cloned trace.
 */
export function cloneTracePayload(trace) {
  if (!trace) return null;

  return {
    sensors: Array.isArray(trace.sensors)
      ? trace.sensors.map((entry) => ({ ...entry }))
      : [],
    nodes: Array.isArray(trace.nodes)
      ? trace.nodes.map((entry) => ({
          ...entry,
          inputs: Array.isArray(entry.inputs)
            ? entry.inputs.map((input) => ({ ...input }))
            : [],
        }))
      : [],
  };
}

/**
 * Maintains a sorted, size-limited buffer using the provided comparator. Used
 * for leaderboard selection and other ranked lists.
 *
 * @param {number} limit - Maximum number of entries to retain.
 * @param {(a:any,b:any)=>number} compare - Comparison function returning
 *   negative when `a` ranks ahead of `b`.
 * @returns {{add:Function,getItems:Function}} Ranked buffer helpers.
 */
export function createRankedBuffer(limit, compare) {
  // Sanitize the caller-provided limit so we never grow beyond a non-negative integer.
  const capacity = sanitizeNumber(limit, {
    fallback: 0,
    min: 0,
    round: Math.floor,
  });
  const comparator = typeof compare === "function" ? compare : () => 0;
  const entries = [];

  return {
    add(entry) {
      if (entry == null || capacity === 0) return;

      let low = 0;
      let high = entries.length;

      // Binary-search insertion keeps the collection sorted without re-sorting after each push.
      while (low < high) {
        const mid = (low + high) >> 1;
        const comparison = comparator(entry, entries[mid]);

        if (comparison < 0) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }

      const insertionIndex = low;

      if (insertionIndex >= capacity && entries.length >= capacity) return;

      entries.splice(insertionIndex, 0, entry);

      if (entries.length > capacity) {
        entries.length = capacity;
      }
    },
    getItems() {
      return entries.slice();
    },
  };
}

/*
 * Deterministic PRNG factory (Mulberry32)
 */
function mulberry32(seed) {
  let a = seed >>> 0;

  return function () {
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

const warnedMessages = new Set();
const reportedErrors = new Set();

function logWithOptionalError(method, message, error) {
  const consoleRef = globalThis.console;
  const logger = consoleRef?.[method];

  if (typeof logger !== "function") return;

  logger.call(consoleRef, message, ...(error ? [error] : []));
}

/**
 * Reports an error to the console with an optional deduplication toggle so
 * recoverable failures can surface diagnostic details without spamming logs.
 *
 * @param {string} message - Human-readable description of the error context.
 * @param {Error} [error] - Optional error object for stack/metadata.
 * @param {{once?: boolean}} [options] - Log control flags.
 */
export function reportError(message, error, options = {}) {
  if (typeof message !== "string" || message.length === 0) return;

  const { once = false } = options ?? {};

  if (once === true) {
    const errorKey = `${message}::$${error?.name ?? ""}::$${error?.message ?? ""}`;

    if (reportedErrors.has(errorKey)) return;
    reportedErrors.add(errorKey);
  }

  logWithOptionalError("error", message, error);
}

/**
 * Logs a warning message once per unique combination of message and error
 * details. Useful for surfacing recoverable issues without flooding the
 * console each frame/tick.
 *
 * @param {string} message - Human-readable description of the warning.
 * @param {Error} [error] - Optional error object for context.
 */
export function warnOnce(message, error) {
  if (typeof message !== "string" || message.length === 0) return;

  // Compose a stable key so repeated warnings collapse regardless of object identity.
  const warningKey = `${message}::$${error?.name ?? ""}::$${error?.message ?? ""}`;

  if (warnedMessages.has(warningKey)) return;
  warnedMessages.add(warningKey);

  logWithOptionalError("warn", message, error);
}
