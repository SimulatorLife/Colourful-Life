import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import GridManager from "../src/grid/gridManager.js";
import DNA, { GENE_LOCI } from "../src/genome.js";
import { DECAY_RETURN_FRACTION, DECAY_MAX_AGE } from "../src/config.js";
import { clamp01 } from "../src/utils/math.js";

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

function measureReturnForDNA(dna, energy = 20) {
  const grid = new GridManager(3, 3, {
    maxTileEnergy: 100,
    autoSeedEnabled: false,
  });
  const before = grid.energyGrid.map((row) => row.slice());

  grid.registerDeath({ energy, dna }, { row: 1, col: 1 });

  const after = grid.energyGrid.map((row) => row.slice());
  let immediateReturn = 0;

  for (let r = 0; r < after.length; r++) {
    for (let c = 0; c < after[r].length; c++) {
      immediateReturn += after[r][c] - before[r][c];
    }
  }

  const reserveReturn = grid.decayAmount?.[1]?.[1] ?? 0;
  const total = immediateReturn + reserveReturn;

  return energy > 0 ? total / energy : 0;
}

function createDNAWithTraits({
  density = 0,
  recovery = 0,
  efficiency = 0,
  capacity = 0,
  drought = 0,
  heat = 0,
  cold = 0,
} = {}) {
  const dna = DNA.random(() => 0.5);

  dna.genes[GENE_LOCI.DENSITY] = Math.round(clamp01(density) * 255);
  dna.genes[GENE_LOCI.RECOVERY] = Math.round(clamp01(recovery) * 255);
  dna.genes[GENE_LOCI.ENERGY_EFFICIENCY] = Math.round(clamp01(efficiency) * 255);
  dna.genes[GENE_LOCI.ENERGY_CAPACITY] = Math.round(clamp01(capacity) * 255);
  dna.genes[GENE_LOCI.RESIST_DROUGHT] = Math.round(clamp01(drought) * 255);
  dna.genes[GENE_LOCI.RESIST_HEAT] = Math.round(clamp01(heat) * 255);
  dna.genes[GENE_LOCI.RESIST_COLD] = Math.round(clamp01(cold) * 255);

  return dna;
}

test("DNA influences decay return fraction", () => {
  const lowDNA = createDNAWithTraits({
    density: 0.05,
    recovery: 0.05,
    efficiency: 0.05,
    capacity: 0.05,
    drought: 0.05,
    heat: 0.05,
    cold: 0.05,
  });
  const highDNA = createDNAWithTraits({
    density: 0.95,
    recovery: 0.95,
    efficiency: 0.95,
    capacity: 0.95,
    drought: 0.95,
    heat: 0.95,
    cold: 0.95,
  });

  const lowFraction = measureReturnForDNA(lowDNA);
  const highFraction = measureReturnForDNA(highDNA);

  assert.ok(
    highFraction > lowFraction + 0.05,
    `Expected high-trait DNA to return more energy (${highFraction}) than low-trait DNA (${lowFraction}).`,
  );
  assert.ok(
    highFraction <= 0.985,
    `DNA-derived decay return should stay below 0.985, received ${highFraction}.`,
  );
  assert.ok(
    lowFraction >= Math.max(0.05, DECAY_RETURN_FRACTION * 0.25),
    `DNA-derived decay return should not collapse excessively, received ${lowFraction}.`,
  );
});

