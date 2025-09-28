import { computeFitness } from './fitness.js';
import BrainDebugger from './brainDebugger.js';

export default class SnapshotService {
  constructor({ stats, brainDebugger = BrainDebugger } = {}) {
    this.stats = stats || null;
    this.brainDebugger = brainDebugger;
    this.lastSnapshot = null;
  }

  buildSnapshot({ gridState, maxTileEnergy }) {
    if (!gridState) {
      return {
        rows: 0,
        cols: 0,
        population: 0,
        totalEnergy: 0,
        totalAge: 0,
        maxFitness: 0,
        cells: [],
        entries: [],
        brainSnapshots: [],
      };
    }

    const cap = typeof maxTileEnergy === 'number' ? maxTileEnergy : gridState.maxTileEnergy;
    const snapshot = {
      rows: gridState.rows,
      cols: gridState.cols,
      population: 0,
      totalEnergy: 0,
      totalAge: 0,
      maxFitness: 0,
      cells: [],
      entries: [],
    };

    for (let row = 0; row < gridState.rows; row++) {
      for (let col = 0; col < gridState.cols; col++) {
        const cell = gridState.grid[row][col];

        if (!cell) continue;

        const fitness = computeFitness(cell, cap);
        const previous = Number.isFinite(cell.fitnessScore) ? cell.fitnessScore : fitness;
        const smoothed = previous * 0.8 + fitness * 0.2;

        cell.fitnessScore = smoothed;

        snapshot.population++;
        snapshot.totalEnergy += cell.energy;
        snapshot.totalAge += cell.age;
        snapshot.cells.push(cell);
        snapshot.entries.push({ row, col, cell, fitness, smoothedFitness: smoothed });
        if (fitness > snapshot.maxFitness) snapshot.maxFitness = fitness;
      }
    }

    const ranked = [...snapshot.entries].sort((a, b) => (b?.fitness ?? 0) - (a?.fitness ?? 0));

    snapshot.brainSnapshots = this.brainDebugger.captureFromEntries(ranked, { limit: 5 });

    return snapshot;
  }

  capture({ gridState, maxTileEnergy } = {}) {
    const snapshot = this.buildSnapshot({ gridState, maxTileEnergy });

    this.lastSnapshot = snapshot;

    if (this.stats?.recordSnapshot) {
      this.stats.recordSnapshot(snapshot);
    }

    return snapshot;
  }

  getLastSnapshot({ gridState, maxTileEnergy } = {}) {
    if (!this.lastSnapshot && gridState) {
      this.lastSnapshot = this.buildSnapshot({ gridState, maxTileEnergy });
    }

    return this.lastSnapshot;
  }
}
