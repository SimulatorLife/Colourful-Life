import { clamp, clampFinite } from "../utils/math.js";
import { MATE_DIVERSITY_SAMPLE_LIMIT_DEFAULT } from "../config.js";

const SAMPLE_LIMIT = MATE_DIVERSITY_SAMPLE_LIMIT_DEFAULT;

function rememberTopValue(values, candidate) {
  // Maintain `values` in descending order while returning the contribution that
  // should be applied to the running sum of the tracked samples. Avoiding
  // `Array.prototype.sort()` keeps the helper O(k) for the tiny `SAMPLE_LIMIT`
  // window instead of repeatedly performing O(k log k) work.
  const limit = SAMPLE_LIMIT;
  const length = values.length;

  if (length === 0) {
    values.push(candidate);

    return candidate;
  }

  const effectiveLength = Math.min(length, limit);
  const tailIndex = effectiveLength - 1;

  if (length >= limit && candidate <= values[tailIndex]) {
    return 0;
  }

  let insertIndex = tailIndex;

  while (insertIndex >= 0 && values[insertIndex] < candidate) {
    insertIndex -= 1;
  }

  const targetIndex = insertIndex + 1;

  if (length < limit) {
    values.push(candidate);

    for (let i = values.length - 1; i > targetIndex; i -= 1) {
      values[i] = values[i - 1];
    }

    values[targetIndex] = candidate;

    return candidate;
  }

  const displaced = values[tailIndex];

  for (let i = tailIndex; i > targetIndex; i -= 1) {
    values[i] = values[i - 1];
  }

  values[targetIndex] = candidate;

  return candidate - displaced;
}

function normalizeCandidateValue(candidate) {
  const raw = candidate?.diversity;

  return clampFinite(raw, 0, 1, 0);
}

export function summarizeMateDiversityOpportunity({
  candidates = [],
  chosenDiversity = 0,
  diversityThreshold = 0,
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const count = list.length;
  const threshold = clampFinite(diversityThreshold, 0, 1, 0);
  const chosen = clampFinite(chosenDiversity, 0, 1, 0);

  if (count <= 1) {
    return {
      score: 0,
      availability: 0,
      weight: 0,
      gap: 0,
    };
  }

  let best = 0;
  let aboveThresholdCount = 0;
  const topValues = [];
  let topSum = 0;

  for (let index = 0; index < count; index += 1) {
    const value = normalizeCandidateValue(list[index]);

    if (value > best) {
      best = value;
    }

    if (value >= threshold) {
      aboveThresholdCount += 1;
    }

    topSum += rememberTopValue(topValues, value);
  }

  const sampleCount = topValues.length;
  const topAverage = sampleCount > 0 ? topSum / sampleCount : 0;

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

export default summarizeMateDiversityOpportunity;
