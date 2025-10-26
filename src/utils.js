// Deprecated barrel that preserves backwards compatibility for legacy imports.
// New code should import from the scoped helpers in `./utils/*.js`.
export {
  randomRange,
  lerp,
  clamp,
  clampFinite,
  clamp01,
  sanitizeNumber,
  sanitizePositiveInteger,
  pickFirstFinitePositive,
  toFiniteOrNull,
  createRNG,
} from "./utils/math.js";
export { isArrayLike, createRankedBuffer } from "./utils/collections.js";
export { coerceBoolean } from "./utils/primitives.js";
export { toPlainObject, cloneTracePayload } from "./utils/object.js";
