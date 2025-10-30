const WARN_ONCE_LIMIT_DEFAULT = 512;
const warnedMessages = new Set();

let warnOnceLimit = WARN_ONCE_LIMIT_DEFAULT;
let warnOnceBuffer = [];
let warnOnceHead = 0;
let warnOnceSize = 0;

function sanitizeWarnOnceLimit(limit) {
  const numeric = Number(limit);

  if (!Number.isFinite(numeric)) {
    return WARN_ONCE_LIMIT_DEFAULT;
  }

  return Math.max(0, Math.floor(numeric));
}

function resetWarnOnceState(limit = warnOnceLimit) {
  warnOnceLimit = sanitizeWarnOnceLimit(limit);
  warnedMessages.clear();
  warnOnceBuffer = warnOnceLimit > 0 ? new Array(warnOnceLimit) : [];
  warnOnceHead = 0;
  warnOnceSize = 0;
}

resetWarnOnceState(WARN_ONCE_LIMIT_DEFAULT);

function rememberWarnOnceKey(key) {
  if (warnOnceLimit <= 0) {
    return;
  }

  if (warnOnceSize < warnOnceLimit) {
    const index = (warnOnceHead + warnOnceSize) % warnOnceLimit;

    warnOnceBuffer[index] = key;
    warnOnceSize += 1;
  } else {
    const evictedKey = warnOnceBuffer[warnOnceHead];

    if (evictedKey !== undefined) {
      warnedMessages.delete(evictedKey);
    }

    warnOnceBuffer[warnOnceHead] = key;
    warnOnceHead = (warnOnceHead + 1) % warnOnceLimit;
  }

  warnedMessages.add(key);
}

const defaultErrorReporter = (message, error) => {
  if (typeof message !== "string" || message.length === 0) return;

  logWithOptionalError("error", message, error);
};

/**
 * Safely proxies console logging so optional error objects can be appended
 * without triggering runtime failures when the console is unavailable or
 * missing the requested method.
 *
 * @param {keyof Console | string} method - Console method name such as "warn" or "error".
 * @param {string} message - Human-friendly diagnostic message.
 * @param {unknown} [error] - Optional error-like payload forwarded for context.
 */
function logWithOptionalError(method, message, error) {
  const consoleRef = globalThis.console;
  const logger = consoleRef?.[method];

  if (typeof logger !== "function") return;

  logger.call(consoleRef, message, ...(error ? [error] : []));
}

/**
 * Emits a warning-level log the first time a distinct message/error pair is
 * observed. Useful for cautionary telemetry where repeated warnings would flood
 * the console without providing new information.
 *
 * @param {string} message - Description of the warning condition.
 * @param {unknown} [error] - Optional contextual error payload.
 * @returns {void}
 */
function normalizeWarningKeySuffix(error) {
  if (error && typeof error === "object") {
    const name = typeof error.name === "string" ? error.name : "";
    const message = typeof error.message === "string" ? error.message : "";

    if (name.length > 0 || message.length > 0) {
      return `${name}::$${message}`;
    }

    if (typeof error.toString === "function") {
      try {
        const rendered = error.toString();

        if (typeof rendered === "string" && rendered.length > 0) {
          return `object::$${rendered}`;
        }
      } catch {
        // Fall back to the empty suffix when the custom toString throws.
      }
    }

    return "";
  }

  if (error === undefined || error === null) {
    return "";
  }

  try {
    const rendered = String(error);

    return rendered.length > 0 ? `${typeof error}::$${rendered}` : "";
  } catch {
    return "";
  }
}

export function warnOnce(message, error) {
  if (typeof message !== "string" || message.length === 0) return;

  const warningKey = `${message}::$${normalizeWarningKeySuffix(error)}`;

  if (warnedMessages.has(warningKey)) return;

  rememberWarnOnceKey(warningKey);

  logWithOptionalError("warn", message, error);
}

export function __dangerousResetWarnOnce({ limit } = {}) {
  if (limit == null) {
    resetWarnOnceState(WARN_ONCE_LIMIT_DEFAULT);

    return;
  }

  resetWarnOnceState(limit);
}

export function __dangerousGetWarnOnceSize() {
  return warnedMessages.size;
}

/**
 * Invokes a callback while trapping synchronous errors so the caller's control
 * flow can continue. A reporter hook receives failures, and `once` flags allow
 * reporters to optionally dedupe repeated emissions.
 *
 * @template TResult
 * @param {(...args: any[]) => TResult} callback - Function executed inside the boundary.
 * @param {any[]} [args=[]] - Arguments forwarded to the callback.
 * @param {Object} [options]
 * @param {string | ((...args: any[]) => string)} [options.message] - Optional
 *   message or generator invoked when an error surfaces.
 * @param {boolean} [options.once=false] - Whether identical failures are
 *   reported at most once.
 * @param {any} [options.thisArg] - Value applied as `this` during invocation.
 * @param {(message: string, error: unknown, opts?: { once?: boolean }) => void}
 *   [options.reporter=defaultErrorReporter] - Custom error reporter.
 * @param {(error: unknown) => void} [options.onError] - Handler executed when a
 *   failure occurs.
 * @returns {TResult | undefined} Callback result when successful; `undefined`
 *   after handling an error.
 */
export function invokeWithErrorBoundary(callback, args = [], options = {}) {
  if (typeof callback !== "function") return undefined;

  const {
    message,
    once = false,
    thisArg,
    reporter = defaultErrorReporter,
    onError,
  } = options ?? {};

  try {
    return callback.apply(thisArg, args);
  } catch (error) {
    let resolvedMessage = message;

    if (typeof message === "function") {
      try {
        resolvedMessage = message(...args);
      } catch (messageError) {
        resolvedMessage = null;
        logWithOptionalError(
          "warn",
          "Error message generator threw; using fallback.",
          messageError,
        );
      }
    }

    const fallbackMessage =
      typeof resolvedMessage === "string" && resolvedMessage.length > 0
        ? resolvedMessage
        : "Callback threw; continuing without interruption.";

    const reporterFn = typeof reporter === "function" ? reporter : defaultErrorReporter;

    reporterFn(fallbackMessage, error, { once });

    if (typeof onError === "function") {
      try {
        onError(error);
      } catch (onErrorError) {
        logWithOptionalError(
          "warn",
          "Error boundary onError handler threw; ignoring.",
          onErrorError,
        );
      }
    }
  }

  return undefined;
}
