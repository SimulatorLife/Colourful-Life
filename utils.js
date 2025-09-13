export function randomRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function randomPercent(chance) {
  return Math.random() < chance;
}
