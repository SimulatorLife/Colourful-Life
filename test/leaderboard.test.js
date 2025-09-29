import { test } from 'uvu';
import * as assert from 'uvu/assert';

import { computeLeaderboard } from '../src/leaderboard.js';

test('computeLeaderboard ranks entries with sanitized inputs and brain snapshots', () => {
  const snapshot = {
    entries: [
      {
        row: 0,
        col: 0,
        fitness: 12,
        smoothedFitness: 14,
        cell: {
          fitnessScore: 11,
          offspring: 3,
          fightsWon: 4,
          age: 5,
          color: '#101010',
        },
      },
      {
        row: 1,
        col: 1,
        fitness: 10,
        smoothedFitness: Number.NaN,
        cell: {
          fitnessScore: 13,
          offspring: '2',
          fightsWon: null,
          age: undefined,
          color: '#202020',
        },
      },
      {
        row: 2,
        col: 2,
        fitness: 8,
        cell: {
          fitnessScore: undefined,
          offspring: 1,
          fightsWon: 0,
          age: 7,
          color: '#303030',
        },
      },
      {
        row: 3,
        col: 3,
        fitness: Number.NaN,
        cell: {
          fitnessScore: 9,
        },
      },
      {
        row: 4,
        col: 4,
        fitness: 9,
      },
    ],
    brainSnapshots: [
      { row: 1, col: 1, brain: 'primary' },
      { row: 1, col: 1, brain: 'secondary' },
      { row: 2, col: 2, brain: 'tertiary' },
    ],
  };

  const result = computeLeaderboard(snapshot, '3.9');

  assert.equal(result, [
    {
      fitness: 12,
      smoothedFitness: 14,
      offspring: 3,
      fightsWon: 4,
      age: 5,
      color: '#101010',
    },
    {
      fitness: 10,
      smoothedFitness: 13,
      offspring: 0,
      fightsWon: 0,
      age: 0,
      color: '#202020',
      brain: { row: 1, col: 1, brain: 'primary' },
    },
    {
      fitness: 8,
      smoothedFitness: 8,
      offspring: 1,
      fightsWon: 0,
      age: 7,
      color: '#303030',
      brain: { row: 2, col: 2, brain: 'tertiary' },
    },
  ]);
});

test('computeLeaderboard returns empty arrays when topN is zero or invalid snapshot', () => {
  assert.equal(computeLeaderboard(null, 5), []);
  assert.equal(computeLeaderboard({}, 0), []);
  assert.equal(computeLeaderboard({ entries: [] }, -2), []);
});

test.run();
