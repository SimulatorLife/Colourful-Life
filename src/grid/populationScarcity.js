import { clamp, clampFinite } from "../utils/math.js";
import { warnOnce } from "../utils/error.js";
import { computeBehaviorComplementarity } from "./behaviorComplementarity.js";

function resolveDrive(
  cell,
  partner,
  scarcity,
  baseProbability,
  population,
  minPopulation,
) {
  if (!cell) return 1;

  const context = {
    scarcity,
    baseProbability,
    partner,
    population,
    minPopulation,
  };

  if (typeof cell.populationScarcityDrive === "function") {
    try {
      const drive = cell.populationScarcityDrive(context);

      return Number.isFinite(drive) ? drive : 1;
    } catch (error) {
      warnOnce("Cell population scarcity drive threw.", error);
    }
  }

  return 1;
}

export function resolvePopulationScarcityMultiplier({
  parentA,
  parentB,
  scarcity,
  baseProbability,
  population,
  minPopulation,
} = {}) {
  const scarcitySignal = clampFinite(scarcity, 0, 1, 0);

  if (scarcitySignal <= 0) {
    return { multiplier: 1, drives: [1, 1] };
  }

  const baseProb = clampFinite(baseProbability, 0, 1, 0.5);
  const popCount = Math.max(0, Number.isFinite(population) ? population : 0);
  const minPop =
    Number.isFinite(minPopulation) && minPopulation > 0 ? minPopulation : 0;
  const scarcityDeficit =
    minPop > 0 ? clamp((minPop - popCount) / minPop, 0, 1) : scarcitySignal;

  const driveA = resolveDrive(
    parentA,
    parentB,
    scarcitySignal,
    baseProb,
    popCount,
    minPop,
  );
  const driveB = resolveDrive(
    parentB,
    parentA,
    scarcitySignal,
    baseProb,
    popCount,
    minPop,
  );
  const averageDrive = clamp(((driveA || 1) + (driveB || 1)) / 2, 0.3, 2);
  const complementStrength = clamp(
    computeBehaviorComplementarity(parentA, parentB),
    0,
    1,
  );
  const complementLift =
    scarcitySignal > 0
      ? 1 + scarcitySignal * (0.45 + scarcityDeficit * 0.65 + complementStrength * 1.4)
      : 1;

  const scarcityLift =
    1 + scarcitySignal * (0.9 + (1 - baseProb) * 1.2 + scarcityDeficit * 1.1);
  const maxBoost = 1 + scarcitySignal * (6 + complementStrength * 3);
  const multiplier = clamp(
    averageDrive * scarcityLift * complementLift,
    1 - scarcitySignal * 0.35,
    maxBoost,
  );

  return { multiplier, drives: [driveA, driveB] };
}
