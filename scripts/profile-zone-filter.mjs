import SelectionManager from "../src/grid/selectionManager.js";
import ReproductionZonePolicy from "../src/grid/reproductionZonePolicy.js";
import { invokeWithErrorBoundary, warnOnce } from "../src/utils/error.js";

const WARNINGS = {
  membership:
    "Selection manager threw while evaluating spawn candidate zone membership.",
};

function buildCandidates(count, rows, cols) {
  const list = new Array(count);

  for (let i = 0; i < count; i += 1) {
    list[i] = { r: i % rows, c: (i * 7) % cols };
  }

  return list;
}

function runBenchmark({
  rows = 120,
  cols = 120,
  candidates = 5000,
  iterations = 200,
} = {}) {
  const manager = new SelectionManager(rows, cols);

  manager.togglePattern("alternatingBands", true);

  const policy = new ReproductionZonePolicy({ selectionManager: manager });
  const candidateList = buildCandidates(candidates, rows, cols);

  const oldFilter = (list) => {
    if (!Array.isArray(list) || list.length === 0) {
      return list;
    }

    const mgr = policy.getSelectionManager();

    if (!mgr || !policy.hasActiveZones()) {
      return list;
    }

    const tester = mgr.isInActiveZone;

    if (typeof tester !== "function") {
      return list;
    }

    let encounteredError = false;

    const filtered = list.filter(({ r, c }) => {
      const result = invokeWithErrorBoundary(tester, [r, c], {
        thisArg: mgr,
        message: WARNINGS.membership,
        reporter: warnOnce,
        once: true,
        onError: () => {
          encounteredError = true;
        },
      });

      return Boolean(result);
    });

    if (encounteredError) {
      return list;
    }

    return filtered.length > 0 ? filtered : list;
  };

  const newFilter = (list) => policy.filterSpawnCandidates(list);

  const warmup = 20;

  for (let i = 0; i < warmup; i += 1) {
    oldFilter(candidateList);
    newFilter(candidateList);
  }

  const measure = (fn) => {
    const { performance } = globalThis;
    const start = performance.now();
    let total = 0;

    for (let i = 0; i < iterations; i += 1) {
      total += fn(candidateList).length;
    }

    return { duration: performance.now() - start, total };
  };

  return {
    rows,
    cols,
    candidateCount: candidateList.length,
    iterations,
    baseline: measure(oldFilter),
    optimized: measure(newFilter),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = runBenchmark();

  console.log(JSON.stringify(result, null, 2));
}

export { runBenchmark };
