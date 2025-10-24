/**
 * Creates a lightweight {@link SelectionManager}-compatible object used when
 * callers do not supply a real selection manager. The stub preserves the grid
 * contract (exposing zone queries, toggles, and dimension tracking) so the
 * simulation engine can interact with reproduction-zone APIs without pulling
 * in DOM dependencies. Keeping the helper in the grid module ensures grid
 * abstractions remain colocated.
 *
 * @param {number} rows - Grid row count.
 * @param {number} cols - Grid column count.
 * @returns {Object} Selection manager stub.
 */
export function createSelectionManagerStub(rows, cols) {
  const state = { rows: Math.max(0, rows ?? 0), cols: Math.max(0, cols ?? 0) };

  const updateDimensions = (r, c) => {
    state.rows = Math.max(0, r ?? state.rows ?? 0);
    state.cols = Math.max(0, c ?? state.cols ?? 0);
  };

  return {
    setDimensions(nextRows, nextCols) {
      updateDimensions(nextRows, nextCols);
    },
    getPatterns() {
      return [];
    },
    togglePattern() {
      return false;
    },
    getActiveZones() {
      return [];
    },
    hasActiveZones() {
      return false;
    },
    isInActiveZone() {
      return true;
    },
    validateReproductionArea() {
      return { allowed: true };
    },
    getActiveZoneRenderData() {
      return [];
    },
    describeActiveZones() {
      return "All tiles eligible";
    },
    get rows() {
      return state.rows;
    },
    get cols() {
      return state.cols;
    },
  };
}

export default createSelectionManagerStub;
