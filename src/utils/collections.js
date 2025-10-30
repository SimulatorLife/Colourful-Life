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
 * Normalizes loosely-typed input into a standard array. Arrays are returned
 * intact to preserve reference semantics, while array-like objects and
 * iterables are copied into a new array. All other values collapse to the
 * provided fallback so callers can safely iterate without additional guards.
 *
 * @template T
 * @param {Iterable<T> | ArrayLike<T> | null | undefined} candidate - Value to normalize.
 * @param {Object} [options]
 * @param {Array<T>} [options.fallback=[]] - Replacement array used when the
 *   candidate is not iterable.
 * @returns {Array<T>} Normalized array suitable for iteration.
 */
export function toArray(candidate, { fallback = [] } = {}) {
  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (candidate == null) {
    return Array.isArray(fallback) ? fallback : [];
  }

  if (ArrayBuffer.isView(candidate)) {
    return Array.from(candidate);
  }

  if (typeof candidate[Symbol.iterator] === "function") {
    return Array.from(candidate);
  }

  if (typeof candidate.length === "number" && candidate.length >= 0) {
    return Array.from({ length: candidate.length }, (_, index) => candidate[index]);
  }

  return Array.isArray(fallback) ? fallback : [];
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

function quickselectInPlace(array, index, compare) {
  let left = 0;
  let right = array.length - 1;

  while (left <= right) {
    const pivotIndex = Math.floor((left + right) / 2);
    const newIndex = partition(array, left, right, pivotIndex, compare);

    if (newIndex === index) {
      return;
    }

    if (newIndex > index) {
      right = newIndex - 1;
    } else {
      left = newIndex + 1;
    }
  }
}

function partition(array, left, right, pivotIndex, compare) {
  const pivotValue = array[pivotIndex];

  swap(array, pivotIndex, right);

  let storeIndex = left;

  for (let i = left; i < right; i += 1) {
    if (compare(array[i], pivotValue) < 0) {
      swap(array, storeIndex, i);
      storeIndex += 1;
    }
  }

  swap(array, right, storeIndex);

  return storeIndex;
}

function swap(array, a, b) {
  if (a === b) return;

  const tmp = array[a];

  array[a] = array[b];
  array[b] = tmp;
}

/**
 * Extracts the highest-scoring entries from `array`, removing the selected items
 * from the original list while preserving reference identity. The helper keeps
 * the operation close to O(n) by relying on an in-place quickselect rather than
 * sorting the entire collection.
 *
 * @template T
 * @param {Array<T>} array - Source collection to partition.
 * @param {number} count - Number of entries to extract. Values below 1 return an
 *   empty list, while values greater than the array length return the entire collection.
 * @param {(item: T) => number} [scoreAccessor] - Resolver returning the numeric score used
 *   to rank entries. Defaults to the identity function.
 * @returns {Array<T>} The extracted top-scoring entries.
 */
export function takeTopBy(array, count, scoreAccessor = (value) => value) {
  if (!Array.isArray(array) || array.length === 0) {
    return [];
  }

  const limit = Math.max(0, Math.min(array.length, Math.floor(count ?? 0)));

  if (limit === 0) {
    return [];
  }

  if (limit >= array.length) {
    const result = array.slice();

    array.length = 0;

    return result;
  }

  const resolveScore =
    typeof scoreAccessor === "function" ? scoreAccessor : (value) => value;
  const compare = (a, b) => {
    const scoreA = resolveScore(a);
    const scoreB = resolveScore(b);

    if (scoreA === scoreB) return 0;

    return scoreA > scoreB ? -1 : 1;
  };

  quickselectInPlace(array, limit - 1, compare);

  const thresholdScore = resolveScore(array[limit - 1]);
  let greaterCount = 0;

  for (let i = 0; i < array.length; i += 1) {
    if (resolveScore(array[i]) > thresholdScore) {
      greaterCount += 1;
    }
  }

  let thresholdSlots = Math.max(0, limit - greaterCount);
  const selected = [];
  const remainder = [];

  for (let i = 0; i < array.length; i += 1) {
    const entry = array[i];
    const score = resolveScore(entry);

    if (score > thresholdScore) {
      selected.push(entry);
    } else if (score === thresholdScore && thresholdSlots > 0) {
      selected.push(entry);
      thresholdSlots -= 1;
    } else {
      remainder.push(entry);
    }
  }

  while (selected.length > limit) {
    remainder.push(selected.pop());
  }

  array.length = 0;

  for (let i = 0; i < remainder.length; i += 1) {
    array.push(remainder[i]);
  }

  return selected;
}
