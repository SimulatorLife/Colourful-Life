import { clamp } from './utils.js';

function resolveNeighborAverage({ neighborSum, neighborCount, neighborEnergies }) {
  if (Number.isFinite(neighborSum) && Number.isFinite(neighborCount) && neighborCount > 0) {
    return neighborSum / neighborCount;
  }

  if (!Array.isArray(neighborEnergies) || neighborEnergies.length === 0) {
    return null;
  }

  let sum = 0;

  for (let i = 0; i < neighborEnergies.length; i++) {
    sum += neighborEnergies[i] || 0;
  }

  return sum / neighborEnergies.length;
}

/**
 * Aggregates all event-driven modifiers for a given tile.
 *
 * @param {Object} options
 * @param {Array} options.events - List of active events to consider.
 * @param {number} options.row - Tile row coordinate.
 * @param {number} options.col - Tile column coordinate.
 * @param {number} [options.eventStrengthMultiplier=1] - Global multiplier applied to each event strength.
 * @param {Function} options.isEventAffecting - Predicate that determines if an event affects the tile.
 * @param {Function} options.getEventEffect - Retrieves the effect configuration for an event type.
 * @returns {{regenMultiplier:number, regenAdd:number, drainAdd:number, appliedEvents:Array}}
 */
export function accumulateEventModifiers({
  events,
  row,
  col,
  eventStrengthMultiplier = 1,
  isEventAffecting,
  getEventEffect,
}) {
  const result = {
    regenMultiplier: 1,
    regenAdd: 0,
    drainAdd: 0,
    appliedEvents: [],
  };

  if (!Array.isArray(events) || events.length === 0) {
    return result;
  }

  for (const ev of events) {
    if (!ev) continue;
    if (typeof isEventAffecting === 'function' && !isEventAffecting(ev, row, col)) continue;

    const effect = typeof getEventEffect === 'function' ? getEventEffect(ev.eventType) : null;

    if (!effect) continue;

    const strength = (ev.strength || 0) * (eventStrengthMultiplier || 1);

    if (!Number.isFinite(strength) || strength === 0) continue;

    if (effect.regenScale) {
      const { base = 1, change = 0, min = 0 } = effect.regenScale;
      const scale = Math.max(min, base + change * strength);

      result.regenMultiplier *= scale;
    }

    if (typeof effect.regenAdd === 'number') {
      result.regenAdd += effect.regenAdd * strength;
    }

    if (typeof effect.drainAdd === 'number') {
      result.drainAdd += effect.drainAdd * strength;
    }

    result.appliedEvents.push({ event: ev, effect, strength });
  }

  return result;
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
 * @returns {{nextEnergy:number, drain:number, appliedEvents:Array}}
 */
export function computeTileEnergyUpdate({
  currentEnergy,
  density = 0,
  neighborEnergies = [],
  neighborSum,
  neighborCount,
  events = [],
  row,
  col,
  config,
}) {
  const {
    maxTileEnergy,
    regenRate,
    diffusionRate,
    densityEffectMultiplier = 1,
    regenDensityPenalty = 0,
    eventStrengthMultiplier = 1,
    isEventAffecting,
    getEventEffect,
  } = config || {};

  if (!Number.isFinite(maxTileEnergy)) {
    throw new Error('maxTileEnergy must be provided to computeTileEnergyUpdate');
  }

  const energy = Number.isFinite(currentEnergy) ? currentEnergy : 0;
  const effectiveDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
  let regen = (regenRate ?? 0) * (1 - energy / maxTileEnergy);

  regen *= Math.max(0, 1 - (regenDensityPenalty ?? 0) * effectiveDensity);

  const modifiers = accumulateEventModifiers({
    events,
    row,
    col,
    eventStrengthMultiplier,
    isEventAffecting,
    getEventEffect,
  });

  regen *= modifiers.regenMultiplier;
  regen += modifiers.regenAdd;

  const drain = modifiers.drainAdd;

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

  return { nextEnergy, drain, appliedEvents: modifiers.appliedEvents };
}
