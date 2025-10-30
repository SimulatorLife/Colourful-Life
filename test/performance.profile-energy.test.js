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
  PERF_SIM_ROWS: "10",
  PERF_SIM_COLS: "10",
  PERF_SIM_WARMUP: "5",
  PERF_SIM_ITERATIONS: "8",
  PERF_SIM_UPS: "45",
  PERF_SIM_CELL_SIZE: "4",
  PERF_SIM_DENSITY: "0.45",
  PERF_SIM_SEED: "4242",
  PERF_INCLUDE_SIM: "1",
};

test("energy profiling benchmark emits deterministic metrics when requested", async () => {
  const child = spawn(process.execPath, [benchmarkPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...BENCHMARK_ENV,
      PERF_TEST_SCENARIO: "deterministic",
      PERF_TEST_ENERGY_DURATION_MS: "321.5",
      PERF_TEST_ENERGY_MS_PER_TICK: "10.5",
      PERF_TEST_TOTAL_RUNTIME_MS: "400.25",
      PERF_TEST_SIM_DURATION_MS: "512.75",
      PERF_TEST_SIM_EXECUTED_TICKS: "8",
      PERF_TEST_SIM_MS_PER_TICK: "12.75",
      PERF_TEST_SIM_RAW_MS_PER_TICK: "13",
      PERF_TEST_SIM_TARGET_POPULATION: "144",
      PERF_TEST_SIM_SEEDED_POPULATION: "140",
      PERF_TEST_SIM_FINAL_POPULATION: "132",
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
  assert.equal(metrics.msPerTick, 10.5);
  assert.equal(metrics.durationMs, 321.5);
  assert.equal(metrics.totalRuntimeMs, 400.25);

  const simulation = metrics.simulationBenchmark;

  assert.ok(
    simulation && typeof simulation === "object",
    "simulationBenchmark payload should be present",
  );

  assert.strictEqual(simulation.executedTicks, 8);
  assert.strictEqual(simulation.durationMs, 512.75);
  assert.strictEqual(simulation.msPerTick, 12.75);
  assert.strictEqual(simulation.rawMsPerTick, 13);

  assert.ok(
    Number.isFinite(simulation.msPerTick),
    "simulation msPerTick should be numeric",
  );

  assert.strictEqual(simulation.seedingSummary.targetPopulation, 144);
  assert.strictEqual(simulation.seedingSummary.seededPopulation, 140);

  const seeding = simulation.seedingSummary;

  assert.ok(
    seeding && typeof seeding === "object",
    "seeding summary should be included for simulation benchmark",
  );

  assert.strictEqual(seeding.seededPopulation, 140);
  assert.strictEqual(simulation.finalPopulation, 132);
});

test("energy profiling benchmark skips simulation unless requested", async () => {
  const child = spawn(process.execPath, [benchmarkPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PERF_ROWS: "10",
      PERF_COLS: "10",
      PERF_ITERATIONS: "5",
      PERF_WARMUP: "2",
      PERF_CELL_SIZE: "3",
      PERF_SEED: "2024",
      PERF_INCLUDE_SIM: "0",
      PERF_TEST_SCENARIO: "deterministic",
      PERF_TEST_ENERGY_DURATION_MS: "12.5",
      PERF_TEST_ENERGY_MS_PER_TICK: "2.5",
      PERF_TEST_TOTAL_RUNTIME_MS: "20.5",
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

  assert.equal(result.signal, null);
  assert.equal(result.code, 0);
  assert.equal(stderr.trim(), "");

  const outputText = stdout.trim();

  assert.notEqual(
    outputText.length,
    0,
    "benchmark should emit output when skipping simulation",
  );

  let metrics;

  try {
    metrics = JSON.parse(outputText);
  } catch (error) {
    assert.fail(`failed to parse benchmark output as JSON: ${error.message}`);
  }

  assert.equal(typeof metrics, "object");
  assert.ok(Number.isFinite(metrics.msPerTick));
  assert.equal(metrics.msPerTick, 2.5);
  assert.equal(metrics.durationMs, 12.5);
  assert.equal(metrics.totalRuntimeMs, 20.5);
  assert.strictEqual(
    metrics.simulationBenchmark,
    undefined,
    "simulationBenchmark should be omitted when PERF_INCLUDE_SIM is disabled",
  );
});
