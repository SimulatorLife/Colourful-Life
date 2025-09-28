import { test } from 'uvu';
import * as assert from 'uvu/assert';
import SnapshotService from '../src/snapshotService.js';
import GridState from '../src/grid/gridState.js';

function createSnapshotCell({ row, col, energy, age, lifespan }) {
  return {
    row,
    col,
    energy,
    age,
    lifespan,
    offspring: 0,
    fightsWon: 0,
    fightsLost: 0,
    fitnessScore: 0,
    dna: {},
  };
}

test('SnapshotService capture aggregates grid data and reports to BrainDebugger', () => {
  const gridState = new GridState(2, 2, { maxTileEnergy: 10 });
  const cellA = createSnapshotCell({ row: 0, col: 0, energy: 6, age: 2, lifespan: 10 });
  const cellB = createSnapshotCell({ row: 1, col: 1, energy: 4, age: 5, lifespan: 10 });

  gridState.setCell(0, 0, cellA);
  gridState.setCell(1, 1, cellB);

  const recorded = [];
  const brainDebugger = {
    captureFromEntries(entries) {
      recorded.push(entries.map((entry) => entry.row + ',' + entry.col));

      return ['brain'];
    },
  };
  let snapshotRecorded = null;
  const stats = {
    recordSnapshot(snapshot) {
      snapshotRecorded = snapshot;
    },
  };

  const service = new SnapshotService({ stats, brainDebugger });
  const snapshot = service.capture({ gridState, maxTileEnergy: 10 });

  assert.is(snapshot.population, 2);
  assert.is(snapshot.totalEnergy, 10);
  assert.is(snapshot.totalAge, 7);
  assert.equal(snapshot.brainSnapshots, ['brain']);
  assert.ok(Array.isArray(snapshot.entries) && snapshot.entries.length === 2);
  assert.ok(snapshotRecorded === snapshot, 'stats notified with snapshot');
  assert.is(recorded[0].length, 2, 'brain debugger received all entries');
  assert.ok(recorded[0].includes('0,0'));
  assert.ok(recorded[0].includes('1,1'));
});

test('SnapshotService getLastSnapshot builds snapshot on demand', () => {
  const gridState = new GridState(1, 1, { maxTileEnergy: 5 });
  const cell = createSnapshotCell({ row: 0, col: 0, energy: 5, age: 1, lifespan: 5 });

  gridState.setCell(0, 0, cell);

  const service = new SnapshotService();
  const last = service.getLastSnapshot({ gridState, maxTileEnergy: 5 });

  assert.ok(last);
  assert.is(last.population, 1);
  assert.is(service.getLastSnapshot(), last, 'cached snapshot reused');
});

test.run();
