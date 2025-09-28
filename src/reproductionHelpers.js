/**
 * Produce a deduplicated list of tiles around the parents that can be used as
 * reproduction spawn candidates. The helper only performs coordinate
 * normalization and bounds checks—callers remain responsible for filtering out
 * blocked tiles (obstacles, existing occupants, etc.).
 *
 * When `includeOriginNeighbors` is enabled the neighbors surrounding the
 * original parent location are included so callers can fall back to the previous
 * position if movement fails validation later in the pipeline.
 *
 * @param {Object} options
 * @param {{row:number,col:number}} options.parent Current parent location.
 * @param {{row:number,col:number}} options.mate Mate location.
 * @param {{row:number,col:number}|null} [options.origin] Original parent
 *   position before movement.
 * @param {boolean} [options.includeOriginNeighbors=false] Whether to include
 *   tiles neighboring the origin point.
 * @param {number} options.rows Total number of grid rows.
 * @param {number} options.cols Total number of grid columns.
 * @returns {Array<{r:number,c:number}>}
 */
export function collectSpawnCandidates({
  parent,
  mate,
  origin = null,
  includeOriginNeighbors = false,
  rows,
  cols,
} = {}) {
  if (!parent || !mate) return [];

  const normalizedRows = Number.isInteger(rows) ? rows : 0;
  const normalizedCols = Number.isInteger(cols) ? cols : 0;
  const hasBounds = normalizedRows > 0 && normalizedCols > 0;
  const candidates = [];
  const seen = new Set();

  const inBounds = (r, c) =>
    hasBounds ? r >= 0 && r < normalizedRows && c >= 0 && c < normalizedCols : true;

  const addCandidate = (r, c) => {
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;

    const rr = Math.floor(r);
    const cc = Math.floor(c);

    if (!inBounds(rr, cc)) return;

    const key = `${rr},${cc}`;

    if (seen.has(key)) return;

    seen.add(key);
    candidates.push({ r: rr, c: cc });
  };

  const addNeighbors = (base) => {
    if (!base) return;
    const { row: baseRow, col: baseCol } = base;

    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue;

        addCandidate(baseRow + dr, baseCol + dc);
      }
    }
  };

  if (origin) {
    addCandidate(origin.row, origin.col);

    if (includeOriginNeighbors) {
      addNeighbors(origin);
    }
  }

  addCandidate(parent.row, parent.col);
  addCandidate(mate.row, mate.col);
  addNeighbors(parent);
  addNeighbors(mate);

  return candidates;
}
