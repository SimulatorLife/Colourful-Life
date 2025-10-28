import { clamp } from "./math.js";
import { warnOnce } from "./error.js";

const COLOR_CACHE_LIMIT = 4096;
const COLOR_CACHE = new Map();
const COLOR_CACHE_KEYS = [];
let colorCacheEvictIndex = 0;

const CELL_COLOR_RECORD_CACHE = new WeakMap();

const RGB_PATTERN =
  /rgba?\(\s*([0-9]+)\s*(?:,\s*|\s+)([0-9]+)\s*(?:,\s*|\s+)([0-9]+)(?:\s*(?:,\s*|\/\s*)([0-9.]+%?))?\s*\)/i;
const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const EMPTY_RGBA = Object.freeze([0, 0, 0, 0]);

const PACK_RGBA32 = (() => {
  if (typeof Uint8ClampedArray !== "function" || typeof Uint32Array !== "function") {
    return null;
  }

  try {
    const probe = new Uint8ClampedArray(4);
    const view = new Uint32Array(probe.buffer);

    view[0] = 0x01020304;

    if (
      probe[0] === 0x04 &&
      probe[1] === 0x03 &&
      probe[2] === 0x02 &&
      probe[3] === 0x01
    ) {
      return (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  } catch (error) {
    warnOnce("Uint32 color packing unsupported", error);
  }

  return null;
})();

export const supportsPackedColor = Boolean(PACK_RGBA32);

export const EMPTY_COLOR_RECORD = Object.freeze({
  rgba: EMPTY_RGBA,
  packed: PACK_RGBA32 ? PACK_RGBA32(0, 0, 0, 0) : 0,
});

function rememberColor(normalized, record) {
  if (COLOR_CACHE_LIMIT <= 0) {
    return record;
  }

  const cached = COLOR_CACHE.get(normalized);

  // The cache only stores concrete color records, so an `undefined` read
  // reliably indicates a miss. By avoiding the extra `.has()` probe we shave
  // a hash lookup from the hottest path where repeated color lookups hit the
  // cache every frame.
  if (cached !== undefined) {
    return cached;
  }

  COLOR_CACHE.set(normalized, record);

  if (COLOR_CACHE_KEYS.length < COLOR_CACHE_LIMIT) {
    COLOR_CACHE_KEYS.push(normalized);

    return record;
  }

  const evictIndex = colorCacheEvictIndex;
  const evictKey = COLOR_CACHE_KEYS[evictIndex];

  if (evictKey !== undefined) {
    COLOR_CACHE.delete(evictKey);
  }

  COLOR_CACHE_KEYS[evictIndex] = normalized;
  colorCacheEvictIndex =
    COLOR_CACHE_LIMIT > 0 ? (evictIndex + 1) % COLOR_CACHE_LIMIT : 0;

  return record;
}

function parseHexColorComponents(hex) {
  const length = hex.length;

  if (length === 3 || length === 4) {
    const rNibble = Number.parseInt(hex[0], 16);
    const gNibble = Number.parseInt(hex[1], 16);
    const bNibble = Number.parseInt(hex[2], 16);

    if (Number.isNaN(rNibble) || Number.isNaN(gNibble) || Number.isNaN(bNibble)) {
      return null;
    }

    const r = (rNibble << 4) | rNibble;
    const g = (gNibble << 4) | gNibble;
    const b = (bNibble << 4) | bNibble;
    let a = 255;

    if (length === 4) {
      const aNibble = Number.parseInt(hex[3], 16);

      if (Number.isNaN(aNibble)) {
        return null;
      }

      a = (aNibble << 4) | aNibble;
    }

    return { r, g, b, a };
  }

  if (length === 6 || length === 8) {
    const parsed = Number.parseInt(hex, 16);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    const value = parsed >>> 0;

    if (length === 6) {
      return {
        r: (value >>> 16) & 0xff,
        g: (value >>> 8) & 0xff,
        b: value & 0xff,
        a: 255,
      };
    }

    return {
      r: (value >>> 24) & 0xff,
      g: (value >>> 16) & 0xff,
      b: (value >>> 8) & 0xff,
      a: value & 0xff,
    };
  }

  return null;
}

function createColorRecord(r, g, b, a) {
  const rgba = Object.freeze([r, g, b, a]);
  const packed = PACK_RGBA32 ? PACK_RGBA32(r, g, b, a) : 0;

  return Object.freeze({ rgba, packed });
}

/**
 * Parses a CSS-style color value into a frozen `{rgba, packed}` record.
 * Hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) and `rgb[a]()` strings are
 * supported; everything else falls back to the empty record so renderers can
 * treat "invalid" and "transparent" the same way. Results are memoized to
 * avoid repeating expensive regex work when drawing many cells with identical
 * colors.
 *
 * @param {string} color - Raw color string from cell genomes or theme config.
 * @returns {{rgba:readonly number[],packed:number}} Normalized color
 *   descriptor, or the shared `EMPTY_COLOR_RECORD` sentinel when parsing fails.
 */
export function resolveColorRecord(color) {
  if (typeof color !== "string") {
    return EMPTY_COLOR_RECORD;
  }

  const normalized = color.trim();

  if (normalized.length === 0) {
    return EMPTY_COLOR_RECORD;
  }

  const cached = COLOR_CACHE.get(normalized);

  if (cached !== undefined) {
    return cached;
  }

  let record = EMPTY_COLOR_RECORD;

  if (normalized.charCodeAt(0) === 35 /* # */) {
    const match = HEX_PATTERN.exec(normalized);

    if (match) {
      const components = parseHexColorComponents(match[1]);

      if (components) {
        record = createColorRecord(
          components.r,
          components.g,
          components.b,
          components.a,
        );
      }
    }
  } else {
    const match = RGB_PATTERN.exec(normalized);

    if (match) {
      const r = clamp(Number.parseInt(match[1], 10) || 0, 0, 255);
      const g = clamp(Number.parseInt(match[2], 10) || 0, 0, 255);
      const b = clamp(Number.parseInt(match[3], 10) || 0, 0, 255);
      const alphaMatch = match[4];
      let normalizedAlpha = 1;

      if (typeof alphaMatch === "string") {
        const trimmedAlpha = alphaMatch.trim();

        if (trimmedAlpha.length > 0) {
          const alphaNumeric = Number.parseFloat(trimmedAlpha);

          if (Number.isFinite(alphaNumeric)) {
            normalizedAlpha = trimmedAlpha.endsWith("%")
              ? alphaNumeric / 100
              : alphaNumeric;
          }
        }
      }

      const a = clamp(Math.round(normalizedAlpha * 255), 0, 255);

      record = createColorRecord(r, g, b, a);
    }
  }

  return rememberColor(normalized, record);
}

export function resolveCellColorRecord(cell) {
  if (!cell || typeof cell !== "object") {
    return EMPTY_COLOR_RECORD;
  }

  const color = typeof cell.color === "string" ? cell.color : "";
  const cached = CELL_COLOR_RECORD_CACHE.get(cell);

  if (cached) {
    if (cached.color === color) {
      return cached.record;
    }

    const record = color ? resolveColorRecord(color) : EMPTY_COLOR_RECORD;

    cached.color = color;
    cached.record = record;

    return record;
  }

  const record = color ? resolveColorRecord(color) : EMPTY_COLOR_RECORD;

  CELL_COLOR_RECORD_CACHE.set(cell, { color, record });

  return record;
}
