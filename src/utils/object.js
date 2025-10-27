/**
 * Object-centric helpers for normalizing configuration payloads and cloning
 * simulation traces. Separating these utilities keeps UI and engine code from
 * depending on the broader numeric helper set.
 */

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
 * UI can mutate copies without affecting simulation state. Modern runtimes
 * expose `structuredClone`, so we delegate directly to the platform helper.
 *
 * @param {Object} trace - Snapshot returned by `brain.snapshot()`.
 * @returns {Object|null} Cloned trace.
 */
const STRUCTURED_CLONE_IMPL =
  typeof globalThis !== "undefined" && typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone.bind(globalThis)
    : null;

function cloneWithFallback(value, seen = new WeakMap()) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const clone = new Array(value.length);

    seen.set(value, clone);

    for (let index = 0; index < value.length; index += 1) {
      clone[index] = cloneWithFallback(value[index], seen);
    }

    return clone;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (value instanceof Map) {
    const clone = new Map();

    seen.set(value, clone);

    value.forEach((mapValue, key) => {
      clone.set(key, cloneWithFallback(mapValue, seen));
    });

    return clone;
  }

  if (value instanceof Set) {
    const clone = new Set();

    seen.set(value, clone);

    value.forEach((setValue) => {
      clone.add(cloneWithFallback(setValue, seen));
    });

    return clone;
  }

  if (ArrayBuffer.isView(value)) {
    if (typeof value.slice === "function") {
      const clone = value.slice();

      seen.set(value, clone);

      return clone;
    }

    if (value instanceof DataView) {
      const bufferClone = value.buffer.slice(0);
      const clone = new DataView(bufferClone, value.byteOffset, value.byteLength);

      seen.set(value, clone);

      return clone;
    }

    return value;
  }

  if (value instanceof ArrayBuffer) {
    const clone = value.slice(0);

    seen.set(value, clone);

    return clone;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const clone = {};

  seen.set(value, clone);

  for (const key of Object.keys(value)) {
    clone[key] = cloneWithFallback(value[key], seen);
  }

  return clone;
}

export function cloneTracePayload(trace) {
  if (trace == null) return null;

  if (STRUCTURED_CLONE_IMPL) {
    try {
      return STRUCTURED_CLONE_IMPL(trace);
    } catch (error) {
      // Fall through to the manual clone below when structuredClone rejects unsupported payloads.
    }
  }

  try {
    return cloneWithFallback(trace);
  } catch (error) {
    return null;
  }
}
