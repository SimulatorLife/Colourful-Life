import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const computeFitnessModulePromise = import("../src/engine/fitness.mjs");
const configModulePromise = import("../src/config.js");

test("computeFitness defaults to config maxTileEnergy", async () => {
  const [{ computeFitness }, { MAX_TILE_ENERGY }] = await Promise.all([
    computeFitnessModulePromise,
    configModulePromise,
  ]);
  const cell = {
    fightsWon: 2,
    fightsLost: 1,
    offspring: 3,
    energy: 4,
    age: 50,
    lifespan: 100,
  };

  const result = computeFitness(cell);
  const expected =
    (cell.fightsWon - cell.fightsLost) * 0.5 +
    (cell.offspring || 0) * 1.5 +
    cell.energy / MAX_TILE_ENERGY +
    cell.age / cell.lifespan;

  assert.is(result, expected);
});

test("computeFitness uses provided maxTileEnergy parameter", async () => {
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 1,
    fightsLost: 0,
    offspring: 2,
    energy: 1,
    age: 10,
    lifespan: 40,
  };

  const result = computeFitness(cell, 4);
  const expected = (1 - 0) * 0.5 + 2 * 1.5 + 1 / 4 + cell.age / cell.lifespan;

  assert.is(result, expected);
});

test("computeFitness handles minimal stats with explicit max energy", async () => {
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    energy: 0,
    age: 0,
    lifespan: 100,
  };

  const result = computeFitness(cell, 5);

  assert.is(result, 0);
});

test("computeFitness falls back to config default max energy when no manager is available", async () => {
  const [{ computeFitness }, { MAX_TILE_ENERGY }] = await Promise.all([
    computeFitnessModulePromise,
    configModulePromise,
  ]);

  const cell = {
    fightsWon: 1,
    fightsLost: 0,
    offspring: 0,
    energy: MAX_TILE_ENERGY,
    age: 0,
    lifespan: 1,
  };

  const result = computeFitness(cell);
  const expected = (1 - 0) * 0.5 + 0 * 1.5 + MAX_TILE_ENERGY / MAX_TILE_ENERGY + 0 / 1;

  assert.is(result, expected);
});

test("computeFitness rewards diverse mating and penalizes similarity pressure", async () => {
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    energy: 0,
    age: 0,
    lifespan: 100,
    matingAttempts: 4,
    matingSuccesses: 2,
    diverseMateScore: 1.2,
    complementaryMateScore: 1.4,
    similarityPenalty: 1,
    strategyPenalty: 0.8,
    diversityOpportunitySamples: 0,
    diversityOpportunityAlignmentScore: 0,
    diversityOpportunityNeglectScore: 0,
  };

  const result = computeFitness(cell, 10);
  const diversityRate = 1.2 / 2;
  const successRate = 2 / 4;
  const complementRate = 1.4 / 2;
  const penaltyRate = Math.min(1, 1 / 4);
  const monotonyRate = Math.min(1, 0.8 / 4);
  const expected =
    diversityRate * 1.2 +
    successRate * 0.4 +
    complementRate * (0.9 + diversityRate * 0.35) -
    penaltyRate * 0.6 -
    monotonyRate * 0.4 -
    (1 - complementRate) * penaltyRate * 0.2;

  approxEqual(result, expected, 1e-9);
});

test("computeFitness rewards opportunity engagement and penalizes neglect", async () => {
  const { computeFitness } = await computeFitnessModulePromise;
  const cell = {
    fightsWon: 0,
    fightsLost: 0,
    offspring: 0,
    energy: 0,
    age: 0,
    lifespan: 100,
    matingAttempts: 4,
    matingSuccesses: 2,
    diverseMateScore: 0.8,
    complementaryMateScore: 0.6,
    similarityPenalty: 0.5,
    strategyPenalty: 0.4,
    diversityOpportunitySamples: 3,
    diversityOpportunityAlignmentScore: 1.8,
    diversityOpportunityNeglectScore: 0.9,
  };

  const result = computeFitness(cell, 10);
  const diversityRate = 0.8 / 2;
  const successRate = 2 / 4;
  const complementRate = 0.6 / 2;
  const penaltyRate = Math.min(1, 0.5 / 4);
  const monotonyRate = Math.min(1, 0.4 / 4);
  const opportunityAlignmentRate = 1.8 / 3;
  const opportunityNeglectRate = Math.min(1, 0.9 / 3);
  const expected =
    diversityRate * 1.2 +
    successRate * 0.4 +
    complementRate * (0.9 + diversityRate * 0.35) -
    penaltyRate * 0.6 -
    monotonyRate * 0.4 -
    (1 - complementRate) * penaltyRate * 0.2 +
    opportunityAlignmentRate * (0.6 + diversityRate * 0.2) -
    opportunityNeglectRate * 0.5;

  approxEqual(result, expected, 1e-9);
});
