import { COMBAT_EDGE_SHARPNESS_DEFAULT, SIMULATION_DEFAULTS } from "../config.js";

// UI defaults and slider bounds derived from canonical simulation defaults.
export const UI_SLIDER_CONFIG = Object.freeze({
  societySimilarity: {
    default: SIMULATION_DEFAULTS.societySimilarity,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  enemySimilarity: {
    default: SIMULATION_DEFAULTS.enemySimilarity,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  eventStrengthMultiplier: {
    default: SIMULATION_DEFAULTS.eventStrengthMultiplier,
    min: 0,
    max: 3,
    step: 0.05,
    floor: 0,
  },
  eventFrequencyMultiplier: {
    default: SIMULATION_DEFAULTS.eventFrequencyMultiplier,
    min: 0,
    max: 3,
    step: 0.1,
    floor: 0,
  },
  speedMultiplier: {
    default: SIMULATION_DEFAULTS.speedMultiplier,
    min: 0.5,
    max: 100,
    step: 0.5,
    floor: 0.1,
  },
  densityEffectMultiplier: {
    default: SIMULATION_DEFAULTS.densityEffectMultiplier,
    min: 0,
    max: 2,
    step: 0.05,
    floor: 0,
  },
  mutationMultiplier: {
    default: SIMULATION_DEFAULTS.mutationMultiplier,
    min: 0,
    max: 3,
    step: 0.05,
    floor: 0,
  },
  matingDiversityThreshold: {
    default: SIMULATION_DEFAULTS.matingDiversityThreshold,
    min: 0,
    max: 1,
    step: 0.01,
    floor: 0,
  },
  lowDiversityReproMultiplier: {
    default: SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
    min: 0,
    max: 1,
    step: 0.05,
    floor: 0,
  },
  combatEdgeSharpness: {
    default: COMBAT_EDGE_SHARPNESS_DEFAULT,
    min: 0.5,
    max: 6,
    step: 0.1,
    floor: 0.1,
  },
  energyRegenRate: {
    min: 0,
    max: 0.2,
    step: 0.005,
    floor: 0,
  },
  energyDiffusionRate: {
    min: 0,
    max: 0.5,
    step: 0.01,
    floor: 0,
  },
  leaderboardIntervalMs: {
    default: SIMULATION_DEFAULTS.leaderboardIntervalMs,
    min: 100,
    max: 3000,
    step: 50,
    floor: 0,
  },
});
