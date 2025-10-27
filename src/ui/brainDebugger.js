import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";
import { sanitizeNonNegativeInteger } from "../utils/math.js";
import { resolveCellColor } from "../utils/cell.js";
import { cloneTracePayload } from "../utils/object.js";

const DEBUG_PROPERTY = "__colourfulLifeBrains";
const state = {
  snapshots: [],
};

const WARNINGS = Object.freeze({
  snapshot: "Brain debugger failed to capture snapshot; skipping entry.",
  telemetry:
    "Brain debugger failed to capture decision telemetry; continuing without telemetry.",
  neuronCount: "Brain debugger failed to resolve neuron count; defaulting to zero.",
  neuralGenes:
    "Brain debugger failed to read neural genes; skipping connection fallback.",
});

function safeInvoke(fn, warningKey, fallback) {
  if (typeof fn !== "function") {
    return fallback;
  }

  let didThrow = false;
  const warningMessage = WARNINGS[warningKey];

  const result = invokeWithErrorBoundary(fn, [], {
    message: warningMessage,
    reporter: warningMessage ? warnOnce : undefined,
    once: true,
    onError: () => {
      didThrow = true;
    },
  });

  return didThrow ? fallback : result;
}

function getGlobalScope() {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;

  return undefined;
}

function cloneSnapshotList(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return cloneTracePayload(list) ?? [];
}

function publishSnapshots(list) {
  const scope = getGlobalScope();

  if (!scope) return;

  scope[DEBUG_PROPERTY] = cloneSnapshotList(list);
}

/**
 * Captures recent brain snapshots for inspection in the browser console or
 * debug UI panels. The debugger stores a bounded list of entries and mirrors
 * them to the global scope (typically `window.__colourfulLifeBrains`) so both
 * browser and headless environments expose the latest data consistently.
 */
const BrainDebugger = {
  update(snapshots = []) {
    state.snapshots = cloneSnapshotList(snapshots);
    publishSnapshots(state.snapshots);

    return state.snapshots;
  },
  get() {
    return cloneSnapshotList(state.snapshots);
  },
  captureFromEntries(entries = [], { limit = 5 } = {}) {
    const count = sanitizeNonNegativeInteger(limit, { fallback: 0 });

    if (!Array.isArray(entries) || count === 0) {
      return this.update([]);
    }

    const next = [];

    const snapshotFromEntry = (entry) => {
      const cell = entry?.cell;
      const brain = cell?.brain;

      if (!brain || typeof brain.snapshot !== "function") return null;

      let snapshot;

      try {
        snapshot = brain.snapshot();
      } catch (error) {
        warnOnce(WARNINGS.snapshot, error);

        return null;
      }

      const telemetryDepth = count > 0 ? count : 1;
      const decisionTelemetry =
        typeof cell?.getDecisionTelemetry === "function"
          ? safeInvoke(() => cell.getDecisionTelemetry(telemetryDepth), "telemetry", [])
          : [];
      const normalizedTelemetry = Array.isArray(decisionTelemetry)
        ? decisionTelemetry
        : [];

      const reportedNeuronCount = Number.isFinite(brain?.neuronCount)
        ? brain.neuronCount
        : 0;
      const fallbackNeuronCount =
        Number.isFinite(cell?.neurons) && cell.neurons > 0
          ? cell.neurons
          : safeInvoke(
              () =>
                typeof cell?.dna?.neurons === "function"
                  ? Number(cell.dna.neurons())
                  : 0,
              "neuronCount",
              0,
            );
      const neuronCount =
        reportedNeuronCount > 0 ? reportedNeuronCount : fallbackNeuronCount;
      const reportedConnectionCount = Number.isFinite(brain?.connectionCount)
        ? brain.connectionCount
        : 0;
      let fallbackConnectionCount = Array.isArray(snapshot?.connections)
        ? snapshot.connections.length
        : 0;

      if (
        fallbackConnectionCount <= 0 &&
        typeof cell?.dna?.neuralGenes === "function"
      ) {
        const genes = safeInvoke(() => cell.dna.neuralGenes(), "neuralGenes", []);

        if (Array.isArray(genes) && genes.length > 0) {
          fallbackConnectionCount = genes.reduce(
            (enabled, gene) => (gene && gene.enabled !== false ? enabled + 1 : enabled),
            0,
          );
        }
      }

      const connectionCount =
        reportedConnectionCount > 0 ? reportedConnectionCount : fallbackConnectionCount;

      return {
        row: entry.row,
        col: entry.col,
        fitness: entry.fitness,
        color: resolveCellColor(cell),
        neuronCount: Number.isFinite(neuronCount) && neuronCount > 0 ? neuronCount : 0,
        connectionCount:
          Number.isFinite(connectionCount) && connectionCount > 0 ? connectionCount : 0,
        brain: snapshot,
        decisions: normalizedTelemetry,
      };
    };

    entries.some((entry) => {
      if (next.length >= count) return true;

      const snapshot = snapshotFromEntry(entry);

      if (snapshot) {
        next.push(snapshot);
      }

      return next.length >= count;
    });

    return this.update(next);
  },
};

export default BrainDebugger;
