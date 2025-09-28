const { test } = require('uvu');
const assert = require('uvu/assert');

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {},
  ctx: {},
  cellSize: 1,
};

test('applyObstaclePreset returns applied id for known presets', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGrid extends GridManager {
    init() {}
  }

  const gm = new TestGrid(12, 12, baseOptions);
  const applied = gm.applyObstaclePreset('midline');

  assert.is(applied, 'midline');
  assert.is(gm.currentObstaclePreset, 'midline');
});

test('applyObstaclePreset ignores unknown identifiers', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGrid extends GridManager {
    init() {}
  }

  const gm = new TestGrid(10, 10, baseOptions);
  const before = gm.currentObstaclePreset;
  const applied = gm.applyObstaclePreset('unknown-layout');

  assert.is(applied, null);
  assert.is(gm.currentObstaclePreset, before);
});

test('manual obstacle edits mark the preset as custom', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGrid extends GridManager {
    init() {}
  }

  const gm = new TestGrid(12, 12, baseOptions);

  gm.applyObstaclePreset('midline');
  const wallCol = Math.floor(gm.cols / 2);
  const changed = gm.setObstacle(0, wallCol, false);

  assert.ok(changed, 'clearing a wall tile should report a change');
  assert.is(gm.currentObstaclePreset, 'custom');
});

test('appending presets yields a custom layout state', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGrid extends GridManager {
    init() {}
  }

  const gm = new TestGrid(12, 12, baseOptions);

  gm.applyObstaclePreset('perimeter');
  const result = gm.applyObstaclePreset('midline', { append: true, clearExisting: false });

  assert.is(result, 'custom');
  assert.is(gm.currentObstaclePreset, 'custom');
});

test('obstacle preset listeners receive updates in order', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');

  class TestGrid extends GridManager {
    init() {}
  }

  const gm = new TestGrid(12, 12, baseOptions);
  const events = [];

  gm.onObstaclePresetChange((presetId) => events.push(presetId));
  gm.applyObstaclePreset('midline');
  const wallCol = Math.floor(gm.cols / 2);

  gm.setObstacle(0, wallCol, false);
  gm.applyObstaclePreset('none');

  assert.equal(events, ['midline', 'custom', 'none']);
});
