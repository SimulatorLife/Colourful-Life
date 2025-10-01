const DEBUG_PROPERTY = "__colourfulLifeBrains";
const state = {
  snapshots: [],
};

function getGlobalScope() {
  if (typeof globalThis !== "undefined") return globalThis;
  if (typeof window !== "undefined") return window;

  return undefined;
}

function cloneSnapshotList(list) {
  return Array.isArray(list) ? list.map((item) => ({ ...item })) : [];
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
    const count = Math.max(0, Math.floor(limit));
    const next = [];

    if (!Array.isArray(entries) || count === 0) {
      return this.update([]);
    }

    for (let i = 0; i < entries.length && next.length < count; i++) {
      const entry = entries[i];
      const cell = entry?.cell;
      const brain = cell?.brain;

      if (!brain || typeof brain.snapshot !== "function") continue;
      const snapshot = brain.snapshot();
      const decisionTelemetry =
        typeof cell?.getDecisionTelemetry === "function"
          ? cell.getDecisionTelemetry(3)
          : [];

      const reportedNeuronCount = Number.isFinite(brain?.neuronCount)
        ? brain.neuronCount
        : 0;
      const fallbackNeuronCount =
        Number.isFinite(cell?.neurons) && cell.neurons > 0
          ? cell.neurons
          : typeof cell?.dna?.neurons === "function"
            ? Number(cell.dna.neurons())
            : 0;
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
        const genes = cell.dna.neuralGenes();

        if (Array.isArray(genes) && genes.length > 0) {
          let enabled = 0;

          for (let j = 0; j < genes.length; j += 1) {
            const gene = genes[j];

            if (gene && gene.enabled !== false) enabled += 1;
          }

          fallbackConnectionCount = enabled;
        }
      }

      const connectionCount =
        reportedConnectionCount > 0 ? reportedConnectionCount : fallbackConnectionCount;

      next.push({
        row: entry.row,
        col: entry.col,
        fitness: entry.fitness,
        color: cell?.color,
        neuronCount: Number.isFinite(neuronCount) && neuronCount > 0 ? neuronCount : 0,
        connectionCount:
          Number.isFinite(connectionCount) && connectionCount > 0 ? connectionCount : 0,
        brain: snapshot,
        decisions: decisionTelemetry,
      });
    }

    return this.update(next);
  },
};

export default BrainDebugger;
