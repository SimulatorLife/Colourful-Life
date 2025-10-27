import { sanitizeNumber } from "./math.js";

/**
 * Determines whether the candidate behaves like an indexed numeric array,
 * returning `true` for standard arrays and typed array views.
 *
 * @param {any} candidate - Value to test.
 * @returns {boolean} Whether the value is array-like.
 */
export function isArrayLike(candidate) {
  return Array.isArray(candidate) || ArrayBuffer.isView(candidate);
}

/**
 * Maintains a sorted, size-limited buffer using the provided comparator.
 * Callers typically use the helper when they only care about the "best"
 * handful of entries (for example, the leaderboard) and want deterministic
 * ordering without re-sorting on every insert.
 *
 * The returned helpers expose two functions:
 * - `add(entry)` inserts the value in comparator order when it meaningfully
 *   ranks inside the current top `limit`. Items with `null`/`undefined`
 *   values or that do not outperform the existing tail are ignored to avoid
 *   churn.
 * - `getItems()` returns a shallow copy of the ranked list so consumers cannot
 *   accidentally mutate the internal buffer.
 *
 * @param {number} limit - Maximum number of entries to retain. Non-positive
 *   values collapse to an empty buffer, which makes `.add()` a no-op.
 * @param {(a:any,b:any)=>number} compare - Comparison function returning a
 *   negative value when `a` should precede `b`. Ties preserve insertion order,
 *   which is important for deterministic UI highlights.
 * @returns {{add(entry:any):void,getItems():any[]}} Ranked buffer helpers.
 */
export function createRankedBuffer(limit, compare) {
  // Sanitize the caller-provided limit so we never grow beyond a non-negative integer.
  const capacity = sanitizeNumber(limit, {
    fallback: 0,
    min: 0,
    round: Math.floor,
  });
  const comparator = typeof compare === "function" ? compare : () => 0;
  const entries = [];

  return {
    add(entry) {
      if (entry == null || capacity === 0) return;

      const size = entries.length;
      const bufferIsFull = size >= capacity;

      if (bufferIsFull && comparator(entry, entries[size - 1]) >= 0) {
        return;
      }

      let low = 0;
      let high = size;

      // Binary-search insertion keeps the collection sorted without re-sorting after each push.
      while (low < high) {
        const mid = (low + high) >> 1;
        const comparison = comparator(entry, entries[mid]);

        if (comparison < 0) {
          high = mid;
          continue;
        }

        low = mid + 1;
      }

      const insertionIndex = low;

      if (insertionIndex >= capacity) return;

      entries.splice(insertionIndex, 0, entry);

      if (entries.length > capacity) {
        entries.length = capacity;
      }
    },
    getItems() {
      return entries.slice();
    },
  };
}
