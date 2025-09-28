import { createRNG } from './utils.js';

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function hashSeed(input) {
  if (input == null) return 0;
  const str = String(input);
  let hash = FNV_OFFSET_BASIS;

  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i) & 0xff;
    hash = Math.imul(hash, FNV_PRIME);
  }

  return hash >>> 0;
}

function normalizeSeed(source) {
  if (typeof source === 'number' && Number.isFinite(source)) {
    return source >>> 0;
  }

  if (typeof source === 'bigint') {
    return Number(source & BigInt(0xffffffff));
  }

  if (typeof source === 'string') {
    return hashSeed(source);
  }

  return undefined;
}

function toNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function coerceNextResult(result) {
  const direct = toNumber(result);

  if (Number.isFinite(direct)) return direct;

  if (result && typeof result === 'object') {
    const { value } = result;
    const unwrapped = toNumber(value);

    if (Number.isFinite(unwrapped)) return unwrapped;
  }

  return Math.random();
}

function resolveGenerator(source) {
  if (typeof source === 'function') {
    return { generator: source, seed: undefined };
  }

  if (source && typeof source.next === 'function') {
    return {
      generator: () => coerceNextResult(source.next()),
      seed: typeof source.seed === 'function' ? source.seed() : (source.seed ?? undefined),
    };
  }

  const seed = normalizeSeed(source);

  if (typeof seed === 'number') {
    return { generator: createRNG(seed), seed };
  }

  return { generator: () => Math.random(), seed: undefined };
}

export class RNGController {
  constructor(source) {
    const { generator, seed } = resolveGenerator(source);

    this._seed = seed;
    this._generator = generator;
  }

  get seed() {
    return this._seed;
  }

  next() {
    return this._generator();
  }

  percent(chance) {
    if (!Number.isFinite(chance)) return false;
    if (chance <= 0) return false;
    if (chance >= 1) return true;

    return this.next() < chance;
  }

  range(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new TypeError('RNGController.range requires finite min and max values.');
    }

    return this.next() * (max - min) + min;
  }

  int(min, max) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new TypeError('RNGController.int requires finite min and max values.');
    }

    if (max <= min) {
      throw new RangeError('RNGController.int requires max to be greater than min.');
    }

    return Math.floor(this.range(min, max));
  }

  pick(array) {
    if (!Array.isArray(array) || array.length === 0) return undefined;

    return array[this.int(0, array.length)];
  }

  shuffle(array) {
    if (!Array.isArray(array)) return array;

    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      const tmp = array[i];

      array[i] = array[j];
      array[j] = tmp;
    }

    return array;
  }
}

const defaultRng = new RNGController();

export function createRngController(source) {
  return new RNGController(source);
}

export function resolveRngController(source) {
  if (source instanceof RNGController) {
    return source;
  }

  if (source == null) {
    return defaultRng;
  }

  return new RNGController(source);
}

export function getDefaultRng() {
  return defaultRng;
}

export function seedFromString(value) {
  return normalizeSeed(value);
}
