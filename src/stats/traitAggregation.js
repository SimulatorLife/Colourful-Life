import { isArrayLike } from "../utils/collections.js";

const hasOwn = Object.hasOwn;
const traitIndexScratch = [];

function resolveCellFromSource(source) {
  if (!source || typeof source !== "object") {
    return source;
  }

  if (hasOwn(source, "cell")) {
    return source.cell;
  }

  return source;
}

function sanitizeTraitIndexes(indexesSource, traitCount, computeFns) {
  traitIndexScratch.length = 0;

  if (!indexesSource || indexesSource.length === 0) {
    return traitIndexScratch;
  }

  for (const candidate of indexesSource) {
    if (candidate == null) {
      continue;
    }

    const numeric = Number(candidate);

    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
      continue;
    }

    const index = numeric;

    if (index < 0 || index >= traitCount) {
      continue;
    }

    if (typeof computeFns[index] !== "function") {
      continue;
    }

    traitIndexScratch.push(index);
  }

  return traitIndexScratch;
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

  let traitIndexes = traitIndexScratch;
  let useFilteredIndexes = false;

  if (indexesSource && indexesSource.length > 0) {
    traitIndexes = sanitizeTraitIndexes(indexesSource, traitCount, computeFns);
    useFilteredIndexes = traitIndexes.length > 0;

    if (!useFilteredIndexes) {
      return 0;
    }
  }

  let population = 0;

  for (const source of sources) {
    const cell = resolveCellFromSource(source);

    if (!cell || typeof cell !== "object") {
      continue;
    }

    population += 1;

    if (useFilteredIndexes) {
      for (const traitIndex of traitIndexes) {
        const compute = computeFns[traitIndex];

        let value = compute(cell);

        if (!Number.isFinite(value)) {
          value = 0;
        }

        sums[traitIndex] += value;

        const threshold = thresholds[traitIndex];

        if (value >= threshold) {
          activeCounts[traitIndex] += 1;
        }
      }

      continue;
    }

    for (let traitIndex = 0; traitIndex < traitCount; traitIndex += 1) {
      const compute = computeFns[traitIndex];

      if (typeof compute !== "function") {
        continue;
      }

      let value = compute(cell);

      if (!Number.isFinite(value)) {
        value = 0;
      }

      sums[traitIndex] += value;

      const threshold = thresholds[traitIndex];

      if (value >= threshold) {
        activeCounts[traitIndex] += 1;
      }
    }
  }

  return population;
}
