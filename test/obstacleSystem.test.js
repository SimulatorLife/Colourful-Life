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

test.run();
