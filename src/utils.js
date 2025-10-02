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
  const maxSize = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const comparator = typeof compare === "function" ? compare : () => 0;
  const buffer = [];

  return {
    add(entry) {
      if (entry == null || maxSize === 0) return;

      let low = 0;
      let high = buffer.length;

      while (low < high) {
        const mid = (low + high) >> 1;
        const comparison = comparator(entry, buffer[mid]);

        if (comparison < 0) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }

      if (low >= maxSize && buffer.length >= maxSize) return;

      buffer.splice(low, 0, entry);

      if (buffer.length > maxSize) {
        buffer.length = maxSize;
      }
    },
    getItems() {
      return buffer.slice();
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

  if (typeof console !== "undefined" && typeof console.error === "function") {
    if (error) {
      console.error(message, error);
    } else {
      console.error(message);
    }
  }
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

  if (typeof console !== "undefined" && typeof console.warn === "function") {
    if (error) {
      console.warn(message, error);
    } else {
      console.warn(message);
    }
  }
}
