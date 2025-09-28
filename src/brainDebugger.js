const state = {
  snapshots: [],
};

function cloneSnapshotList(list) {
  return list.map((item) => ({ ...item }));
}

function publishToWindow(list) {
  if (typeof window !== 'undefined') {
    window.__colourfulLifeBrains = cloneSnapshotList(list);
  }
}

const BrainDebugger = {
  update(snapshots = []) {
    state.snapshots = Array.isArray(snapshots) ? cloneSnapshotList(snapshots) : [];
    publishToWindow(state.snapshots);

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

      if (!brain || typeof brain.snapshot !== 'function') continue;
      const detail = brain.snapshot();
      const telemetry =
        typeof cell?.getDecisionTelemetry === 'function' ? cell.getDecisionTelemetry(3) : [];

      const reportedNeuronCount = Number.isFinite(brain?.neuronCount) ? brain.neuronCount : 0;
      const fallbackNeuronCount =
        Number.isFinite(cell?.neurons) && cell.neurons > 0
          ? cell.neurons
          : typeof cell?.dna?.neurons === 'function'
            ? Number(cell.dna.neurons())
            : 0;
      const neuronCount = reportedNeuronCount > 0 ? reportedNeuronCount : fallbackNeuronCount;
      const reportedConnectionCount = Number.isFinite(brain?.connectionCount)
        ? brain.connectionCount
        : 0;
      let fallbackConnectionCount = Array.isArray(detail?.connections)
        ? detail.connections.length
        : 0;

      if (fallbackConnectionCount <= 0 && typeof cell?.dna?.neuralGenes === 'function') {
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
        brain: detail,
        decisions: telemetry,
      });
    }

    return this.update(next);
  },
};

export default BrainDebugger;
