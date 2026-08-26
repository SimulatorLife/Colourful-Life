import { sanitizeNumber } from "./math.js";

/**
 * Object-centric helpers for normalizing configuration payloads and cloning
 * simulation traces. Separating these utilities keeps UI and engine code from
 * depending on the broader numeric helper set.
 */

/**
 * Normalizes an arbitrary candidate to a plain object. Non-object values are
 * coerced to an empty object so callers can safely destructure nested options
 * without additional guards.
 *
 * @template T
 * @param {T} candidate - Potential object-like value supplied by callers.
 * @returns {T extends object ? T : Object} An object suitable for
 *   destructuring.
 */
export function toPlainObject(candidate) {
  return candidate && typeof candidate === "object" ? candidate : {};
}

const sanitizeNumeric = (value) => sanitizeNumber(value, { fallback: 0, round: false });

/**
 * Deep-clones an arbitrary plain (non-trace) sub-object without applying
 * numeric sanitization. Used to preserve referential independence for nested
 * metadata, history blobs, or arbitrary configuration carried by trace
 * entries while avoiding the per-call cost of `structuredClone`.
 *
 * @param {*} source - Candidate nested value from a trace payload.
 * @returns {*} A structurally independent copy with primitive entries.
 */
const clonePlainObject = (source) => {
  if (!source || typeof source !== "object") {
    return source;
  }

  const cloned = {};
  const keys = Object.keys(source);

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const value = source[key];

    if (Array.isArray(value)) {
      cloned[key] = cloneArrayShallow(value);
    } else if (value && typeof value === "object") {
      cloned[key] = clonePlainObject(value);
    } else {
      cloned[key] = value;
    }
  }

  return cloned;
};

/**
 * Clones an array (and any object entries inside it) without applying numeric
 * sanitization. Used for arrays nested inside plain sub-objects where the
 * outer sanitizer does not traverse.
 *
 * @param {Array} source - Array carried as a value within a nested object.
 * @returns {Array} A fresh array with object entries recursively cloned.
 */
const cloneArrayShallow = (source) => {
  const length = source.length;

  if (length === 0) {
    return [];
  }

  const cloned = new Array(length);

  for (let i = 0; i < length; i++) {
    const item = source[i];

    if (item && typeof item === "object") {
      cloned[i] = clonePlainObject(item);
    } else {
      cloned[i] = item;
    }
  }

  return cloned;
};

/**
 * Clone + sanitize an array of arbitrary values. Mirrors the prior
 * `structuredClone` + `sanitizeArrayValues` semantics: primitive entries are
 * coerced to numbers via `sanitizeNumeric`; object entries are cloned with
 * `value`/`weight` keys normalized and any nested arrays recursed through the
 * same sanitizer.
 *
 * @param {Array} source - Array of values from a trace payload.
 * @returns {Array} Sanitized independent copy.
 */
const cloneArrayValues = (source) => {
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  const length = source.length;
  const cloned = new Array(length);

  for (let i = 0; i < length; i++) {
    const entry = source[i];

    if (Array.isArray(entry)) {
      cloned[i] = cloneArrayValues(entry);
      continue;
    }

    if (!entry || typeof entry !== "object") {
      cloned[i] = sanitizeNumeric(entry);
      continue;
    }

    const entryClone = {};
    const entryKeys = Object.keys(entry);

    for (let k = 0; k < entryKeys.length; k++) {
      const key = entryKeys[k];
      const value = entry[key];

      if (Array.isArray(value)) {
        entryClone[key] = cloneArrayValues(value);
      } else if (value && typeof value === "object") {
        entryClone[key] = clonePlainObject(value);
      } else if (key === "value" || key === "weight") {
        entryClone[key] = sanitizeNumeric(value);
      } else {
        entryClone[key] = value;
      }
    }

    cloned[i] = entryClone;
  }

  return cloned;
};

/**
 * Clone + sanitize a node `inputs` array. Preserves the prior semantics where
 * non-object entries collapse to a `{source, weight, value}` default shape
 * (with each numeric field sanitized) and object entries are cloned with
 * `weight`/`value` keys normalized.
 *
 * @param {Array} inputs - Raw inputs array from a neural node trace.
 * @returns {Array} Sanitized independent copy.
 */
