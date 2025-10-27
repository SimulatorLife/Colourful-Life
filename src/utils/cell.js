import { resolveNonEmptyString } from "./primitives.js";

/**
 * Shared helpers for working with cell entities without creating dependencies
 * on the heavier simulation modules. Utility consumers can safely extract
 * presentation-friendly properties while keeping feature modules decoupled.
 */

/**
 * Resolves the display colour for a cell by preferring the runtime `color`
 * field and falling back to the DNA-provided palette when necessary.
 * Returning `null` keeps upstream callers from storing empty strings.
 *
 * @param {object | null | undefined} cell - Candidate cell-like object.
 * @returns {string | null} Hex or rgba colour string, or `null` when unavailable.
 */
export function resolveCellColor(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }

  const explicitColor = resolveNonEmptyString(cell.color);

  if (explicitColor != null) {
    return explicitColor;
  }

  if (typeof cell?.dna?.toColor === "function") {
    return resolveNonEmptyString(cell.dna.toColor());
  }

  return null;
}
