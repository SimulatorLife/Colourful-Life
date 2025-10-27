import { isArrayLike } from "../utils/collections.js";

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
  activeTraitIndexes = null,
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

  let indexesSource = null;

  if (Array.isArray(activeTraitIndexes) || ArrayBuffer.isView(activeTraitIndexes)) {
    indexesSource = activeTraitIndexes;
  }

  const traitIndexes =
    indexesSource && indexesSource.length > 0
      ? Array.from({ length: indexesSource.length }, (_, i) => indexesSource[i]).filter(
          (traitIndex) =>
            traitIndex != null && traitIndex >= 0 && traitIndex < traitCount,
        )
      : Array.from({ length: traitCount }, (_, i) => i);

  let population = 0;

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const cell = resolveCellFromSource(sources[sourceIndex]);

    if (!cell || typeof cell !== "object") {
      continue;
    }

    population += 1;

    for (const traitIndex of traitIndexes) {
      const compute = computeFns[traitIndex];

      if (typeof compute !== "function") {
        continue;
      }

      let value = compute(cell);

      if (!value) {
        value = 0;
      }

      sums[traitIndex] += value;

      if (value >= thresholds[traitIndex]) {
        activeCounts[traitIndex] += 1;
      }
    }
  }

  return population;
}
