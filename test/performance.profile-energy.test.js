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
  PERF_SEED: "1337",
  PERF_SIM_ROWS: "14",
  PERF_SIM_COLS: "14",
  PERF_SIM_WARMUP: "5",
  PERF_SIM_ITERATIONS: "8",
  PERF_SIM_UPS: "45",
  PERF_SIM_CELL_SIZE: "4",
  PERF_SIM_DENSITY: "0.45",
  PERF_SIM_SEED: "4242",
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

  let stdout = "";
  let stderr = "";

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const result = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
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

  assert.equal(
    stderr.trim(),
    "",
    `benchmark should not emit stderr output (received ${stderr.trim()})`,
  );

  const outputText = stdout.trim();

  assert.notEqual(outputText.length, 0, "benchmark should emit JSON metrics on stdout");

  let metrics;

  try {
    metrics = JSON.parse(outputText);
  } catch (error) {
    assert.fail(`failed to parse benchmark output as JSON: ${error.message}`);
  }

  assert.equal(typeof metrics, "object");
  assert.ok(Number.isFinite(metrics.msPerTick), "energy msPerTick should be numeric");
  assert.ok(
    metrics.msPerTick < 5,
    `energy preparation msPerTick should stay under 5ms (received ${metrics.msPerTick.toFixed?.(3) ?? metrics.msPerTick})`,
  );

  const simulation = metrics.simulationBenchmark;

  assert.ok(
    simulation && typeof simulation === "object",
    "simulationBenchmark payload should be present",
  );

  assert.strictEqual(
    simulation.executedTicks,
    simulation.iterations,
    `simulation executed ${simulation.executedTicks} ticks but ${simulation.iterations} were requested`,
  );

  assert.ok(
    Number.isFinite(simulation.msPerTick),
    "simulation msPerTick should be numeric",
  );

  assert.ok(
    simulation.msPerTick < 120,
    `simulation msPerTick should stay under 120ms (received ${simulation.msPerTick.toFixed?.(3) ?? simulation.msPerTick})`,
  );

  const seeding = simulation.seedingSummary;

  assert.ok(
    seeding && typeof seeding === "object",
    "seeding summary should be included for simulation benchmark",
  );

  assert.strictEqual(
    seeding.seededPopulation,
    seeding.targetPopulation,
    `high-population seeding failed (${seeding.seededPopulation}/${seeding.targetPopulation})`,
  );

  assert.ok(
    simulation.finalPopulation > 0,
    "simulation should preserve a non-zero population during the benchmark",
  );
});