test("DNA influences decay persistence duration", () => {
  const lowDNA = DNA.random(() => 0.5);
  const highDNA = DNA.random(() => 0.5);

  lowDNA.genes[GENE_LOCI.DENSITY] = Math.round(clamp01(0.05) * 255);
  lowDNA.genes[GENE_LOCI.RECOVERY] = Math.round(clamp01(0.05) * 255);
  lowDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = Math.round(clamp01(0.1) * 255);
  lowDNA.genes[GENE_LOCI.ENERGY_CAPACITY] = Math.round(clamp01(0.1) * 255);
  lowDNA.genes[GENE_LOCI.SENESCENCE] = Math.round(clamp01(0.05) * 255);
  lowDNA.genes[GENE_LOCI.COOPERATION] = Math.round(clamp01(0.05) * 255);
  lowDNA.genes[GENE_LOCI.RISK] = Math.round(clamp01(0.9) * 255);
  lowDNA.genes[GENE_LOCI.EXPLORATION] = Math.round(clamp01(0.8) * 255);
  lowDNA.genes[GENE_LOCI.MOVEMENT] = Math.round(clamp01(0.85) * 255);

  highDNA.genes[GENE_LOCI.DENSITY] = Math.round(clamp01(0.95) * 255);
  highDNA.genes[GENE_LOCI.RECOVERY] = Math.round(clamp01(0.95) * 255);
  highDNA.genes[GENE_LOCI.ENERGY_EFFICIENCY] = Math.round(clamp01(0.9) * 255);
  highDNA.genes[GENE_LOCI.ENERGY_CAPACITY] = Math.round(clamp01(0.9) * 255);
  highDNA.genes[GENE_LOCI.SENESCENCE] = Math.round(clamp01(0.9) * 255);
  highDNA.genes[GENE_LOCI.COOPERATION] = Math.round(clamp01(0.8) * 255);
  highDNA.genes[GENE_LOCI.RISK] = Math.round(clamp01(0.1) * 255);
  highDNA.genes[GENE_LOCI.EXPLORATION] = Math.round(clamp01(0.1) * 255);
  highDNA.genes[GENE_LOCI.MOVEMENT] = Math.round(clamp01(0.15) * 255);

  const baseAge = DECAY_MAX_AGE;
  const shortTicks = lowDNA.decayPersistenceTicks(baseAge);
  const longTicks = highDNA.decayPersistenceTicks(baseAge);

  assert.ok(
    longTicks > shortTicks + 20,
    `Expected higher-structure DNA to persist longer (${longTicks}) than the fragile genome (${shortTicks}).`,
  );

  const lowGrid = new GridManager(3, 3, {
    maxTileEnergy: 50,
  });

  lowGrid.registerDeath({ energy: 12, dna: lowDNA }, { row: 1, col: 1 });

  const lowPersistence = lowGrid.decayPersistence?.[1]?.[1];

  assert.ok(
    Number.isFinite(lowPersistence) && lowPersistence < baseAge,
    `Expected low-persistence DNA to shorten corpse lifespan below ${baseAge}, received ${lowPersistence}.`,
  );

  const highGrid = new GridManager(3, 3, {
    maxTileEnergy: 50,
  });

  highGrid.registerDeath({ energy: 12, dna: highDNA }, { row: 1, col: 1 });

  const highPersistence = highGrid.decayPersistence?.[1]?.[1];

  assert.ok(
    Number.isFinite(highPersistence) && highPersistence > baseAge,
    `Expected high-persistence DNA to extend corpse lifespan beyond ${baseAge}, received ${highPersistence}.`,
  );

  assert.ok(
    highPersistence > lowPersistence + 40,
    `Expected a noticeable gap between high (${highPersistence}) and low (${lowPersistence}) persistence values.`,
  );

  const blendedGrid = new GridManager(3, 3, {
    maxTileEnergy: 50,
  });

  blendedGrid.registerDeath({ energy: 18, dna: highDNA }, { row: 1, col: 1 });
  const persistenceAfterHigh = blendedGrid.decayPersistence?.[1]?.[1];

  blendedGrid.registerDeath({ energy: 6, dna: lowDNA }, { row: 1, col: 1 });
  const blendedPersistence = blendedGrid.decayPersistence?.[1]?.[1];

  assert.ok(
    blendedPersistence < persistenceAfterHigh && blendedPersistence > lowPersistence,
    `Expected blended persistence ${blendedPersistence} to fall between ${lowPersistence} and ${persistenceAfterHigh}.`,
  );
});
