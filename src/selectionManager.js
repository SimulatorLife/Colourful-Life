const DEFAULT_COLORS = [
  'rgba(80, 160, 255, 0.22)',
  'rgba(120, 220, 120, 0.22)',
  'rgba(255, 180, 70, 0.24)',
  'rgba(220, 120, 220, 0.24)',
];

let customZoneCounter = 0;

export default class SelectionManager {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.patterns = new Map();
    this.customZones = [];
    this.#definePredefinedPatterns();
  }

  setDimensions(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    this.rows = rows;
    this.cols = cols;
    this.patterns.clear();
    this.customZones = [];
    this.#definePredefinedPatterns();
  }

  #definePredefinedPatterns() {
    const halfCols = () => Math.floor(this.cols / 2);
    const cornerWidth = () => Math.max(2, Math.floor(this.cols * 0.18));
    const cornerHeight = () => Math.max(2, Math.floor(this.rows * 0.18));
    const bandWidth = () => Math.max(2, Math.floor(this.cols * 0.08));

    this.#addPattern('eastHalf', {
      name: 'Eastern Hemisphere',
      description: 'Allow mating only on the right-hand half of the map.',
      color: DEFAULT_COLORS[0],
      contains: (row, col) => col >= halfCols(),
    });

    this.#addPattern('cornerPatches', {
      name: 'Corner Refuges',
      description: 'Restrict mating to small patches in each corner.',
      color: DEFAULT_COLORS[1],
      contains: (row, col) => {
        const w = cornerWidth();
        const h = cornerHeight();
        const top = row < h && (col < w || col >= this.cols - w);
        const bottom = row >= this.rows - h && (col < w || col >= this.cols - w);

        return top || bottom;
      },
    });

    this.#addPattern('alternatingBands', {
      name: 'Alternating Bands',
      description: 'Enable stripes of eligibility across the map.',
      color: DEFAULT_COLORS[2],
      contains: (row, col) => {
        const width = bandWidth();
        const bandIndex = Math.floor(col / width);

        return bandIndex % 2 === 0;
      },
    });
  }

  #addPattern(id, { name, description, contains, color }) {
    this.patterns.set(id, {
      id,
      name,
      description,
      contains,
      color,
      active: false,
    });
  }

  getPatterns() {
    return Array.from(this.patterns.values()).map((pattern) => ({ ...pattern }));
  }

  togglePattern(id, active) {
    const pattern = this.patterns.get(id);

    if (!pattern) return false;
    const next = typeof active === 'boolean' ? active : !pattern.active;

    pattern.active = next;

    return pattern.active;
  }

  clearCustomZones() {
    this.customZones = [];
  }

  addCustomRectangle(startRow, startCol, endRow, endCol) {
    const sr = this.#clampRow(Math.min(startRow, endRow));
    const er = this.#clampRow(Math.max(startRow, endRow));
    const sc = this.#clampCol(Math.min(startCol, endCol));
    const ec = this.#clampCol(Math.max(startCol, endCol));

    if (Number.isNaN(sr) || Number.isNaN(er) || Number.isNaN(sc) || Number.isNaN(ec)) return null;

    const zone = {
      id: `custom-${customZoneCounter++}`,
      name: `Custom Zone ${this.customZones.length + 1}`,
      description: 'User-drawn reproductive zone',
      active: true,
      color: DEFAULT_COLORS[(this.customZones.length + 2) % DEFAULT_COLORS.length],
      contains: (row, col) => row >= sr && row <= er && col >= sc && col <= ec,
      bounds: { startRow: sr, endRow: er, startCol: sc, endCol: ec },
    };

    this.customZones.push(zone);

    return zone;
  }

  getActiveZones() {
    const patterns = Array.from(this.patterns.values()).filter((pattern) => pattern.active);

    return [...patterns, ...this.customZones.filter((zone) => zone.active !== false)];
  }

  hasActiveZones() {
    return this.getActiveZones().length > 0;
  }

  isInActiveZone(row, col) {
    const zones = this.getActiveZones();

    if (zones.length === 0) return true;

    for (let i = 0; i < zones.length; i++) {
      if (zones[i].contains(row, col)) return true;
    }

    return false;
  }

  validateReproductionArea({ parentA, parentB, spawn } = {}) {
    const zones = this.getActiveZones();

    if (zones.length === 0) {
      return { allowed: true };
    }

    const result = this.#validatePointList(zones, [
      parentA ? { ...parentA, role: 'parentA' } : null,
      parentB ? { ...parentB, role: 'parentB' } : null,
    ]);

    if (!result.allowed) return result;

    if (spawn) {
      return this.#validatePointList(zones, [{ ...spawn, role: 'spawn' }]);
    }

    return { allowed: true };
  }

  #validatePointList(zones, points) {
    for (let i = 0; i < points.length; i++) {
      const point = points[i];

      if (!point) continue;
      const { row, col, role } = point;
      let inside = false;

      for (let z = 0; z < zones.length; z++) {
        if (zones[z].contains(row, col)) {
          inside = true;

          break;
        }
      }

      if (!inside) {
        return {
          allowed: false,
          role,
          reason:
            role === 'spawn'
              ? 'Spawn tile is outside the reproductive zone'
              : role === 'parentB'
                ? 'Mate is outside the reproductive zone'
                : 'Parent is outside the reproductive zone',
        };
      }
    }

    return { allowed: true };
  }

  describeActiveZones() {
    const zones = this.getActiveZones();

    if (zones.length === 0) return 'All tiles eligible';

    const names = zones.map((zone) => zone.name || zone.id);

    return names.join(', ');
  }

  #clampRow(row) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(row)));
  }

  #clampCol(col) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(col)));
  }
}
