import { test } from "uvu";
import * as assert from "uvu/assert";
import { approxEqual } from "./helpers/assertions.js";

const computeFitnessModulePromise = import("../src/fitness.mjs");
const configModulePromise = import("../src/config.js");

test("computeFitness defaults to GridManager maxTileEnergy", async () => {
  global.GridManager = { maxTileEnergy: 8 };
  const { computeFitness } = await computeFitnessModulePromise;
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
    cell.energy / global.GridManager.maxTileEnergy +
    cell.age / cell.lifespan;

  assert.is(result, expected);
  delete global.GridManager;
});

test("computeFitness uses provided maxTileEnergy parameter", async () => {
  global.GridManager = { maxTileEnergy: 2 };
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
  delete global.GridManager;
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
  delete global.GridManager;
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
    similarityPenalty: 1,
  };

  const result = computeFitness(cell, 10);
  const expected = 0.6 * 1.2 + 0.5 * 0.4 - 0.25 * 0.6;

  approxEqual(result, expected, 1e-9);
});

test.run();
