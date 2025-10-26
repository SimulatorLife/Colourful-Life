/**
 * Object-centric helpers for normalising configuration payloads and cloning
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

function isPlainObject(value) {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function clonePlainBranch(value) {
  if (value == null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(clonePlainBranch);
  }

  if (!isPlainObject(value)) {
    if (!STRUCTURED_CLONE_IMPL) {
      throw new Error(
        "cloneTracePayload encountered an unsupported value without structuredClone support.",
      );
    }

    return STRUCTURED_CLONE_IMPL(value);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, clonePlainBranch(child)]),
  );
}

export function cloneTracePayload(trace) {
  if (trace == null) return null;

  if (!isPlainObject(trace)) {
    if (!STRUCTURED_CLONE_IMPL) {
      throw new Error(
        "cloneTracePayload requires structuredClone support; the current environment does not provide it.",
      );
    }

    return STRUCTURED_CLONE_IMPL(trace);
  }

  return clonePlainBranch(trace);
}
