const { test } = require('uvu');
const assert = require('uvu/assert');

function createCanvasStub(width, height) {
  const ctx = {
    clearRect() {},
    fillRect() {},
    strokeRect() {},
  };

  return {
    width,
    height,
    getContext(type) {
      return type === '2d' ? ctx : null;
    },
  };
}

test('SimulationEngine reuses injected subsystems when provided', async () => {
  const { default: SimulationEngine } = await import('../src/simulationEngine.js');
  const { default: EnvironmentSystem } = await import('../src/environmentSystem.js');
  const { default: ObstacleSystem } = await import('../src/obstacleSystem.js');
  const { default: OrganismSystem } = await import('../src/organismSystem.js');

  const rows = 6;
  const cols = 8;
  const environment = new EnvironmentSystem(rows, cols, { maxTileEnergy: 3 });
  const obstacles = new ObstacleSystem(rows, cols);
  const organisms = new OrganismSystem();

  const engine = new SimulationEngine({
    canvas: createCanvasStub(cols * 4, rows * 4),
    config: {
      rows,
      cols,
      cellSize: 4,
      paused: true,
      systems: {
        environmentSystem: environment,
        obstacleSystem: obstacles,
        organismSystem: organisms,
      },
    },
    autoStart: false,
  });

  assert.is(engine.grid.environment, environment, 'engine should reuse provided environment');
  assert.is(engine.grid.obstacles, obstacles, 'engine should reuse provided obstacles');
  assert.is(engine.grid.organisms, organisms, 'engine should reuse provided organism system');
  assert.is(environment.cellGrid, engine.grid.grid, 'environment should be wired to the grid');
  assert.is(organisms.environment, environment, 'organisms should reference the environment');
  assert.is(organisms.obstacles, obstacles, 'organisms should reference the obstacles');
  assert.is(organisms.stats, engine.stats, 'organisms should reference engine stats');
  assert.is(
    organisms.selectionManager,
    engine.selectionManager,
    'selection manager should propagate'
  );
  assert.is(
    organisms.movement.tryMove,
    engine.grid.boundTryMove,
    'movement helpers should be wired'
  );
  assert.is(
    organisms.maxTileEnergy,
    engine.grid.maxTileEnergy,
    'max energy should be synchronized'
  );

  environment.setEnergyAt(1, 1, 2);
  obstacles.setObstacle(1, 1, true);
  assert.is(environment.getEnergyAt(1, 1), 0, 'obstacle callbacks should still clear energy');

  engine.stop();
});

test.run();
