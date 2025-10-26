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
 * @param {object|null|undefined} cell - Candidate cell-like object.
 * @returns {string|null} Hex or rgba colour string, or `null` when unavailable.
 */
export function resolveCellColor(cell) {
  if (!cell || typeof cell !== "object") {
    return null;
  }

  const explicitColor =
    typeof cell.color === "string" && cell.color.length > 0 ? cell.color : null;

  if (explicitColor) {
    return explicitColor;
  }

  const dnaColor = typeof cell?.dna?.toColor === "function" ? cell.dna.toColor() : null;

  return typeof dnaColor === "string" && dnaColor.length > 0 ? dnaColor : null;
}
