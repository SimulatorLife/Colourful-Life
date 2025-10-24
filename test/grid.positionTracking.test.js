import { assert, test } from "#tests/harness";
import SimulationEngine from "../src/simulationEngine.js";
import DNA from "../src/genome.js";
import { createRNG } from "../src/utils.js";
import { MockCanvas } from "./helpers/simulationEngine.js";

const createCanvasStub = (width, height) => new MockCanvas(width, height);

function populateHighDensityGrid(engine, { density, rng }) {
  const { grid } = engine;
  const rows = grid.rows;
  const cols = grid.cols;
  const targetPopulation = Math.min(
    rows * cols,
    Math.max(1, Math.round(rows * cols * density)),
  );
  const coordinates = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (grid.isObstacle?.(row, col)) continue;
      coordinates.push([row, col]);
    }
  }

  for (let index = coordinates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    const temp = coordinates[index];

    coordinates[index] = coordinates[swapIndex];
    coordinates[swapIndex] = temp;
  }

  let seeded = 0;
  const maxEnergy = Number.isFinite(grid.maxTileEnergy)
    ? grid.maxTileEnergy
    : grid.constructor.maxTileEnergy;
  const spawnEnergy = maxEnergy * 0.6;

  for (let i = 0; i < coordinates.length && seeded < targetPopulation; i += 1) {
    const [row, col] = coordinates[i];

    if (!grid.energyGrid?.[row]) continue;

    grid.energyGrid[row][col] = maxEnergy;
    const dna = DNA.random(rng);
    const spawned = grid.spawnCell(row, col, { dna, spawnEnergy, recordBirth: true });

    if (spawned) seeded += 1;
  }

  grid.rebuildActiveCells?.();

  return { targetPopulation, seededPopulation: seeded };
}

test("grid retains tracked cell positions during dense headless runs", () => {
  const configuration = {
    rows: 14,
    cols: 14,
    cellSize: 4,
    updatesPerSecond: 45,
  };
  const warmupTicks = 5;
  const simulationTicks = 8;
  const density = 0.45;
  const seed = 4242;

  const canvas = createCanvasStub(
    configuration.cols * configuration.cellSize,
    configuration.rows * configuration.cellSize,
  );
  const engineRng = createRNG(seed);

  const engine = new SimulationEngine({
    canvas,
    autoStart: false,
    config: {
      ...configuration,
      initialObstaclePreset: "none",
      randomizeInitialObstacles: false,
      showObstacles: false,
      showDensity: false,
      showEnergy: false,
      showFitness: false,
    },
    rng: engineRng,
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    performanceNow: () => 0,
  });

  const seedingRng = createRNG(seed + 1);
  const seedingSummary = populateHighDensityGrid(engine, { density, rng: seedingRng });

  assert.is(
    seedingSummary.seededPopulation,
    seedingSummary.targetPopulation,
    "high-density seeding should fill the grid",
  );

  const updatesPerSecond = Math.max(
    1,
    engine.state?.updatesPerSecond ?? configuration.updatesPerSecond,
  );
  const intervalMs = 1000 / updatesPerSecond;
  const tickStep = intervalMs + 0.01;
  let timestamp = 0;

  const advance = () => {
    timestamp += tickStep;
    engine.tick(timestamp);
  };

  for (let i = 0; i < warmupTicks; i += 1) advance();

  const initialMismatches = engine.grid.cellPositionTelemetry?.mismatches ?? 0;

  for (let i = 0; i < simulationTicks; i += 1) advance();

  const telemetry = engine.grid.cellPositionTelemetry ?? { mismatches: 0 };
  const newMismatches = telemetry.mismatches - initialMismatches;

  assert.is(
    newMismatches,
    0,
    "grid should not record cell position mismatches during the run",
  );
});
