export function randomRange(min, max, rng = Math.random) {
  return rng() * (max - min) + min;
}

export function lerp(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}

export function randomPercent(chance) {
  return Math.random() < chance;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function clamp01(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return 0;

  return clamp(numeric, 0, 1);
}

export function cloneTracePayload(trace) {
  if (!trace) return null;

  return {
    sensors: Array.isArray(trace.sensors) ? trace.sensors.map((entry) => ({ ...entry })) : [],
    nodes: Array.isArray(trace.nodes)
      ? trace.nodes.map((entry) => ({
          ...entry,
          inputs: Array.isArray(entry.inputs) ? entry.inputs.map((input) => ({ ...input })) : [],
        }))
      : [],
  };
}

export function createRankedBuffer(limit, compare) {
  const maxSize = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
  const comparator = typeof compare === 'function' ? compare : () => 0;
  const buffer = [];

  return {
    add(entry) {
      if (entry == null || maxSize === 0) return;

      let low = 0;
      let high = buffer.length;

      while (low < high) {
        const mid = (low + high) >> 1;
        const comparison = comparator(entry, buffer[mid]);

        if (comparison < 0) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }

      if (low >= maxSize && buffer.length >= maxSize) return;

      buffer.splice(low, 0, entry);

      if (buffer.length > maxSize) {
        buffer.length = maxSize;
      }
    },
    getItems() {
      return buffer.slice();
    },
  };
}

/*
 * Deterministic PRNG factory (Mulberry32)
 */
function mulberry32(seed) {
  let a = seed >>> 0;

  return function () {
    a += 0x6d2b79f5;
    let t = a;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRNG(seed) {
  return mulberry32(seed);
}
