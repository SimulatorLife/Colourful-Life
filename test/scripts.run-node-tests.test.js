import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTestRunnerArgs } from "../scripts/run-node-tests.mjs";

test("normalizeTestRunnerArgs filters falsey watch flags", () => {
  const { flags, paths } = normalizeTestRunnerArgs([
    "--watch=false",
    "--test-name-pattern=GridManager",
    "selectionZones",
  ]);

  assert.deepEqual(flags, ["--test-name-pattern=GridManager"]);
  assert.deepEqual(paths, ["selectionZones"]);
});

test("normalizeTestRunnerArgs normalizes watch shorthands", () => {
  const { flags, paths } = normalizeTestRunnerArgs([
    "--watch",
    "on",
    "--watch=off",
    "--watch=true",
    "--watch",
  ]);

  assert.deepEqual(flags, ["--watch", "--watch", "--watch"]);
  assert.deepEqual(paths, []);
});

test("normalizeTestRunnerArgs preserves positional targets", () => {
  const { flags, paths } = normalizeTestRunnerArgs([
    "--test-name-pattern=brain",
    "ui/",
    "helpers.js",
  ]);

  assert.deepEqual(flags, ["--test-name-pattern=brain"]);
  assert.deepEqual(paths, ["ui/", "helpers.js"]);
});

test("normalizeTestRunnerArgs stops processing after explicit terminator", () => {
  const { flags, paths } = normalizeTestRunnerArgs([
    "--watch",
    "--",
    "--watch=false",
    "focus.test.js",
  ]);

  assert.deepEqual(flags, ["--watch"]);
  assert.deepEqual(paths, ["--watch=false", "focus.test.js"]);
});
