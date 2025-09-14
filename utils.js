export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomPercent(chance) {
  return Math.random() < chance;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
