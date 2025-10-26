import { performance } from "node:perf_hooks";
import { test, assert } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";
import { summarizeMateDiversityOpportunity } from "../src/grid/diversityOpportunity.js";
import { clamp } from "../src/utils.js";

function legacySummarize({
  candidates = [],
  chosenDiversity = 0,
  diversityThreshold = 0,
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const count = list.length;
  const threshold = clamp(
    Number.isFinite(diversityThreshold) ? diversityThreshold : 0,
    0,
    1,
  );
  const chosen = clamp(Number.isFinite(chosenDiversity) ? chosenDiversity : 0, 0, 1);

  if (count <= 1) {
    return {
      score: 0,
      availability: 0,
      weight: 0,
      gap: 0,
    };
  }

  const values = list
    .map((entry) => {
      const raw = entry?.diversity;

      return clamp(Number.isFinite(raw) ? raw : 0, 0, 1);
    })
    .sort((a, b) => b - a);

  const best = values[0] ?? 0;
  const sampleCount = Math.min(values.length, 5);
  const topAverage =
    sampleCount > 0
      ? values.slice(0, sampleCount).reduce((sum, value) => sum + value, 0) /
        sampleCount
      : 0;
  const aboveThresholdCount =
    threshold > 0 ? values.filter((value) => value >= threshold).length : values.length;
  const availableAbove = Math.max(
    0,
    aboveThresholdCount - (chosen >= threshold ? 1 : 0),
  );
  const availability = clamp(count > 0 ? availableAbove / count : 0, 0, 1);
  const depth = aboveThresholdCount > 0 ? clamp(aboveThresholdCount / 4, 0, 1) : 0;
  const gap = clamp(topAverage - chosen, 0, 1);
  const headroom = clamp(best - threshold, 0, 1);

  let score = gap * (0.5 + availability * 0.3 + depth * 0.2);

  if (chosen < threshold) {
    score += availability * (0.25 + depth * 0.3);
    score += headroom * 0.2;
  } else {
    score += headroom * 0.1;
  }

  score = clamp(score, 0, 1);

  const weight = clamp(
    availability * 0.65 + depth * 0.25 + (gap > 0.2 ? 0.1 : 0),
    0,
    1,
  );

  return {
    score,
    availability,
    weight,
    gap,
  };
}

function createDeterministicPool(size) {
  const results = new Array(size);
  let seed = 982451653;

  for (let i = 0; i < size; i += 1) {
    seed = (seed * 16807) % 2147483647;
    const value = (seed % 10000) / 10000;

    results[i] = { diversity: value };
  }

  return results;
}

test("summarizeMateDiversityOpportunity matches legacy results", () => {
  const pool = createDeterministicPool(2000);
  const options = {
    candidates: pool,
    chosenDiversity: 0.37,
    diversityThreshold: 0.61,
  };

  const legacy = legacySummarize(options);
  const optimized = summarizeMateDiversityOpportunity(options);

  approxEqual(optimized.score, legacy.score, 1e-12, "score should match legacy math");
  approxEqual(
    optimized.availability,
    legacy.availability,
    1e-12,
    "availability should match legacy math",
  );
  approxEqual(
    optimized.weight,
    legacy.weight,
    1e-12,
    "weight should match legacy math",
  );
  approxEqual(optimized.gap, legacy.gap, 1e-12, "gap should match legacy math");
});

test("optimized diversity opportunity summary avoids repeated sorts", () => {
  const pool = createDeterministicPool(15000);
  const options = {
    candidates: pool,
    chosenDiversity: 0.45,
    diversityThreshold: 0.55,
  };
  const iterations = 200;

  // Warm-up both implementations to reduce one-off initialization cost.
  legacySummarize(options);
  summarizeMateDiversityOpportunity(options);

  const legacyStart = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    legacySummarize(options);
  }

  const legacyElapsed = performance.now() - legacyStart;
  const optimizedStart = performance.now();

  for (let i = 0; i < iterations; i += 1) {
    summarizeMateDiversityOpportunity(options);
  }

  const optimizedElapsed = performance.now() - optimizedStart;

  assert.ok(
    optimizedElapsed <= legacyElapsed * 0.6,
    `Expected optimized path (${optimizedElapsed.toFixed(3)}ms) to be at least 40% faster than legacy (${legacyElapsed.toFixed(3)}ms)`,
  );
});
