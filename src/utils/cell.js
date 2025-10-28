import { resolveNonEmptyString } from "./primitives.js";

/**
 * Determines whether a value is a usable cell-like object.
 *
 * @param {unknown} cell
 * @returns {cell is object}
 */
export function isCellLike(cell) {
  return cell != null && typeof cell === "object";
}

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
  if (!isCellLike(cell)) {
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
