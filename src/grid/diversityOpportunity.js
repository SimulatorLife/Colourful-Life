import { clamp } from "../utils/math.js";

const SAMPLE_LIMIT = 5;

function rememberTopValue(values, candidate) {
  if (values.length < SAMPLE_LIMIT || candidate > values[values.length - 1]) {
    values.push(candidate);
    values.sort((a, b) => b - a);

    if (values.length > SAMPLE_LIMIT) {
      values.length = SAMPLE_LIMIT;
    }
  }

  return values;
}

function normalizeCandidateValue(candidate) {
  const raw = candidate?.diversity;
  const value = Number.isFinite(raw) ? raw : 0;

  return clamp(value, 0, 1);
}

export function summarizeMateDiversityOpportunity({
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

  const { best, aboveThresholdCount, topValues } = list.reduce(
    (acc, candidate) => {
      const value = normalizeCandidateValue(candidate);

      if (value > acc.best) {
        acc.best = value;
      }

      if (value >= threshold) {
        acc.aboveThresholdCount += 1;
      }

      rememberTopValue(acc.topValues, value);

      return acc;
    },
    { best: 0, aboveThresholdCount: 0, topValues: [] },
  );

  const sampleCount = Math.min(topValues.length, SAMPLE_LIMIT, count);
  let topAverage = 0;

  if (sampleCount > 0) {
    topAverage = topValues.reduce((total, value) => total + value, 0) / sampleCount;
  }

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
