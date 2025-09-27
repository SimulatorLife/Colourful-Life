const { test } = require('uvu');
const assert = require('uvu/assert');
const SelectionManager = require('../src/selectionManager.js').default;

const sortCoords = (list) => list.map(({ row, col }) => `${row},${col}`).sort();

test('getEligibleSpawnTiles returns full candidate list when no zones active', () => {
  const manager = new SelectionManager(5, 5);
  const result = manager.getEligibleSpawnTiles({
    parent: { row: 2, col: 2 },
    mate: { row: 2, col: 3 },
    origin: { row: 2, col: 1 },
    parentMoved: true,
  });

  const expected = sortCoords([
    { row: 2, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 2 },
    { row: 3, col: 0 },
    { row: 3, col: 1 },
    { row: 3, col: 2 },
    { row: 2, col: 3 },
    { row: 1, col: 3 },
    { row: 3, col: 3 },
    { row: 1, col: 4 },
    { row: 2, col: 4 },
    { row: 3, col: 4 },
  ]);

  assert.ok(result.allowed, 'parents should be allowed without zones');
  assert.equal(sortCoords(result.tiles), expected);
  assert.equal(sortCoords(result.allCandidates), expected);
});

test('getEligibleSpawnTiles filters spawn tiles using active zones', () => {
  const manager = new SelectionManager(5, 5);

  manager.addCustomRectangle(2, 2, 3, 3);

  const result = manager.getEligibleSpawnTiles({
    parent: { row: 2, col: 2 },
    mate: { row: 2, col: 3 },
    origin: { row: 2, col: 1 },
    parentMoved: true,
  });

  const expectedEligible = sortCoords([
    { row: 2, col: 2 },
    { row: 2, col: 3 },
    { row: 3, col: 2 },
    { row: 3, col: 3 },
  ]);
  const expectedAll = sortCoords([
    { row: 2, col: 1 },
    { row: 1, col: 0 },
    { row: 1, col: 1 },
    { row: 1, col: 2 },
    { row: 2, col: 0 },
    { row: 2, col: 2 },
    { row: 3, col: 0 },
    { row: 3, col: 1 },
    { row: 3, col: 2 },
    { row: 2, col: 3 },
    { row: 1, col: 3 },
    { row: 3, col: 3 },
    { row: 1, col: 4 },
    { row: 2, col: 4 },
    { row: 3, col: 4 },
  ]);

  assert.ok(result.allowed, 'parents should be allowed inside the custom zone');
  assert.equal(sortCoords(result.tiles), expectedEligible);
  assert.equal(sortCoords(result.allCandidates), expectedAll);
});

test('getEligibleSpawnTiles rejects parents outside active zones', () => {
  const manager = new SelectionManager(5, 5);

  manager.addCustomRectangle(0, 0, 1, 1);

  const result = manager.getEligibleSpawnTiles({
    parent: { row: 2, col: 2 },
    mate: { row: 2, col: 3 },
    origin: { row: 2, col: 1 },
  });

  assert.not(result.allowed, 'parents outside the active zone should be rejected');
  assert.ok(result.reason, 'blocked result should include a reason');
  assert.is(result.tiles.length, 0);
  assert.is(result.allCandidates.length, 0);
});

test.run();
