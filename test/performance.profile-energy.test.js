import { test } from "node:test";
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const benchmarkPath = resolve(repoRoot, "scripts", "profile-energy.mjs");

const BENCHMARK_ENV = {
  PERF_ROWS: "24",
  PERF_COLS: "24",
  PERF_WARMUP: "5",
  PERF_ITERATIONS: "30",
  PERF_CELL_SIZE: "4",
};

test("energy profiling benchmark exits successfully", async () => {
  const child = spawn(process.execPath, [benchmarkPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...BENCHMARK_ENV,
    },
    stdio: "pipe",
  });

  const result = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });

  assert.equal(
    result.signal,
    null,
    `benchmark should not be terminated by a signal (received ${result.signal})`,
  );
  assert.equal(
    result.code,
    0,
    `benchmark should exit cleanly with code 0 (received ${result.code})`,
  );
});
