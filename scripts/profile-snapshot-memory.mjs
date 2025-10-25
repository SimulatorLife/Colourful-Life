import GridManager from "../src/grid/gridManager.js";

const ROWS = 40;
const COLS = 40;
const ITERATIONS = 200;

function createStubCell(seed) {
  return {
    energy: 5 + (seed % 7),
    age: seed % 12,
    offspring: seed % 3,
    fightsWon: seed % 4,
    fightsLost: seed % 2,
    color: `#${((seed * 9301 + 49297) % 0xffffff).toString(16).padStart(6, "0")}`,
    dna: {
      reproductionProb() {
        return 0.4;
      },
      toColor() {
        return this.color ?? "#fff";
      },
    },
    similarity() {
      return 0.5;
    },
  };
}

function fillGrid(gridManager) {
  let seed = 1;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = createStubCell(seed++);

      cell.row = row;
      cell.col = col;
      gridManager.grid[row][col] = cell;
    }
  }
  gridManager.rebuildActiveCells();
}

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

async function main() {
  const originalInit = GridManager.prototype.init;

  GridManager.prototype.init = function noop() {};

  try {
    const gm = new GridManager(ROWS, COLS, {
      eventManager: { activeEvents: [] },
      ctx: null,
      cellSize: 1,
      stats: { onBirth() {}, onDeath() {}, onFight() {}, onCooperate() {} },
    });

    fillGrid(gm);

    forceGc();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < ITERATIONS; i += 1) {
      gm.buildSnapshot(10);
    }

    forceGc();
    const after = process.memoryUsage().heapUsed;

    const deltaBytes = after - before;
    const toMiB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

    console.log(
      JSON.stringify(
        {
          rows: ROWS,
          cols: COLS,
          iterations: ITERATIONS,
          beforeHeapMiB: Number(toMiB(before)),
          afterHeapMiB: Number(toMiB(after)),
          deltaHeapMiB: Number(toMiB(deltaBytes)),
        },
        null,
        2,
      ),
    );
  } finally {
    GridManager.prototype.init = originalInit;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
