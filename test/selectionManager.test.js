import { test } from 'uvu';
import * as assert from 'uvu/assert';
import SelectionManager from '../src/selectionManager.js';

function createManager(rows = 6, cols = 6) {
  return new SelectionManager(rows, cols);
}

test('activating built-in patterns restricts eligibility and updates descriptions', () => {
  const manager = createManager();

  assert.is(manager.hasActiveZones(), false, 'no zones active by default');
  assert.is(manager.describeActiveZones(), 'All tiles eligible');
  assert.is(manager.isInActiveZone(0, 0), true, 'all tiles allowed when no zones active');

  assert.is(manager.togglePattern('eastHalf', true), true);
  assert.ok(manager.hasActiveZones());
  assert.is(
    manager.isInActiveZone(2, 1),
    false,
    'west half should be inactive when eastHalf enabled'
  );
  assert.is(manager.isInActiveZone(2, 4), true, 'east half should remain eligible');
  assert.is(manager.describeActiveZones(), 'Eastern Hemisphere');

  manager.togglePattern('cornerPatches', true);
  assert.is(
    manager.describeActiveZones(),
    'Eastern Hemisphere, Corner Refuges',
    'multiple active patterns are listed by name'
  );
  assert.is(manager.isInActiveZone(0, 0), true, 'corner refuge should be active');

  manager.togglePattern('eastHalf', false);
  manager.togglePattern('cornerPatches', false);
  assert.is(manager.hasActiveZones(), false);
  assert.is(manager.describeActiveZones(), 'All tiles eligible');
  assert.is(manager.isInActiveZone(2, 1), true, 'all tiles eligible after patterns disabled');
});

test('addCustomRectangle clamps coordinates and exposes accurate bounds/contains', () => {
  const manager = createManager();
  const zone = manager.addCustomRectangle(-2, -5, 12, 9);

  assert.ok(zone, 'custom zone should be created');
  assert.is(zone.id, 'custom-0');
  assert.equal(zone.bounds, { startRow: 0, endRow: 5, startCol: 0, endCol: 5 });
  assert.is(zone.contains(0, 0), true, 'clamped origin should be contained');
  assert.is(zone.contains(5, 5), true, 'clamped corner should be contained');
  assert.is(zone.contains(3, 3), true);
  assert.is(zone.contains(5, 6), false, 'coordinates outside bounds should fail contains');

  assert.is(manager.getActiveZones().length, 1, 'custom zones contribute to active zones');
  assert.is(manager.hasCustomZones(), true, 'custom zone presence is reflected');

  manager.clearCustomZones();
  assert.is(manager.getActiveZones().length, 0, 'clearCustomZones removes user zones');
  assert.is(manager.hasCustomZones(), false, 'custom zone tracker resets after clearing');
  assert.is(manager.describeActiveZones(), 'All tiles eligible');
});

test('validateReproductionArea enforces zone boundaries for parents and spawn', () => {
  const manager = createManager();

  manager.togglePattern('eastHalf', true);

  assert.equal(manager.validateReproductionArea({ parentA: { row: 2, col: 1 } }), {
    allowed: false,
    role: 'parentA',
    reason: 'Parent is outside the reproductive zone',
  });

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 1, col: 3 },
      parentB: { row: 3, col: 2 },
    }),
    {
      allowed: false,
      role: 'parentB',
      reason: 'Mate is outside the reproductive zone',
    }
  );

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 1, col: 3 },
      parentB: { row: 2, col: 4 },
      spawn: { row: 0, col: 1 },
    }),
    {
      allowed: false,
      role: 'spawn',
      reason: 'Spawn tile is outside the reproductive zone',
    }
  );

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 2, col: 4 },
      parentB: { row: 3, col: 5 },
      spawn: { row: 1, col: 3 },
    }),
    { allowed: true }
  );

  manager.togglePattern('eastHalf', false);
  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 2, col: 0 },
      spawn: { row: 4, col: 0 },
    }),
    { allowed: true },
    'with no active zones, any tile should be allowed'
  );
});

test.run();
