import GridManager from "../../src/grid/gridManager.js";

const energy = Number(process.argv[2] ?? 12);

const grid = new GridManager(3, 3, {
  maxTileEnergy: 100,
  autoSeedEnabled: false,
});

const snapshotBefore = grid.energyGrid.map((row) => row.slice());

grid.registerDeath({ energy }, { row: 1, col: 1 });

const snapshotAfter = grid.energyGrid.map((row) => row.slice());

let immediateReturn = 0;

for (let r = 0; r < snapshotAfter.length; r++) {
  for (let c = 0; c < snapshotAfter[r].length; c++) {
    immediateReturn += snapshotAfter[r][c] - snapshotBefore[r][c];
  }
}

const reserveReturn = grid.decayAmount?.[1]?.[1] ?? 0;
const totalReturned = immediateReturn + reserveReturn;
const fraction = energy > 0 ? totalReturned / energy : 0;

process.stdout.write(
  JSON.stringify({
    energy,
    immediateReturn,
    reserveReturn,
    totalReturned,
    returnFraction: fraction,
  }) + "\n",
);
