const { test } = require('uvu');
const assert = require('uvu/assert');

const baseOptions = {
  eventManager: { activeEvents: [] },
  stats: {
    onDeath() {},
    onBirth() {},
  },
  ctx: {},
  cellSize: 1,
};

test('GridManager accepts injected subsystem instances', async () => {
  const { default: GridManager } = await import('../src/gridManager.js');
  const { default: EnvironmentSystem } = await import('../src/environmentSystem.js');
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');
  const { default: OrganismSystem } = await import('../src/organismSystem.js');

  class TestGridManager extends GridManager {
    init() {}
  }

  const rows = 4;
  const cols = 4;
  const environment = new EnvironmentSystem(rows, cols, { maxTileEnergy: 3 });
  const obstacles = new ObstacleSystem(rows, cols);
  const organisms = new OrganismSystem();

  const gm = new TestGridManager(rows, cols, {
    ...baseOptions,
    environmentSystem: environment,
    obstacleSystem: obstacles,
    organismSystem: organisms,
  });

  assert.is(gm.environment, environment, 'provided environment should be reused');
  assert.is(gm.obstacles, obstacles, 'provided obstacles should be reused');
  assert.is(gm.organisms, organisms, 'provided organism system should be reused');
  assert.is(environment.cellGrid, gm.grid, 'environment should receive the grid reference');
  assert.is(organisms.grid, gm.grid, 'organism system should be configured with the grid');
  assert.is(organisms.environment, environment, 'organism system should use injected environment');
  assert.is(organisms.obstacles, obstacles, 'organism system should use injected obstacles');
  assert.is(organisms.movement.tryMove, gm.boundTryMove, 'movement helpers should be wired in');
  assert.is(organisms.maxTileEnergy, gm.maxTileEnergy, 'organism system should inherit max energy');

  environment.setEnergyAt(1, 1, 2);
  gm.setObstacle(1, 1, true);

  assert.is(environment.getEnergyAt(1, 1), 0, 'obstacle callbacks should clear tile energy');
});

test.run();
