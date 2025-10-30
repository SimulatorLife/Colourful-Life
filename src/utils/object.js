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

const sanitizeArrayValues = (source) => {
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  return source.map((entry) => {
    if (Array.isArray(entry)) {
      return sanitizeArrayValues(entry);
    }

    if (!entry || typeof entry !== "object") {
      return sanitizeNumeric(entry);
    }

    for (const [key, value] of Object.entries(entry)) {
      if (Array.isArray(value)) {
        entry[key] = sanitizeArrayValues(value);
      } else if (value && typeof value === "object") {
        // structuredClone already ensures referential independence for nested objects.
      } else if (key === "value" || key === "weight") {
        entry[key] = sanitizeNumeric(value);
      }
    }

    return entry;
  });
};

const sanitizeTraceInputs = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }

  return inputs.map((entry) => {
    if (!entry || typeof entry !== "object") {
      return {
        source: entry?.source ?? null,
        weight: sanitizeNumeric(entry?.weight),
        value: sanitizeNumeric(entry?.value),
      };
    }

    if ("weight" in entry) entry.weight = sanitizeNumeric(entry.weight);
    if ("value" in entry) entry.value = sanitizeNumeric(entry.value);

    for (const [key, value] of Object.entries(entry)) {
      if (Array.isArray(value)) {
        entry[key] = sanitizeArrayValues(value);
      } else if (value && typeof value === "object") {
        // structuredClone covers nested object cloning.
      }
    }

    return entry;
  });
};

const sanitizeTraceNodes = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return nodes.map((node) => {
    if (!node || typeof node !== "object") {
      return { inputs: [] };
    }

    node.inputs = sanitizeTraceInputs(node.inputs);

    if ("sum" in node) node.sum = sanitizeNumeric(node.sum);
    if ("output" in node) node.output = sanitizeNumeric(node.output);

    for (const [key, value] of Object.entries(node)) {
      if (key === "inputs") continue;

      if (Array.isArray(value)) {
        node[key] = sanitizeArrayValues(value);
      } else if (value && typeof value === "object") {
        // structuredClone covers nested object cloning.
      } else if (key === "value" || key === "weight") {
        node[key] = sanitizeNumeric(value);
      }
    }

    return node;
  });
};

const sanitizeTraceSensors = (sensors) => {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    return [];
  }

  return sensors.map((sensor) => {
    if (!sensor || typeof sensor !== "object") {
      return { id: null, key: null, value: 0 };
    }

    if ("value" in sensor) sensor.value = sanitizeNumeric(sensor.value);

    for (const [key, value] of Object.entries(sensor)) {
      if (Array.isArray(value)) {
        sensor[key] = sanitizeArrayValues(value);
      } else if (value && typeof value === "object") {
        // structuredClone covers nested object cloning.
      }
    }

    return sensor;
  });
};

/**
 * Performs a lightweight deep clone of neural trace payloads so downstream
 * consumers can safely mutate copies without affecting simulation state.
 *
 * @param {{sensors?: any[], nodes?: any[]}|null|undefined} trace - Snapshot
 *   returned by `brain.snapshot()` or decision telemetry.
 * @returns {{sensors: any[], nodes: any[]}|null}
 */
export function cloneTracePayload(trace) {
  if (!trace || typeof trace !== "object") {
    return null;
  }

  const cloned = structuredClone(trace);
  const sensors = sanitizeTraceSensors(cloned.sensors);
  const nodes = sanitizeTraceNodes(cloned.nodes);

  return { sensors, nodes };
}
