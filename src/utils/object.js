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

  const cloned = new Array(source.length);

  for (let i = 0; i < source.length; i += 1) {
    const entry = source[i];

    if (!entry || typeof entry !== "object") {
      cloned[i] = cloneNumeric(entry);

      continue;
    }

    cloned[i] = { ...entry };

    for (const key of Object.keys(cloned[i])) {
      const value = cloned[i][key];

      if (Array.isArray(value)) {
        cloned[i][key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        cloned[i][key] = { ...value };
      } else if (key === "value" || key === "weight") {
        cloned[i][key] = cloneNumeric(value);
      }
    }
  }

  return cloned;
};

const cloneTraceInputs = (inputs) => {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return [];
  }

  const cloned = new Array(inputs.length);

  for (let i = 0; i < inputs.length; i += 1) {
    const entry = inputs[i];

    if (!entry || typeof entry !== "object") {
      cloned[i] = {
        source: entry?.source ?? null,
        weight: cloneNumeric(entry?.weight),
        value: cloneNumeric(entry?.value),
      };

      continue;
    }

    const copy = { ...entry };

    if ("weight" in copy) copy.weight = cloneNumeric(copy.weight);
    if ("value" in copy) copy.value = cloneNumeric(copy.value);

    for (const key of Object.keys(copy)) {
      const value = copy[key];

      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    cloned[i] = copy;
  }

  return cloned;
};

const cloneTraceNodes = (nodes) => {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return [];
  }

  const cloned = new Array(nodes.length);

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];

    if (!node || typeof node !== "object") {
      cloned[i] = { inputs: [] };

      continue;
    }

    const copy = { ...node };

    copy.inputs = cloneTraceInputs(node.inputs);

    if ("sum" in copy) copy.sum = cloneNumeric(copy.sum);
    if ("output" in copy) copy.output = cloneNumeric(copy.output);

    for (const key of Object.keys(copy)) {
      if (key === "inputs") continue;

      const value = copy[key];

      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    cloned[i] = copy;
  }

  return cloned;
};

const cloneTraceSensors = (sensors) => {
  if (!Array.isArray(sensors) || sensors.length === 0) {
    return [];
  }

  const cloned = new Array(sensors.length);

  for (let i = 0; i < sensors.length; i += 1) {
    const sensor = sensors[i];

    if (!sensor || typeof sensor !== "object") {
      cloned[i] = { id: null, key: null, value: 0 };

      continue;
    }

    const copy = { ...sensor };

    if ("value" in copy) copy.value = cloneNumeric(copy.value);

    for (const key of Object.keys(copy)) {
      const value = copy[key];

      if (Array.isArray(value)) {
        copy[key] = cloneArray(value);
      } else if (typeof value === "object" && value !== null) {
        copy[key] = { ...value };
      }
    }

    cloned[i] = copy;
  }

  return cloned;
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
