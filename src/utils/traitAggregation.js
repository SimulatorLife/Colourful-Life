import { isArrayLike } from "./collections.js";

const hasOwn = Object.hasOwn;

function resolveCellFromSource(source) {
  if (!source || typeof source !== "object") {
    return source;
  }

  if (hasOwn(source, "cell")) {
    return source.cell;
  }

  return source;
}

export function accumulateTraitAggregates(
  pool,
  traitComputes,
  traitThresholds,
  traitSums,
  traitActiveCounts,
) {
  const sources = Array.isArray(pool) ? pool : [];
  const computeFns = Array.isArray(traitComputes) ? traitComputes : [];
  const thresholds = isArrayLike(traitThresholds) ? traitThresholds : [];
  const sums = isArrayLike(traitSums) ? traitSums : [];
  const activeCounts = isArrayLike(traitActiveCounts) ? traitActiveCounts : [];

  if (
    computeFns.length === 0 ||
    thresholds.length === 0 ||
    sums.length === 0 ||
    activeCounts.length === 0
  ) {
    return 0;
  }

  const traitCount = Math.min(
    computeFns.length,
    thresholds.length,
    sums.length,
    activeCounts.length,
  );

  if (sources.length === 0 || traitCount === 0) {
    return 0;
  }

  const activeTraitIndexes = [];

  for (let traitIndex = 0; traitIndex < traitCount; traitIndex += 1) {
    if (typeof computeFns[traitIndex] === "function") {
      activeTraitIndexes.push(traitIndex);
    }
  }

  return sources.reduce((population, candidate) => {
    const cell = resolveCellFromSource(candidate);

    if (!cell || typeof cell !== "object") {
      return population;
    }

    for (const traitIndex of activeTraitIndexes) {
      const compute = computeFns[traitIndex];
      let value = compute(cell);

      if (!value) {
        value = 0;
      }

      sums[traitIndex] += value;

      if (value >= thresholds[traitIndex]) {
        activeCounts[traitIndex] += 1;
      }
    }

    return population + 1;
  }, 0);
}
