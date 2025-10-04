import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const helperPath = join(__dirname, "helpers", "measure-decay-return-fraction.mjs");

function runHelper(decayFraction) {
  const result = spawnSync(process.execPath, [helperPath, "10"], {
    env: {
      ...process.env,
      COLOURFUL_LIFE_DECAY_RETURN_FRACTION: String(decayFraction),
    },
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  assert.strictEqual(
    result.status,
    0,
    `Helper exited with ${result.status}: ${result.stderr || result.stdout}`,
  );

  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    throw new Error(`Failed to parse helper output: ${result.stdout}`, {
      cause: error,
    });
  }
}

test("GridManager honors decay return fraction configuration", () => {
  const override = 0.25;
  const { returnFraction } = runHelper(override);

  assert.ok(
    Number.isFinite(returnFraction),
    `Expected finite fraction, received ${returnFraction}`,
  );

  assert.ok(
    Math.abs(returnFraction - override) < 1e-6,
    `Expected return fraction ${override}, received ${returnFraction}`,
  );
});
