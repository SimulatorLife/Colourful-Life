export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomPercent(chance) {
  return Math.random() < chance;
}

export function createRNG(seed) {
  seed = seed >>> 0;
  return function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
