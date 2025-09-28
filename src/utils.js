function nextFrom(rng) {
  if (typeof rng === 'function') {
    return rng();
  }

  if (rng && typeof rng.next === 'function') {
    return rng.next();
  }

  return Math.random();
}

export function randomRange(min, max, rng = Math.random) {
  return nextFrom(rng) * (max - min) + min;
}

export const lerp = (a, b, t) => a + (b - a) * (t < 0 ? 0 : t > 1 ? 1 : t);

export function randomPercent(chance, rng = Math.random) {
  if (!Number.isFinite(chance)) return false;

  return nextFrom(rng) < chance;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
