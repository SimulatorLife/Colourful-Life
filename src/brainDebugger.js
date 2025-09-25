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

      next.push({
        row: entry.row,
        col: entry.col,
        fitness: entry.fitness,
        color: cell?.color,
        neuronCount: brain.neuronCount,
        connectionCount: brain.connectionCount,
        brain: detail,
        decisions: telemetry,
      });
    }

    return this.update(next);
  },
};

export default BrainDebugger;
