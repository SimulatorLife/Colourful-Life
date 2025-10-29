import { clamp, clampFinite } from "../utils/math.js";
import { MATE_DIVERSITY_SAMPLE_LIMIT_DEFAULT } from "../config.js";

const SAMPLE_LIMIT = MATE_DIVERSITY_SAMPLE_LIMIT_DEFAULT;
const COMPLEMENT_BASELINE = 0.35;

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
    values.splice(targetIndex, 0, candidate);

    return candidate;
  }

  const displaced = values[tailIndex];

  values.splice(targetIndex, 0, candidate);

  if (values.length > limit) {
    values.length = limit;
  }

  return candidate - displaced;
}

function normalizeCandidateValue(candidate) {
  const raw = candidate?.diversity;

  return clampFinite(raw, 0, 1, 0);
}

function normalizeComplementValue(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return 0;
  }

  if (Number.isFinite(candidate.behaviorComplementarityOpportunity)) {
    return clampFinite(candidate.behaviorComplementarityOpportunity, 0, 1, 0);
  }

  if (Number.isFinite(candidate.behaviorComplementarity)) {
    return clampFinite(candidate.behaviorComplementarity, 0, 1, 0);
  }

  if (Number.isFinite(candidate.complementarity)) {
    return clampFinite(candidate.complementarity, 0, 1, 0);
  }

  return 0;
}

export function summarizeMateDiversityOpportunity({
  candidates = [],
  chosenDiversity = 0,
  chosenComplementarity = 0,
  diversityThreshold = 0,
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const count = list.length;
  const threshold = clampFinite(diversityThreshold, 0, 1, 0);
  const chosen = clampFinite(chosenDiversity, 0, 1, 0);
  const chosenComplement = clampFinite(chosenComplementarity, 0, 1, 0);

  if (count <= 1) {
    return {
      score: 0,
      availability: 0,
      weight: 0,
      gap: 0,
      complementScore: 0,
      complementAvailability: 0,
      complementWeight: 0,
      complementGap: 0,
      complementAlignment: 0,
    };
  }

  const {
    best,
    bestComplement,
    aboveThresholdCount,
    complementAboveBaseline,
    topValues,
    topComplementValues,
    topSum,
    topComplementSum,
  } = list.reduce(
    (accumulator, candidate) => {
      const value = normalizeCandidateValue(candidate);
      const complementValue = normalizeComplementValue(candidate);

      if (value > accumulator.best) {
        accumulator.best = value;
      }

      if (value >= threshold) {
        accumulator.aboveThresholdCount += 1;
      }

      accumulator.topSum += rememberTopValue(accumulator.topValues, value);

      if (complementValue > accumulator.bestComplement) {
        accumulator.bestComplement = complementValue;
      }

      if (complementValue >= COMPLEMENT_BASELINE) {
        accumulator.complementAboveBaseline += 1;
      }

      if (complementValue > 0) {
        accumulator.topComplementSum += rememberTopValue(
          accumulator.topComplementValues,
          complementValue,
        );
      }

      return accumulator;
    },
    {
      best: 0,
      bestComplement: 0,
      aboveThresholdCount: 0,
      complementAboveBaseline: 0,
      topValues: [],
      topComplementValues: [],
      topSum: 0,
      topComplementSum: 0,
    },
  );

  const sampleCount = topValues.length;
  const topAverage = sampleCount > 0 ? topSum / sampleCount : 0;
  const complementSampleCount = topComplementValues.length;
  const complementTopAverage =
    complementSampleCount > 0 ? topComplementSum / complementSampleCount : 0;

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

  const chosenAboveBaseline = chosenComplement >= COMPLEMENT_BASELINE ? 1 : 0;
  const complementAvailableAbove = Math.max(
    0,
    complementAboveBaseline - chosenAboveBaseline,
  );
  const complementAvailability = clamp(
    count > 0 ? complementAvailableAbove / count : 0,
    0,
    1,
  );
  const complementDepth =
    complementAboveBaseline > 0 ? clamp(complementAboveBaseline / 4, 0, 1) : 0;
  const complementGap = clamp(complementTopAverage - chosenComplement, 0, 1);
  const complementHeadroom = clamp(bestComplement - chosenComplement, 0, 1);
  let complementScore =
    complementGap * (0.4 + complementAvailability * 0.35 + complementDepth * 0.25);

  if (chosenComplement < COMPLEMENT_BASELINE) {
    complementScore += complementAvailability * 0.2;
  }

  complementScore += complementHeadroom * 0.15;
  complementScore = clamp(complementScore, 0, 1);

  const complementSignal =
    complementScore > 0 ||
    complementAvailability > 0 ||
    complementGap > 0 ||
    complementHeadroom > 0;

  if (complementSignal) {
    const diversityBoost = clamp(score * complementAvailability * 0.15, 0, 0.3);
    const complementBlend = clamp(
      complementScore * (0.35 + availability * 0.2 + complementDepth * 0.15),
      0,
      0.9,
    );

    score = clamp(score + diversityBoost + complementBlend, 0, 1);
  }

  let weight = clamp(availability * 0.65 + depth * 0.25 + (gap > 0.2 ? 0.1 : 0), 0, 1);

  if (complementSignal) {
    weight = clamp(
      weight +
        complementAvailability * 0.25 +
        complementDepth * 0.15 +
        (complementGap > 0.2 ? 0.1 : 0),
      0,
      1,
    );
  }

  const complementWeight = clamp(
    complementAvailability * 0.65 +
      complementDepth * 0.25 +
      (complementGap > 0.2 ? 0.1 : 0),
    0,
    1,
  );
  const complementAlignment =
    complementAvailability > 0 ? clamp(1 - complementGap, 0, 1) : 0;

  return {
    score,
    availability,
    weight,
    gap,
    complementScore,
    complementAvailability,
    complementWeight,
    complementGap,
    complementAlignment,
  };
}

export default summarizeMateDiversityOpportunity;
