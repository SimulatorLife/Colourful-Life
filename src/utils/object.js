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
let STRUCTURED_CLONE_IMPL =
  typeof globalThis !== "undefined" && typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone.bind(globalThis)
    : null;

if (
  !STRUCTURED_CLONE_IMPL &&
  typeof process !== "undefined" &&
  process?.versions?.node
) {
  try {
    const { structuredClone: nodeStructuredClone } = await import("node:util");

    if (typeof nodeStructuredClone === "function") {
      STRUCTURED_CLONE_IMPL = nodeStructuredClone;
    }
  } catch (error) {
    // Continue attempting other fallbacks when util.structuredClone is unavailable.
  }

  if (!STRUCTURED_CLONE_IMPL) {
    try {
      const { serialize, deserialize } = await import("node:v8");

      if (typeof serialize === "function" && typeof deserialize === "function") {
        STRUCTURED_CLONE_IMPL = (value) => deserialize(serialize(value));
      }
    } catch (error) {
      // Ignore failures when the V8 helpers are unavailable.
    }
  }
}

export function cloneTracePayload(trace) {
  if (trace == null) return null;

  if (!STRUCTURED_CLONE_IMPL) {
    return null;
  }

  try {
    return STRUCTURED_CLONE_IMPL(trace);
  } catch (error) {
    return null;
  }
}
