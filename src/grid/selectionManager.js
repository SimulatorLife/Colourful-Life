import { warnOnce } from "../utils/error.js";

const DEFAULT_COLORS = [
  "rgba(80, 160, 255, 0.22)",
  "rgba(120, 220, 120, 0.22)",
  "rgba(255, 180, 70, 0.24)",
  "rgba(220, 120, 220, 0.24)",
];

const EMPTY_GEOMETRY = Object.freeze({
  rects: Object.freeze([]),
  bounds: null,
});

const ZONE_PREDICATE_WARNING =
  "Selection zone predicate threw while checking tile membership; treating tile as outside.";

/**
 * Tracks reproductive zone definitions. SelectionManager provides built-in
 * geometric patterns so the simulation can restrict mating and spawning to
 * curated areas of the map.
 */
export default class SelectionManager {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.patterns = new Map();
    this.zoneGeometryCache = new Map();
    this.geometryRevision = 0;
    this.#definePredefinedPatterns();
  }

  setDimensions(rows, cols) {
    if (rows === this.rows && cols === this.cols) return;
    const previouslyActive = new Set(
      Array.from(this.patterns.values())
        .filter(
          (pattern) => pattern && pattern.active && typeof pattern.id === "string",
        )
        .map((pattern) => pattern.id),
    );

    this.rows = rows;
    this.cols = cols;
    this.patterns.clear();
    this.#invalidateAllZoneGeometry();
    this.#definePredefinedPatterns();

    if (previouslyActive.size > 0) {
      previouslyActive.forEach((id) => {
        this.togglePattern(id, true);
      });
    }
  }

  #definePredefinedPatterns() {
    const halfCols = () => Math.floor(this.cols / 2);
    const cornerWidth = () => Math.max(2, Math.floor(this.cols * 0.18));
    const cornerHeight = () => Math.max(2, Math.floor(this.rows * 0.18));
    const bandWidth = () => Math.max(2, Math.floor(this.cols * 0.08));
    const coreWidth = () =>
      Math.min(this.cols, Math.max(3, Math.floor(this.cols * 0.32)));
    const coreHeight = () =>
      Math.min(this.rows, Math.max(3, Math.floor(this.rows * 0.32)));

    this.#addPattern("eastHalf", {
      name: "Eastern Hemisphere",
      description: "Allow mating only on the right-hand half of the map.",
      color: DEFAULT_COLORS[0],
      contains: (row, col) => col >= halfCols(),
    });

    this.#addPattern("cornerPatches", {
      name: "Corner Refuges",
      description: "Restrict mating to small patches in each corner.",
      color: DEFAULT_COLORS[1],
      contains: (row, col) => {
        const w = cornerWidth();
        const h = cornerHeight();
        const top = row < h && (col < w || col >= this.cols - w);
        const bottom = row >= this.rows - h && (col < w || col >= this.cols - w);

        return top || bottom;
      },
    });

    this.#addPattern("alternatingBands", {
      name: "Alternating Bands",
      description: "Enable stripes of eligibility across the map.",
      color: DEFAULT_COLORS[2],
      contains: (row, col) => {
        const width = bandWidth();
        const bandIndex = Math.floor(col / width);

        return bandIndex % 2 === 0;
      },
    });

    this.#addPattern("centralSanctuary", {
      name: "Central Sanctuary",
      description:
        "Concentrate reproduction inside a protected core to nurture hub ecosystems.",
      color: DEFAULT_COLORS[3],
      contains: (row, col) => {
        const width = coreWidth();
        const height = coreHeight();
        const startRow = Math.max(0, Math.floor((this.rows - height) / 2));
        const startCol = Math.max(0, Math.floor((this.cols - width) / 2));
        const endRow = Math.min(this.rows, startRow + height);
        const endCol = Math.min(this.cols, startCol + width);

        return row >= startRow && row < endRow && col >= startCol && col < endCol;
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
    const next = typeof active === "boolean" ? active : !pattern.active;

    pattern.active = next;

    this.#invalidateZoneGeometry(pattern);

    if (pattern.active) {
      this.#storeZoneGeometry(pattern, this.#computeZoneGeometry(pattern));
    }

    return pattern.active;
  }

  clearActiveZones() {
    for (const pattern of this.patterns.values()) {
      if (pattern?.id && pattern.active) {
        this.togglePattern(pattern.id, false);
      }
    }
  }

  getActiveZones() {
    const patterns = Array.from(this.patterns.values()).filter(
      (pattern) => pattern.active,
    );

    return patterns;
  }

  hasActiveZones() {
    return this.getActiveZones().length > 0;
  }

  isInActiveZone(row, col) {
    const zones = this.getActiveZones();

    return (
      zones.length === 0 || zones.some((zone) => this.#safeZoneContains(zone, row, col))
    );
  }

  /**
   * Validates whether proposed parents and offspring fall inside the currently
   * active reproductive zones.
   *
   * Why it matters: reproduction outside curated zones should be rejected so
   * the simulation honours scenario-specific mating constraints without relying
   * on downstream grid checks.
   *
   * @param {{
   *   parentA?: {row:number, col:number},
   *   parentB?: {row:number, col:number},
   *   spawn?: {row:number, col:number}
   * }} [options]
   * @returns {{allowed: true} | {
   *   allowed: false,
   *   role: "parentA" | "parentB" | "spawn",
   *   reason: string
   * }} When no zones are active the call always resolves to `{ allowed: true }`.
   */
  validateReproductionArea({ parentA, parentB, spawn } = {}) {
    const zones = this.getActiveZones();

    if (zones.length === 0) {
      return { allowed: true };
    }

    const result = this.#validatePointList(zones, [
      parentA ? { ...parentA, role: "parentA" } : null,
      parentB ? { ...parentB, role: "parentB" } : null,
    ]);

    if (!result.allowed) return result;

    if (spawn) {
      return this.#validatePointList(zones, [{ ...spawn, role: "spawn" }]);
    }

    return { allowed: true };
  }

  #validatePointList(zones, points) {
    for (const point of points) {
      if (!point) continue;

      const { row, col, role } = point;

      if (!zones.some((zone) => this.#safeZoneContains(zone, row, col))) {
        return {
          allowed: false,
          role,
          reason:
            role === "spawn"
              ? "Spawn tile is outside the reproductive zone"
              : role === "parentB"
                ? "Mate is outside the reproductive zone"
                : "Parent is outside the reproductive zone",
        };
      }
    }

    return { allowed: true };
  }

  describeActiveZones() {
    const zones = this.getActiveZones();

    if (zones.length === 0) return "All tiles eligible";

    const names = zones.map((zone) => zone.name || zone.id);

    return names.join(", ");
  }

  /**
   * Resolves render metadata for each active zone, including cached geometry
   * rectangles and bounds derived from the zone predicate.
   *
   * @returns {Array<{
   *   zone: {
   *     id?: string,
   *     name?: string,
   *     color?: string,
   *     contains: (row:number, col:number) => boolean
   *   },
   *   geometry: {
   *     rects: Array<{row:number, col:number, rowSpan:number, colSpan:number}>,
   *     bounds: {startRow:number, endRow:number, startCol:number, endCol:number} | null
   *   }
   * }>} Empty array when no zones are active.
   */
  getActiveZoneRenderData() {
    const zones = this.getActiveZones();

    if (!zones.length) return [];

    return zones.map((zone) => ({
      zone,
      geometry: this.#ensureZoneGeometry(zone),
    }));
  }

  #invalidateAllZoneGeometry() {
    this.zoneGeometryCache.clear();
    this.geometryRevision += 1;
  }

  #getZoneCacheKey(zone) {
    if (!zone) return null;
    if (typeof zone.id === "string") return zone.id;
    if (typeof zone.name === "string") return `name:${zone.name}`;

    return null;
  }

  #invalidateZoneGeometry(zoneOrId) {
    const key =
      typeof zoneOrId === "string" ? zoneOrId : this.#getZoneCacheKey(zoneOrId);

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
    if (!zone) return EMPTY_GEOMETRY;

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
    if (!zone) return EMPTY_GEOMETRY;

    return this.#computeGeometryFromContains(zone);
  }

  #resolveZoneWarning(zone) {
    if (!zone) return ZONE_PREDICATE_WARNING;

    const label =
      (typeof zone.name === "string" && zone.name.trim()) ||
      (typeof zone.id === "string" && zone.id.trim()) ||
      "";

    return label
      ? `Selection zone "${label}" predicate threw while checking tile membership; treating tile as outside.`
      : ZONE_PREDICATE_WARNING;
  }

  #safeZoneContains(zone, row, col) {
    if (!zone || typeof zone.contains !== "function") {
      return false;
    }

    try {
      return Boolean(zone.contains(row, col));
    } catch (error) {
      warnOnce(this.#resolveZoneWarning(zone), error);

      return false;
    }
  }

  #computeGeometryFromContains(zone) {
    if (typeof zone.contains !== "function") {
      return EMPTY_GEOMETRY;
    }

    const rects = [];
    let minRow = Infinity;
    let minCol = Infinity;
    let maxRow = -1;
    let maxCol = -1;

    for (let row = 0; row < this.rows; row++) {
      let startCol = null;

      for (let col = 0; col < this.cols; col++) {
        const inside = this.#safeZoneContains(zone, row, col);

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
      return EMPTY_GEOMETRY;
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
