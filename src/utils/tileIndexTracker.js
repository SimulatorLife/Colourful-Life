/**
 * Tracks grid tile indices without the overhead of a `Set`. The tracker keeps a
 * dense list of touched indices alongside a revision-stamped lookup table so
 * clearing the collection is O(1) and re-adding the same tile within the same
 * revision is a no-op. This mirrors the behaviour GridManager relied on from
 * plain `Set` objects while dramatically reducing GC churn during dense
 * simulations.
 */
export default class TileIndexTracker {
  #indices = [];
  #flags = null;
  #capacity = 0;
  #revision = 1;

  constructor(rows = 0, cols = 0) {
    this.resize(rows, cols);
  }

  /**
   * Ensures the tracker can represent a grid with `rows * cols` tiles. Resizing
   * clears any existing indices because previous coordinates are invalid once
   * dimensions change, matching the previous behaviour of re-instantiating a
   * `Set`.
   *
   * @param {number} rows
   * @param {number} cols
   */
  resize(rows, cols) {
    const normalizedRows = Math.max(0, Math.floor(rows));
    const normalizedCols = Math.max(0, Math.floor(cols));
    const nextCapacity = normalizedRows * normalizedCols;

    if (nextCapacity === this.#capacity && this.#flags) {
      this.clear();

      return;
    }

    this.#capacity = nextCapacity;
    this.#indices.length = 0;
    this.#revision = 1;
    this.#flags = nextCapacity > 0 ? new Uint32Array(nextCapacity) : null;
  }

  /**
   * Adds a tile index to the tracker when it falls within the configured
   * bounds.
   *
   * @param {number} index
   * @returns {boolean} Whether the index was newly inserted.
   */
  add(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#capacity) {
      return false;
    }

    const flags = this.#flags;

    if (!flags) {
      return false;
    }

    if (flags[index] === this.#revision) {
      return false;
    }

    flags[index] = this.#revision;
    this.#indices.push(index);

    return true;
  }

  /**
   * Clears tracked indices in O(1) by bumping the revision counter. When the
   * revision overflows the backing array is zeroed so future lookups remain
   * correct.
   */
  clear() {
    if (this.#indices.length > 0) {
      this.#indices.length = 0;
    }

    this.#revision = (this.#revision + 1) >>> 0;

    if (this.#revision === 0) {
      this.#revision = 1;

      if (this.#flags) {
        this.#flags.fill(0);
      }
    }
  }

  /**
   * Reports whether the given index is marked in the current revision.
   *
   * @param {number} index
   * @returns {boolean}
   */
  has(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.#capacity) {
      return false;
    }

    const flags = this.#flags;

    if (!flags) {
      return false;
    }

    return flags[index] === this.#revision;
  }

  /**
   * Iterates the tracked tile indices. Mirrors `Set`'s iteration contract so
   * existing loops continue to work without modification.
   */
  [Symbol.iterator]() {
    return this.#indices.values();
  }

  values() {
    return this.#indices.values();
  }

  get size() {
    return this.#indices.length;
  }

  get capacity() {
    return this.#capacity;
  }
}
