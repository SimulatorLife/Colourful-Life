const DEFAULT_COLORS = [
  'rgba(80, 160, 255, 0.22)',
  'rgba(120, 220, 120, 0.22)',
  'rgba(255, 180, 70, 0.24)',
  'rgba(220, 120, 220, 0.24)',
];

export default class SelectionManager {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.patterns = new Map();
    this.customZones = [];
    this.zoneGeometryCache = new Map();
    this.geometryRevision = 0;
    this.customZoneCounter = 0;
    this.#definePredefinedPatterns();
  }

  setDimensions(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    this.rows = rows;
    this.cols = cols;
    this.patterns.clear();
    this.customZones = [];
    this.customZoneCounter = 0;
    this.#invalidateAllZoneGeometry();
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

    this.#invalidateZoneGeometry(pattern);

    if (pattern.active) {
      this.#storeZoneGeometry(pattern, this.#computeZoneGeometry(pattern));
    }

    return pattern.active;
  }

  clearCustomZones() {
    this.customZones = [];
    this.#invalidateAllZoneGeometry();
  }

  addCustomRectangle(startRow, startCol, endRow, endCol) {
    const sr = this.#clampRow(Math.min(startRow, endRow));
    const er = this.#clampRow(Math.max(startRow, endRow));
    const sc = this.#clampCol(Math.min(startCol, endCol));
    const ec = this.#clampCol(Math.max(startCol, endCol));

    if (Number.isNaN(sr) || Number.isNaN(er) || Number.isNaN(sc) || Number.isNaN(ec)) return null;

    const zoneIndex = this.customZoneCounter++;
    const zone = {
      id: `custom-${zoneIndex}`,
      name: `Custom Zone ${this.customZones.length + 1}`,
      description: 'User-drawn reproductive zone',
      active: true,
      color: DEFAULT_COLORS[(this.customZones.length + 2) % DEFAULT_COLORS.length],
      contains: (row, col) => row >= sr && row <= er && col >= sc && col <= ec,
      bounds: { startRow: sr, endRow: er, startCol: sc, endCol: ec },
    };

    this.customZones.push(zone);
    this.#storeZoneGeometry(zone, this.#computeGeometryFromBounds(zone.bounds));

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

  getActiveZoneRenderData() {
    const zones = this.getActiveZones();

    if (!zones.length) return [];

    return zones.map((zone) => ({
      zone,
      geometry: this.#ensureZoneGeometry(zone),
    }));
  }

  #clampRow(row) {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(row)));
  }

  #clampCol(col) {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(col)));
  }

  #invalidateAllZoneGeometry() {
    this.zoneGeometryCache.clear();
    this.geometryRevision += 1;
  }

  #getZoneCacheKey(zone) {
    if (!zone) return null;
    if (typeof zone.id === 'string') return zone.id;
    if (typeof zone.name === 'string') return `name:${zone.name}`;

    return null;
  }

  #invalidateZoneGeometry(zoneOrId) {
    const key = typeof zoneOrId === 'string' ? zoneOrId : this.#getZoneCacheKey(zoneOrId);

    if (key) {
      this.zoneGeometryCache.delete(key);
    }
  }

  #storeZoneGeometry(zone, geometry) {
    const key = this.#getZoneCacheKey(zone);

    if (!key) return geometry;

    this.zoneGeometryCache.set(key, {
      geometry,
      version: this.geometryRevision,
    });

    return geometry;
  }

  #ensureZoneGeometry(zone) {
    if (!zone) return { rects: [], bounds: null };

    const key = this.#getZoneCacheKey(zone);

    if (key) {
      const cached = this.zoneGeometryCache.get(key);

      if (cached && cached.version === this.geometryRevision) {
        return cached.geometry;
      }
    }

    const geometry = this.#computeZoneGeometry(zone);

    return this.#storeZoneGeometry(zone, geometry);
  }

  #computeZoneGeometry(zone) {
    if (!zone) return { rects: [], bounds: null };

    if (zone.bounds) {
      return this.#computeGeometryFromBounds(zone.bounds);
    }

    return this.#computeGeometryFromContains(zone);
  }

  #computeGeometryFromBounds(bounds) {
    if (!bounds) return { rects: [], bounds: null };

    const { startRow, endRow, startCol, endCol } = bounds;
    const rowSpan = endRow - startRow + 1;
    const colSpan = endCol - startCol + 1;

    if (rowSpan <= 0 || colSpan <= 0) {
      return { rects: [], bounds: null };
    }

    return {
      rects: [
        {
          row: startRow,
          col: startCol,
          rowSpan,
          colSpan,
        },
      ],
      bounds: { startRow, endRow, startCol, endCol },
    };
  }

  #computeGeometryFromContains(zone) {
    if (typeof zone.contains !== 'function') {
      return { rects: [], bounds: null };
    }

    const rects = [];
    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = -1;
    let maxCol = -1;

    for (let row = 0; row < this.rows; row++) {
      let startCol = null;

      for (let col = 0; col < this.cols; col++) {
        const inside = zone.contains(row, col);

        if (inside && startCol === null) {
          startCol = col;
        } else if (!inside && startCol !== null) {
          const endCol = col - 1;
          const colSpan = endCol - startCol + 1;

          rects.push({ row, col: startCol, rowSpan: 1, colSpan });
          minRow = Math.min(minRow, row);
          maxRow = Math.max(maxRow, row);
          minCol = Math.min(minCol, startCol);
          maxCol = Math.max(maxCol, endCol);
          startCol = null;
        }
      }

      if (startCol !== null) {
        const endCol = this.cols - 1;
        const colSpan = endCol - startCol + 1;

        rects.push({ row, col: startCol, rowSpan: 1, colSpan });
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
        minCol = Math.min(minCol, startCol);
        maxCol = Math.max(maxCol, endCol);
      }
    }

    if (!rects.length) {
      return { rects: [], bounds: null };
    }

    return {
      rects,
      bounds: {
        startRow: minRow,
        endRow: maxRow,
        startCol: minCol,
        endCol: maxCol,
      },
    };
  }
}
