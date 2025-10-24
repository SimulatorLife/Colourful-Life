const warnedMessages = new Set();
const reportedErrors = new Set();

function logWithOptionalError(method, message, error) {
  const consoleRef = globalThis.console;
  const logger = consoleRef?.[method];

  if (typeof logger !== "function") return;

  logger.call(consoleRef, message, ...(error ? [error] : []));
}

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

export function warnOnce(message, error) {
  if (typeof message !== "string" || message.length === 0) return;

  const warningKey = `${message}::$${error?.name ?? ""}::$${error?.message ?? ""}`;

  if (warnedMessages.has(warningKey)) return;
  warnedMessages.add(warningKey);

  logWithOptionalError("warn", message, error);
}

export function invokeWithErrorBoundary(callback, args = [], options = {}) {
  if (typeof callback !== "function") return undefined;

  const {
    message,
    once = false,
    thisArg,
    reporter = reportError,
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

    const reporterFn = typeof reporter === "function" ? reporter : reportError;

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
