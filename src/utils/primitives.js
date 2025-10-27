/**
 * Primitive normalization helpers for coercing user-provided values into
 * predictable booleans.
 */
export function coerceBoolean(candidate, fallback = false) {
  if (typeof candidate === "boolean") {
    return candidate;
  }

  if (candidate == null) {
    return fallback;
  }

  if (typeof candidate === "number") {
    return Number.isFinite(candidate) ? candidate !== 0 : fallback;
  }

  if (typeof candidate === "string") {
    const normalized = candidate.trim().toLowerCase();

    if (normalized.length === 0) return fallback;
    if (normalized === "true" || normalized === "yes" || normalized === "on") {
      return true;
    }
    if (normalized === "false" || normalized === "no" || normalized === "off") {
      return false;
    }

    const numeric = Number(normalized);

    if (!Number.isNaN(numeric)) {
      return numeric !== 0;
    }

    return fallback;
  }

  return Boolean(candidate);
}

/**
 * Returns the candidate string when it is non-empty, otherwise falls back to
 * the provided value. Helps normalize optional labels and colour values
 * without sprinkling repeated `typeof`/`length` guards throughout the codebase.
 *
 * @param {unknown} candidate - Value to evaluate.
 * @param {string|null} [fallback=null] - Replacement when the candidate is not
 *   a non-empty string.
 * @returns {string|null} A non-empty string or the fallback value.
 */
export function resolveNonEmptyString(candidate, fallback = null) {
  if (typeof candidate !== "string") {
    return fallback;
  }

  const trimmed = candidate.trim();

  return trimmed.length > 0 ? trimmed : fallback;
}
