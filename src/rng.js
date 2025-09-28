import { createRNG } from './utils.js';

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;

function hashString(value) {
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

export function normalizeSeed(seed) {
  if (seed == null) {
    return 0;
  }

  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (Math.floor(seed) >>> 0) >>> 0;
  }

  if (typeof seed === 'bigint') {
    return Number(seed & BigInt(0xffffffff)) >>> 0;
  }

  if (typeof seed === 'string') {
    return hashString(seed);
  }

  if (typeof seed === 'boolean') {
    return seed ? 1 : 0;
  }

  if (typeof seed === 'object') {
    if (typeof seed.seed === 'number') {
      return normalizeSeed(seed.seed);
    }

    if (typeof seed.value === 'number') {
      return normalizeSeed(seed.value);
    }
  }

  return 0;
}

function sanitizeValue(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return 0;
  if (numeric <= 0) return 0;
  if (numeric >= 1) return numeric % 1;

  return numeric;
}

function coerceGenerator(source) {
  if (!source) {
    const seed = Date.now() >>> 0;

    return { seed, generator: createRNG(seed) };
  }

  if (source instanceof RNGController) {
    return {
      seed: source.seed,
      generator: source.next.bind(source),
    };
  }

  if (typeof source === 'function') {
    return {
      seed: null,
      generator() {
        return sanitizeValue(source());
      },
    };
  }

  if (typeof source === 'object') {
    if (typeof source.next === 'function') {
      return {
        seed: typeof source.seed === 'number' ? normalizeSeed(source.seed) : null,
        generator() {
          return sanitizeValue(source.next());
        },
      };
    }

    if (typeof source.generator === 'function') {
      return {
        seed: typeof source.seed === 'number' ? normalizeSeed(source.seed) : null,
        generator: () => sanitizeValue(source.generator()),
      };
    }

    if (typeof source.seed !== 'undefined') {
      const normalized = normalizeSeed(source.seed);

      return {
        seed: normalized,
        generator: createRNG(normalized),
      };
    }
  }

  const normalized = normalizeSeed(source);

  return { seed: normalized, generator: createRNG(normalized) };
}

export class RNGController {
  constructor(source) {
    const { seed, generator } = coerceGenerator(source);

    this.seed = seed;
    this.#generator = generator;
  }

  #generator;

  next() {
    return sanitizeValue(this.#generator());
  }

  percent(chance) {
    if (!Number.isFinite(chance)) return false;
    const clamped = Math.max(0, Math.min(1, chance));

    return this.next() < clamped;
  }

  range(min = 0, max = 1) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return this.next();
    }

    if (max === min) return min;

    const [lo, hi] = max > min ? [min, max] : [max, min];

    return this.next() * (hi - lo) + lo;
  }

  int(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return Math.floor(this.next() * 0x100000000);
    }

    const ceilMin = Math.ceil(min);
    const floorMax = Math.floor(max);

    if (floorMax <= ceilMin) return ceilMin;

    return Math.floor(this.range(ceilMin, floorMax));
  }

  pick(list) {
    if (!Array.isArray(list) || list.length === 0) return undefined;

    const index = Math.floor(this.next() * list.length);

    return list[index];
  }

  shuffle(list) {
    if (!Array.isArray(list)) return [];

    const copy = [...list];

    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = copy[i];

      copy[i] = copy[j];
      copy[j] = tmp;
    }

    return copy;
  }
}

export function createRngController(input) {
  if (input instanceof RNGController) return input;

  return new RNGController(input);
}

export function resolveRng(input) {
  if (input instanceof RNGController) return input;
  if (input && typeof input.next === 'function' && typeof input.percent === 'function') {
    return input;
  }

  return new RNGController(input);
}
