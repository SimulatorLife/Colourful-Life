/**
 * Primitive normalisation helpers for coercing user-provided values into
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
