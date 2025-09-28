const { test } = require('uvu');
const assert = require('uvu/assert');

test('ObstacleSystem.applyPreset paints expected tiles', async () => {
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');

  const applied = [];
  const system = new ObstacleSystem(5, 5, {
    onTileBlocked: ({ row, col }) => applied.push(`${row},${col}`),
  });

  system.applyPreset('midline', { presetOptions: { gapEvery: 2 } });

  assert.ok(applied.length > 0, 'preset should add obstacles');
  assert.ok(
    applied.every((key) => key.endsWith(',2')),
    'midline should block a central column'
  );
});

test('ObstacleSystem scenarios schedule future presets', async () => {
  const { default: ObstacleSystem, OBSTACLE_SCENARIOS } = await import('../src/obstacleSystem.js');

  const system = new ObstacleSystem(4, 4);

  const scenario = OBSTACLE_SCENARIOS.find((s) => s.id === 'mid-run-wall');

  system.runScenario(scenario.id, 0);

  assert.ok(system.obstacleSchedules.length > 0, 'scenario should enqueue scheduled presets');
  system.processScheduledObstacles(0);
  assert.is(system.currentPreset, 'none', 'initial preset should clear obstacles');
  system.processScheduledObstacles(600);
  assert.is(system.currentPreset, 'midline', 'scheduled preset should apply at the trigger tick');
});

test('ObstacleSystem.setCallbacks swaps handlers dynamically', async () => {
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');

  const blocked = [];
  const cleared = [];
  const system = new ObstacleSystem(3, 3);

  system.setCallbacks({
    onTileBlocked: (payload) => blocked.push(payload),
    onTileCleared: (payload) => cleared.push(payload),
  });

  system.setObstacle(1, 1, true);
  system.setObstacle(1, 1, false);

  assert.is(blocked.length, 1, 'custom blocked handler should fire once');
  assert.is(cleared.length, 1, 'custom cleared handler should fire once');

  system.setCallbacks({});

  system.setObstacle(2, 2, true);
  system.setObstacle(2, 2, false);

  assert.is(blocked.length, 1, 'handlers should be cleared when callbacks reset');
  assert.is(cleared.length, 1, 'cleared handler should not fire after reset');
});

test.run();
