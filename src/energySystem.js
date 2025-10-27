import { clamp } from "./utils/math.js";
import {
  accumulateEventModifiers,
  DEFAULT_EVENT_MODIFIERS,
} from "./events/eventModifiers.js";

/**
 * Resolves the average energy of neighboring tiles using whichever aggregate
 * data the caller already computed. When `neighborSum`/`neighborCount` are
 * available they take precedence to avoid re-iterating the array. If that
 * aggregate data is missing or invalid, the helper falls back to iterating the
 * provided `neighborEnergies` list. Returning `null` signals the caller that no
 * neighbors contributed usable energy data, which is distinct from a numeric
 * average of zero.
 *
 * @param {Object} options
 * @param {number} [options.neighborSum] - Precomputed sum of neighbor
 *   energies.
 * @param {number} [options.neighborCount] - Precomputed count of contributing
 *   neighbors used with `neighborSum`.
 * @param {Array<number>} [options.neighborEnergies] - Individual neighbor
 *   energy samples when aggregate values are unavailable.
 * @returns {number|null} Arithmetic mean of neighbor energies when available;
 *   otherwise `null`.
 */
function resolveNeighborAverage({ neighborSum, neighborCount, neighborEnergies }) {
  if (
    Number.isFinite(neighborSum) &&
    Number.isFinite(neighborCount) &&
    neighborCount > 0
  ) {
    return neighborSum / neighborCount;
  }

  if (!Array.isArray(neighborEnergies) || neighborEnergies.length === 0) {
    return null;
  }

  const sum = neighborEnergies.reduce((total, value) => total + (value || 0), 0);

  return sum / neighborEnergies.length;
}

/**
 * Computes the next energy value for a tile given its surroundings and events.
 *
 * @param {Object} options
 * @param {number} options.currentEnergy - Current tile energy value.
 * @param {number} [options.density=0] - Local density used for regeneration penalties.
 * @param {Array<number>} [options.neighborEnergies=[]] - Energies of neighbouring tiles.
 * @param {number} [options.neighborSum] - Sum of neighbouring tile energies when precomputed.
 * @param {number} [options.neighborCount] - Count of neighbours included in neighborSum.
 * @param {Array} [options.events=[]] - List of active events.
 * @param {number} options.row - Tile row coordinate.
 * @param {number} options.col - Tile column coordinate.
 * @param {Object} options.config - Configuration values.
 * @param {number} options.config.maxTileEnergy - Maximum permitted energy per tile.
 * @param {number} options.config.regenRate - Base regeneration rate.
 * @param {number} options.config.diffusionRate - Diffusion rate towards neighbours.
 * @param {number} [options.config.densityEffectMultiplier=1] - Scales density effects.
 * @param {number} [options.config.regenDensityPenalty=0] - Strength of density-based regen penalty.
 * @param {number} [options.config.eventStrengthMultiplier=1] - Global event strength multiplier.
 * @param {Function} options.config.isEventAffecting - Predicate to determine if an event affects the tile.
 * @param {Function} options.config.getEventEffect - Retrieves effect configuration for an event.
 * @param {Map} [options.config.effectCache] - Cache reused across tiles for resolved event effects.
 * @param {{nextEnergy:number, drain:number, appliedEvents:Array}|undefined} [out]
 *   Optional result object to populate, allowing callers to reuse allocations in
 *   tight loops. When omitted, a fresh object is returned.
 * @returns {{nextEnergy:number, drain:number, appliedEvents:Array}}
 */
export function computeTileEnergyUpdate(
  {
    currentEnergy,
    density = 0,
    neighborEnergies = [],
    neighborSum,
    neighborCount,
    events = [],
    row,
    col,
    config,
  },
  out,
) {
  const {
    maxTileEnergy,
    regenRate,
    diffusionRate,
    densityEffectMultiplier = 1,
    regenDensityPenalty = 0,
    eventStrengthMultiplier = 1,
    isEventAffecting,
    getEventEffect,
    effectCache,
  } = config || {};

  if (!Number.isFinite(maxTileEnergy)) {
    throw new Error("maxTileEnergy must be provided to computeTileEnergyUpdate");
  }

  const energy = Number.isFinite(currentEnergy) ? currentEnergy : 0;
  const effectiveDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
  let regen = (regenRate ?? 0) * (1 - energy / maxTileEnergy);

  regen *= Math.max(0, 1 - (regenDensityPenalty ?? 0) * effectiveDensity);

  const eventModifiers =
    Array.isArray(events) && events.length > 0
      ? accumulateEventModifiers({
          events,
          row,
          col,
          eventStrengthMultiplier,
          isEventAffecting,
          getEventEffect,
          effectCache,
        })
      : DEFAULT_EVENT_MODIFIERS;

  regen *= eventModifiers.regenMultiplier;
  regen += eventModifiers.regenAdd;

  const drain = eventModifiers.drainAdd;

  const neighborAverage = resolveNeighborAverage({
    neighborSum,
    neighborCount,
    neighborEnergies,
  });

  let diffusion = 0;

  if (neighborAverage != null) {
    diffusion = (diffusionRate ?? 0) * (neighborAverage - energy);
  }

  let nextEnergy = energy + regen - drain + diffusion;

  nextEnergy = clamp(nextEnergy, 0, maxTileEnergy);

  if (out && typeof out === "object") {
    out.nextEnergy = nextEnergy;
    out.drain = drain;
    out.appliedEvents = eventModifiers.appliedEvents;

    return out;
  }

  return { nextEnergy, drain, appliedEvents: eventModifiers.appliedEvents };
}
