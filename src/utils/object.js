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
let structuredCloneImpl =
  typeof globalThis !== "undefined" && typeof globalThis.structuredClone === "function"
    ? globalThis.structuredClone.bind(globalThis)
    : null;

const shouldAttemptNodeFallback =
  !structuredCloneImpl &&
  typeof process !== "undefined" &&
  process?.versions?.node &&
  (typeof window === "undefined" || typeof window?.document === "undefined");

if (shouldAttemptNodeFallback) {
  let delegate = null;

  const upgradeDelegate = (candidate) => {
    if (typeof candidate !== "function") {
      return false;
    }

    delegate = candidate;
    structuredCloneImpl = candidate;

    return true;
  };

  const fallbackClone = (value) => JSON.parse(JSON.stringify(value));

  structuredCloneImpl = (value) => {
    if (delegate) {
      return delegate(value);
    }

    return fallbackClone(value);
  };

  const dynamicImport = (specifier) => {
    try {
      // Using the Function constructor avoids Parcel attempting to statically
      // analyse the specifier and turning it into a direct `require` call in
      // browser bundles. The helper simply proxies to dynamic `import()` at
      // runtime when the environment actually supports the target module.
      return Function("specifier", "return import(specifier);")(specifier);
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const loadV8Fallback = () =>
    dynamicImport("node:v8")
      .then(({ serialize, deserialize }) => {
        if (typeof serialize === "function" && typeof deserialize === "function") {
          upgradeDelegate((value) => deserialize(serialize(value)));
        }
      })
      .catch(() => {});

  dynamicImport("node:util")
    .then(({ structuredClone: nodeStructuredClone }) => {
      if (!upgradeDelegate(nodeStructuredClone)) {
        return loadV8Fallback();
      }

      return undefined;
    })
    .catch(() => loadV8Fallback());
}

export function cloneTracePayload(trace) {
  if (trace == null) return null;

  if (!structuredCloneImpl) {
    return null;
  }

  try {
    return structuredCloneImpl(trace);
  } catch (error) {
    return null;
  }
}
