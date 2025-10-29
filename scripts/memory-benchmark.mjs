import Cell from "../src/cell.js";
import DNA from "../src/genome.js";
import { MAX_TILE_ENERGY } from "../src/config.js";

function createCell() {
  const dna = DNA.random();

  return new Cell(0, 0, dna, MAX_TILE_ENERGY * 0.6);
}

function measure(iterations = 2000) {
  const cell = createCell();
  const partner = createCell();
  const context = {
    localDensity: 0.32,
    densityEffectMultiplier: 1,
    baseProbability: 0.45,
    maxTileEnergy: MAX_TILE_ENERGY,
    tileEnergy: 0.58,
    tileEnergyDelta: -0.02,
  };

  if (typeof global.gc === "function") {
    global.gc();
  }

  const before = process.memoryUsage().heapUsed;

  for (let i = 0; i < iterations; i++) {
    cell.decideReproduction(partner, context);
    cell.manageEnergy(0, 0, {
      localDensity: context.localDensity,
      densityEffectMultiplier: context.densityEffectMultiplier,
      maxTileEnergy: context.maxTileEnergy,
      scarcityRelief: 1,
    });
  }

  if (typeof global.gc === "function") {
    global.gc();
  }

  const after = process.memoryUsage().heapUsed;

  return { before, after, delta: after - before };
}

const iterations = Number.parseInt(process.argv[2] ?? "2000", 10) || 2000;
const { before, after, delta } = measure(iterations);

console.log(JSON.stringify({ iterations, before, after, delta }));
