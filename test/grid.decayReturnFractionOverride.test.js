import { assert, suite } from "#tests/harness";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const test = suite("grid decay return fraction override");

test("GridManager respects COLOURFUL_LIFE_DECAY_RETURN_FRACTION", async () => {
  const repoRoot = process.cwd();
  const gridManagerUrl = pathToFileURL(
    path.join(repoRoot, "src", "grid", "gridManager.js"),
  ).href;

  const script = `
    const { default: GridManager } = await import(${JSON.stringify(gridManagerUrl)});
    const grid = new GridManager(3, 3, { maxTileEnergy: 100 });
    for (const row of grid.energyGrid) row.fill(0);
    for (const row of grid.energyNext) row.fill(0);
    let baseline = 0;
    for (const row of grid.energyGrid) {
      for (const value of row) {
        baseline += value;
      }
    }
    const cell = { energy: 10 };
    grid.registerDeath(cell, { row: 1, col: 1 });
    let immediate = 0;
    for (const row of grid.energyGrid) {
      for (const value of row) {
        immediate += value;
      }
    }
    const reserve = grid.decayAmount?.[1]?.[1] ?? 0;
    console.log(immediate - baseline + reserve);
  `;

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["--input-type=module", "--eval", script],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        COLOURFUL_LIFE_DECAY_RETURN_FRACTION: "0.4",
      },
    },
  );

  const output = stdout.trim();
  const ansiPattern = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");
  const sanitized = output.replace(ansiPattern, "");

  assert.ok(output.length > 0, `script produced no output. stderr: ${stderr.trim()}`);

  const match = sanitized.match(/-?[0-9]+(?:\.[0-9]+)?/);

  assert.ok(
    match,
    `script should include a numeric result. stdout: ${output}, stderr: ${stderr.trim()}`,
  );

  const total = Number(match[0]);

  assert.ok(
    Math.abs(total - 4) < 1e-3,
    `Expected approximately 4 energy returned, received ${total}. stdout: ${output}, stderr: ${stderr.trim()}`,
  );
});

test.run();
