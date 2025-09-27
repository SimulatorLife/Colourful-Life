const { test } = require('uvu');
const assert = require('uvu/assert');

const baseStats = {
  onDeath() {},
  onBirth() {},
  recordMateChoice() {},
};

const buildControllers = async () => {
  const [
    { default: EnvironmentField },
    { default: PopulationManager },
    { default: ObstacleController },
    { default: DNA },
    { default: Cell },
  ] = await Promise.all([
    import('../src/environmentField.js'),
    import('../src/populationManager.js'),
    import('../src/obstacleController.js'),
    import('../src/genome.js'),
    import('../src/cell.js'),
  ]);

  const environment = new EnvironmentField(1, 1);
  const population = new PopulationManager(1, 1, {
    environment,
    stats: baseStats,
  });
  const controller = new ObstacleController(1, 1, {
    onBlockTile: ({ row, col, evict }) => {
      if (population.getCell(row, col) && evict) {
        population.removeCell(row, col);
      }
      environment.resetTile(row, col);
    },
    onClearTile: ({ row, col }) => environment.resetTile(row, col),
  });

  environment.setObstacleChecker((row, col) => controller.isObstacle(row, col));
  population.setObstacleController(controller);

  const dna = new DNA(1, 1, 1);
  const occupant = new Cell(0, 0, dna, 5);

  population.setCell(0, 0, occupant);

  return { environment, population, controller, occupant };
};

test('ObstacleController respects evict=false when blocking tiles', async () => {
  const { environment, population, controller, occupant } = await buildControllers();

  environment.setEnergy(0, 0, 7);
  environment.energyNext[0][0] = 3;

  controller.setObstacle(0, 0, true, { evict: false });

  assert.is(population.getCell(0, 0), occupant, 'occupant should remain when evict=false');
  assert.is(environment.getEnergy(0, 0), 0, 'tile energy should reset when blocked');
  assert.is(environment.energyNext[0][0], 0, 'buffer energy should reset when blocked');
  assert.ok(controller.isObstacle(0, 0), 'controller should mark tile as blocked');
});

test('ObstacleController runObstacleScenario queues delayed presets', async () => {
  const { controller } = await buildControllers();

  controller.setCurrentTick(10);
  const scheduled = controller.runObstacleScenario('mid-run-wall');

  assert.ok(scheduled, 'scenario should be recognized');
  assert.ok(controller.obstacleSchedules.length > 0, 'scenario should enqueue future steps');
  controller.processSchedules(10);
  assert.is(controller.getCurrentPreset(), 'none', 'first step should apply immediately');
});

test.run();
