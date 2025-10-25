import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  expandTestTargets,
  normalizeTestRunnerArgs,
} from "../scripts/run-node-tests.mjs";

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

test("normalizeTestRunnerArgs treats watchAll falsey values as disabling watch", () => {
  const { flags, paths } = normalizeTestRunnerArgs([
    "--watchAll=false",
    "--watch-all=0",
    "gridManager",
  ]);

  assert.deepEqual(flags, []);
  assert.deepEqual(paths, ["gridManager"]);
});

test("normalizeTestRunnerArgs maps watchAll to the Node watch flag", () => {
  const { flags, paths } = normalizeTestRunnerArgs(["--watchAll", "--watch-all=on"]);

  assert.deepEqual(flags, ["--watch", "--watch"]);
  assert.deepEqual(paths, []);
});

test("expandTestTargets defaults to the repository test directory", async () => {
  const targets = await expandTestTargets();

  assert.ok(
    targets.some((entry) => entry.endsWith(path.join("test", "utils.test.js"))),
    "should include repo test files",
  );
});

test("expandTestTargets resolves directory arguments to contained test files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "run-node-tests-"));
  const customTestDir = path.join(tempDir, "custom");
  const nestedDir = path.join(customTestDir, "nested");
  const alpha = path.join(customTestDir, "alpha.test.js");
  const beta = path.join(nestedDir, "beta.test.mjs");
  const gamma = path.join(customTestDir, "gamma.helper.js");

  try {
    await mkdir(nestedDir, { recursive: true });
    await writeFile(alpha, "import test from 'node:test'; test('alpha', () => {});");
    await writeFile(beta, "import test from 'node:test'; test('beta', () => {});");
    await writeFile(gamma, "export const noop = () => {};");

    const targets = await expandTestTargets([customTestDir]);
    const expected = new Set([alpha, beta]);

    assert.strictEqual(targets.length, expected.size);
    assert.strictEqual(new Set(targets).size, expected.size);
    for (const file of targets) {
      assert.ok(expected.has(file), `unexpected target ${file}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
