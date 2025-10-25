import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const packageJsonPath = resolve(repoRoot, "package.json");
const cleanScriptPath = resolve(repoRoot, "scripts", "clean-parcel.mjs");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

const EXPECTED_SCRIPT = "node ./scripts/clean-parcel.mjs";

test("package.json clean script points to clean-parcel.mjs", () => {
  assert.equal(
    packageJson?.scripts?.clean,
    EXPECTED_SCRIPT,
    "`npm run clean` must invoke scripts/clean-parcel.mjs",
  );
});

test("clean script exists", () => {
  assert.doesNotThrow(
    () => readFileSync(cleanScriptPath),
    "clean script file should exist",
  );
});

test("clean script dry-run reports each target without deleting", () => {
  const output = execFileSync("node", [cleanScriptPath, "--dry-run"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });

  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const expectedTargets = ["dist", ".parcel-cache"];

  expectedTargets.forEach((target) => {
    const expectedMessage = `[dry-run] Would remove ${target} (${resolve(repoRoot, target)})`;

    assert.ok(
      lines.includes(expectedMessage),
      `dry-run should report ${target} removal preview`,
    );
  });

  const summary = lines.at(-1);

  assert.equal(summary, "Parcel artifacts clean script validated (dry-run).");
});
