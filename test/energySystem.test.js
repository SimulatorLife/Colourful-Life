import { test } from 'uvu';
import * as assert from 'uvu/assert';

const baseArea = { x: 0, y: 0, width: 5, height: 5 };

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `Expected ${expected}, received ${actual}`);
}

test('accumulateEventModifiers combines overlapping event effects', async () => {
  const [{ accumulateEventModifiers }, { getEventEffect }, { isEventAffecting }] =
    await Promise.all([
      import('../src/energySystem.js'),
      import('../src/eventEffects.js'),
      import('../src/eventManager.js'),
    ]);

  const events = [
    { eventType: 'drought', strength: 0.5, affectedArea: baseArea },
    { eventType: 'flood', strength: 0.6, affectedArea: baseArea },
    { eventType: 'heatwave', strength: 1, affectedArea: { x: 10, y: 10, width: 3, height: 3 } },
  ];

  const result = accumulateEventModifiers({
    events,
    row: 2,
    col: 2,
    eventStrengthMultiplier: 1.5,
    isEventAffecting,
    getEventEffect,
  });

  approxEqual(result.regenMultiplier, 0.475, 1e-6);
  approxEqual(result.regenAdd, 0.225, 1e-6);
  approxEqual(result.drainAdd, 0.075, 1e-6);
  assert.is(result.appliedEvents.length, 2);
  assert.equal(
    result.appliedEvents.map(({ effect }) => effect.cell?.resistanceGene),
    ['droughtResist', 'floodResist']
  );
});

test('computeTileEnergyUpdate applies density penalties and diffusion', async () => {
  const [
    { computeTileEnergyUpdate },
    { getEventEffect },
    { isEventAffecting },
    { REGEN_DENSITY_PENALTY },
  ] = await Promise.all([
    import('../src/energySystem.js'),
    import('../src/eventEffects.js'),
    import('../src/eventManager.js'),
    import('../src/config.js'),
  ]);

  const events = [
    { eventType: 'drought', strength: 0.5, affectedArea: baseArea },
    { eventType: 'flood', strength: 0.6, affectedArea: baseArea },
  ];

  const baseOptions = {
    currentEnergy: 2,
    density: 0.4,
    events,
    row: 1,
    col: 1,
    config: {
      maxTileEnergy: 5,
      regenRate: 0.5,
      diffusionRate: 0.2,
      densityEffectMultiplier: 1,
      regenDensityPenalty: REGEN_DENSITY_PENALTY,
      eventStrengthMultiplier: 1.5,
      isEventAffecting,
      getEventEffect,
    },
  };

  const scalarResult = computeTileEnergyUpdate({
    ...baseOptions,
    neighborSum: 7,
    neighborCount: 2,
  });

  approxEqual(scalarResult.nextEnergy, 2.564, 1e-3);
  approxEqual(scalarResult.drain, 0.075, 1e-6);

  const arrayResult = computeTileEnergyUpdate({
    ...baseOptions,
    neighborEnergies: [3, 4],
  });

  approxEqual(arrayResult.nextEnergy, scalarResult.nextEnergy, 1e-6);
  approxEqual(arrayResult.drain, scalarResult.drain, 1e-6);
});

test.run();
