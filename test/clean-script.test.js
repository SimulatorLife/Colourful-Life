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

test("clean script dry-run executes successfully", () => {
  assert.doesNotThrow(() => {
    execFileSync("node", [cleanScriptPath, "--dry-run"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
  }, "clean script dry-run should execute without errors");
});
