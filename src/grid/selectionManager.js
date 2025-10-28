import { warnOnce } from "../utils/error.js";
import { coerceBoolean } from "../utils/primitives.js";

const DEFAULT_COLORS = Object.freeze([
  "rgba(80, 160, 255, 0.22)",
  "rgba(120, 220, 120, 0.22)",
  "rgba(255, 180, 70, 0.24)",
  "rgba(220, 120, 220, 0.24)",
]);

const EMPTY_GEOMETRY = Object.freeze({
  rects: Object.freeze([]),
  bounds: null,
});

const ZONE_PREDICATE_WARNING =
  "Selection zone predicate threw while checking tile membership; treating tile as outside.";

/**
 * Tracks reproductive zone definitions. SelectionManager provides built-in
 * geometric patterns so the simulation can restrict mating and spawning to
 * curated areas of the map. Callers can extend the predefined catalog via the
 * optional `patterns` array or `definePatterns` hook passed to the constructor,
 * keeping scenario-specific zoning logic outside the core module while
 * retaining the default presets.
 */
export default class SelectionManager {
  #activeZonesDirty = true;
  #activeZonesCache = Object.freeze([]);
  #customPatternOptions = { patterns: null, definePatterns: null };

  /**
   * @param {number} rows
   * @param {number} cols
   * @param {{
   *   patterns?: Array<{
   *     id: string,
   *     name?: string,
   *     description?: string,
   *     color?: string,
   *     contains: (row:number, col:number) => boolean,
   *     active?: boolean,
   *   }>,
   *   definePatterns?: (context: {
   *     rows: number,
   *     cols: number,
   *     defaultColors: string[],
   *     addPattern: (descriptor: unknown) => boolean,
   *   }) => unknown,
   * }} [options]
   */
  constructor(rows, cols, options = {}) {
    this.rows = rows;
    this.cols = cols;
    this.patterns = new Map();
    this.zoneGeometryCache = new Map();
    this.geometryRevision = 0;
    this.#customPatternOptions = this.#normalizeCustomPatternOptions(options);
    this.#definePredefinedPatterns();
    this.#applyCustomPatternOptions(this.#customPatternOptions);
    this.#invalidateActiveZoneCache();
  }

  #invalidateActiveZoneCache() {
    this.#activeZonesDirty = true;
    this.#activeZonesCache = Object.freeze([]);
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
    this.#applyCustomPatternOptions(this.#customPatternOptions);
    this.#invalidateActiveZoneCache();

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
    this.#invalidateActiveZoneCache();
  }

  #normalizeCustomPatternOptions(options) {
    if (!options || typeof options !== "object") {
      return { patterns: null, definePatterns: null };
    }

    const patterns = Array.isArray(options.patterns) ? options.patterns.slice() : null;
    const definePatterns =
      typeof options.definePatterns === "function" ? options.definePatterns : null;

    return { patterns, definePatterns };
  }

  #applyCustomPatternOptions(config) {
    if (!config) return;

    const register = (candidate) => {
      if (Array.isArray(candidate)) {
        let added = false;

        for (const entry of candidate) {
          if (register(entry)) {
            added = true;
          }
        }

        return added;
      }

      return this.#registerCustomPattern(candidate);
    };

    if (Array.isArray(config.patterns)) {
      for (const pattern of config.patterns) {
        register(pattern);
      }
    }

    if (typeof config.definePatterns === "function") {
      const context = {
        rows: this.rows,
        cols: this.cols,
        defaultColors: [...DEFAULT_COLORS],
        addPattern: (descriptor) => register(descriptor),
      };
      const result = config.definePatterns(context);

      register(result);
    }
  }

  #normalizeCustomPatternDescriptor(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    const idCandidate =
      typeof candidate.id === "string" && candidate.id.trim().length > 0
        ? candidate.id.trim()
        : null;

    if (!idCandidate) {
      return null;
    }

    const contains =
      typeof candidate.contains === "function" ? candidate.contains : null;

    if (!contains) {
      return null;
    }

    const nameCandidate =
      typeof candidate.name === "string" && candidate.name.trim().length > 0
        ? candidate.name.trim()
        : idCandidate;
    const descriptionCandidate =
      typeof candidate.description === "string" ? candidate.description : "";
    const colorCandidate =
      typeof candidate.color === "string" && candidate.color.trim().length > 0
        ? candidate.color.trim()
        : undefined;

    return {
      id: idCandidate,
      name: nameCandidate,
      description: descriptionCandidate,
      color: colorCandidate,
      contains,
      active: candidate.active,
    };
  }

  #registerCustomPattern(candidate) {
    const normalized = this.#normalizeCustomPatternDescriptor(candidate);

    if (!normalized) {
      return false;
    }

    const palette = DEFAULT_COLORS;
    const fallbackColor =
      Array.isArray(palette) && palette.length > 0
        ? palette[this.patterns.size % palette.length]
        : undefined;
    const color = normalized.color ?? fallbackColor;

    this.#addPattern(normalized.id, {
      name: normalized.name,
      description: normalized.description,
      contains: normalized.contains,
      color,
    });

    if (normalized.active !== undefined) {
      this.togglePattern(normalized.id, normalized.active);
    }

    return true;
  }

  getPatterns() {
    return Array.from(this.patterns.values()).map((pattern) => ({ ...pattern }));
  }

  togglePattern(id, active) {
    const pattern = this.patterns.get(id);

    if (!pattern) return false;
    const next =
      active === undefined ? !pattern.active : coerceBoolean(active, pattern.active);

    pattern.active = next;
    this.#invalidateActiveZoneCache();

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
    if (this.#activeZonesDirty) {
      this.#activeZonesCache = Object.freeze(
        Array.from(this.patterns.values()).filter((pattern) => pattern?.active),
      );
      this.#activeZonesDirty = false;
    }

    return this.#activeZonesCache;
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
    const invalidPoint = points.find(
      (point) =>
        point &&
        !zones.some((zone) => this.#safeZoneContains(zone, point.row, point.col)),
    );

    if (!invalidPoint) {
      return { allowed: true };
    }

    const { role } = invalidPoint;

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