const cloneTraceInputs = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }

  const length = inputs.length;
  const cloned = new Array(length);

  for (let i = 0; i < length; i++) {
    const entry = inputs[i];

    if (!entry || typeof entry !== "object") {
      cloned[i] = {
        source: entry?.source ?? null,
        weight: sanitizeNumeric(entry?.weight),
        value: sanitizeNumeric(entry?.value),
      };
      continue;
    }

    const entryClone = {};
    const entryKeys = Object.keys(entry);

    for (let k = 0; k < entryKeys.length; k++) {
      const key = entryKeys[k];
      const value = entry[key];

      if (key === "weight" || key === "value") {
        entryClone[key] = sanitizeNumeric(value);
      } else if (Array.isArray(value)) {
        entryClone[key] = cloneArrayValues(value);
      } else if (value && typeof value === "object") {
        entryClone[key] = clonePlainObject(value);
      } else {
        entryClone[key] = value;
      }
    }

    cloned[i] = entryClone;
  }

  return cloned;
};

/**
 * Clone + sanitize a node from a neural trace. Mirrors the prior behavior
 * where `inputs` are fully reconstructed, `sum`/`output` are sanitized when
 * present, top-level arrays (other than `inputs`) are recursively sanitized,
 * and arbitrary nested objects are cloned without sanitization.
 *
 * @param {*} node - Raw node value from a trace payload.
 * @returns {object} Sanitized independent copy.
 */
const cloneTraceNode = (node) => {
  if (!node || typeof node !== "object") {
    return { inputs: [] };
  }

  const cloned = {};
  const keys = Object.keys(node);

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const value = node[key];

    if (key === "inputs") {
      cloned.inputs = cloneTraceInputs(value);
      continue;
    }

    if (key === "sum" || key === "output") {
      cloned[key] = sanitizeNumeric(value);
      continue;
    }

    if (Array.isArray(value)) {
      cloned[key] = cloneArrayValues(value);
    } else if (value && typeof value === "object") {
      cloned[key] = clonePlainObject(value);
    } else if (key === "value" || key === "weight") {
      cloned[key] = sanitizeNumeric(value);
    } else {
      cloned[key] = value;
    }
  }

  return cloned;
};

const cloneTraceNodes = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const length = nodes.length;
  const cloned = new Array(length);

  for (let i = 0; i < length; i++) {
    cloned[i] = cloneTraceNode(nodes[i]);
  }

  return cloned;
};

/**
 * Clone + sanitize a sensor from a neural trace. Mirrors the prior behavior
 * where the `value` field is sanitized when present, top-level arrays are
 * recursively sanitized, and arbitrary nested objects are cloned without
 * further sanitization.
 *
 * @param {*} sensor - Raw sensor value from a trace payload.
 * @returns {object} Sanitized independent copy.
 */
const cloneTraceSensor = (sensor) => {
  if (!sensor || typeof sensor !== "object") {
    return { id: null, key: null, value: 0 };
  }

  const cloned = {};
  const keys = Object.keys(sensor);

  for (let k = 0; k < keys.length; k++) {
    const key = keys[k];
    const value = sensor[key];

    if (key === "value") {
      cloned.value = sanitizeNumeric(value);
    } else if (Array.isArray(value)) {
      cloned[key] = cloneArrayValues(value);
    } else if (value && typeof value === "object") {
      cloned[key] = clonePlainObject(value);
    } else {
      cloned[key] = value;
    }
  }

  return cloned;
};

const cloneTraceSensors = (sensors) => {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    return [];
  }

  const length = sensors.length;
  const cloned = new Array(length);

  for (let i = 0; i < length; i++) {
    cloned[i] = cloneTraceSensor(sensors[i]);
  }

  return cloned;
};

/**
 * Performs a lightweight deep clone of neural trace payloads so downstream
 * consumers can safely mutate copies without affecting simulation state.
 *
 * The clone is specialized to the trace shape (`sensors` + `nodes`, with
 * nested `inputs`/arbitrary objects/arrays) so it can avoid the per-call
 * overhead of `structuredClone` while preserving sanitization semantics and
 * full referential independence.
 *
 * @param {{sensors?: any[], nodes?: any[]}|null|undefined} trace - Snapshot
 *   returned by `brain.snapshot()` or decision telemetry.
 * @returns {{sensors: any[], nodes: any[]}|null}
 */
export function cloneTracePayload(trace) {
  if (!trace || typeof trace !== "object") {
    return null;
  }

  const sensors = cloneTraceSensors(trace.sensors);
  const nodes = cloneTraceNodes(trace.nodes);

  return { sensors, nodes };
}
