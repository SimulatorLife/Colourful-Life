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

const cloneNumeric = (value) => {
  const numeric = Number(value);

  return Number.isFinite(numeric) ? numeric : 0;
};

const cloneArray = (source) => {
  if (!Array.isArray(source) || source.length === 0) {
    return [];
  }

  return Array.from(source, (entry) => {
    if (!entry || typeof entry !== "object") {
      return cloneNumeric(entry);
    }

    const copy = { ...entry };

    for (const [key, value] of Object.entries(copy)) {
      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      } else if (key === "value" || key === "weight") {
        copy[key] = cloneNumeric(value);
      }
    }

    return copy;
  });
};

const cloneTraceInputs = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }

  return Array.from(inputs, (entry) => {
    if (!entry || typeof entry !== "object") {
      return {
        source: entry?.source ?? null,
        weight: cloneNumeric(entry?.weight),
        value: cloneNumeric(entry?.value),
      };
    }

    const copy = { ...entry };

    if ("weight" in copy) copy.weight = cloneNumeric(copy.weight);
    if ("value" in copy) copy.value = cloneNumeric(copy.value);

    for (const [key, value] of Object.entries(copy)) {
      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    return copy;
  });
};

const cloneTraceNodes = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  return Array.from(nodes, (node) => {
    if (!node || typeof node !== "object") {
      return { inputs: [] };
    }

    const copy = { ...node };

    copy.inputs = cloneTraceInputs(node.inputs);

    if ("sum" in copy) copy.sum = cloneNumeric(copy.sum);
    if ("output" in copy) copy.output = cloneNumeric(copy.output);

    for (const [key, value] of Object.entries(copy)) {
      if (key === "inputs") continue;

      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    return copy;
  });
};

const cloneTraceSensors = (sensors) => {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    return [];
  }

  return Array.from(sensors, (sensor) => {
    if (!sensor || typeof sensor !== "object") {
      return { id: null, key: null, value: 0 };
    }

    const copy = { ...sensor };

    if ("value" in copy) copy.value = cloneNumeric(copy.value);

    for (const [key, value] of Object.entries(copy)) {
      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    return copy;
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

  const sensors = cloneTraceSensors(trace.sensors);
  const nodes = cloneTraceNodes(trace.nodes);

  return { sensors, nodes };
}
