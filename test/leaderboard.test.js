import { assert, test } from "#tests/harness";
import { computeLeaderboard } from "../src/leaderboard.js";

test("computeLeaderboard ranks entries with sanitized inputs and brain snapshots", () => {
  const snapshot = {
    entries: [
      {
        row: 0,
        col: 0,
        fitness: 12,
        cell: {
          offspring: 3,
          fightsWon: 4,
          age: 5,
          color: "#101010",
        },
      },
      {
        row: 1,
        col: 1,
        fitness: 10,
        cell: {
          offspring: "2",
          fightsWon: null,
          age: undefined,
          color: "#202020",
        },
      },
      {
        row: 2,
        col: 2,
        fitness: 8,
        cell: {
          offspring: 1,
          fightsWon: 0,
          age: 7,
          color: "#303030",
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
      { row: 1, col: 1, brain: "primary" },
      { row: 1, col: 1, brain: "secondary" },
      { row: 2, col: 2, brain: "tertiary" },
    ],
  };

  const result = computeLeaderboard(snapshot, "3.9");

  assert.equal(result, [
    {
      row: 0,
      col: 0,
      fitness: 12,
      offspring: 3,
      fightsWon: 4,
      age: 5,
      color: "#101010",
    },
    {
      row: 1,
      col: 1,
      fitness: 10,
      offspring: 0,
      fightsWon: 0,
      age: 0,
      color: "#202020",
      brain: { row: 1, col: 1, brain: "primary" },
    },
    {
      row: 4,
      col: 4,
      fitness: 9,
      offspring: 0,
      fightsWon: 0,
      age: 0,
      color: undefined,
    },
  ]);
});

test("computeLeaderboard preserves entry coordinates for overlay highlights", () => {
  const snapshot = {
    entries: [
      { row: "3", col: 4.2, fitness: 5, cell: {} },
      { row: 1, col: 2, fitness: 4, cell: {} },
    ],
  };

  const [top] = computeLeaderboard(snapshot, 1);

  assert.is(top.row, 3);
  assert.is(top.col, 4.2);
});

test("computeLeaderboard returns empty arrays when topN is zero or invalid snapshot", () => {
  assert.equal(computeLeaderboard(null, 5), []);
  assert.equal(computeLeaderboard({}, 0), []);
  assert.equal(computeLeaderboard({ entries: [] }, -2), []);
});
