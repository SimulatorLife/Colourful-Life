import { clamp } from "./utils.js";

const EMPTY_APPLIED_EVENTS = Object.freeze([]);

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
 * @param {Map} [options.effectCache] - Optional cache reused across invocations to avoid repeated effect lookups.
 * @returns {{regenMultiplier:number, regenAdd:number, drainAdd:number, appliedEvents:Array}}
 */
export function accumulateEventModifiers({
  events,
  row,
  col,
  eventStrengthMultiplier = 1,
  isEventAffecting,
  getEventEffect,
  effectCache: sharedEffectCache,
}) {
  let regenMultiplier = 1;
  let regenAdd = 0;
  let drainAdd = 0;
  let appliedEvents = null;

  if (!Array.isArray(events) || events.length === 0) {
    return {
      regenMultiplier,
      regenAdd,
      drainAdd,
      appliedEvents: EMPTY_APPLIED_EVENTS,
    };
  }

  const eventApplies = typeof isEventAffecting === "function" ? isEventAffecting : null;
  const resolveEffect = typeof getEventEffect === "function" ? getEventEffect : null;
  // Cache event effect lookups so tiles affected by the same event type do not
  // repeatedly resolve identical configuration objects during tight update
  // loops. When a cache is provided, reuse it across invocations to avoid
  // repeatedly allocating identical maps.
  // Reuse a shared cache when callers supply one so neighbouring tiles can
  // piggyback on the same resolved effect objects during a tick.
  const reusableEffectCache =
    resolveEffect && sharedEffectCache && typeof sharedEffectCache.get === "function"
      ? sharedEffectCache
      : null;
  const effectCache = reusableEffectCache ?? (resolveEffect ? new Map() : null);
  const strengthMultiplier = Number(eventStrengthMultiplier || 1);

  for (const ev of events) {
    if (!ev) continue;
    if (eventApplies && !eventApplies(ev, row, col)) continue;

    let effect = null;

    if (resolveEffect) {
      const type = ev.eventType;

      if (effectCache) {
        if (effectCache.has(type)) {
          effect = effectCache.get(type);
        } else {
          effect = resolveEffect(type);
          effectCache.set(type, effect ?? null);
        }
      } else {
        effect = resolveEffect(type);
      }
    }

    if (!effect) continue;

    const baseStrength = Number(ev.strength || 0);
    const strength = baseStrength * strengthMultiplier;

    if (!Number.isFinite(strength) || strength === 0) continue;

    if (effect.regenScale) {
      const { base = 1, change = 0, min = 0 } = effect.regenScale;
      const scale = Math.max(min, base + change * strength);

      regenMultiplier *= scale;
    }

    const { regenAdd: effectRegenAdd, drainAdd: effectDrainAdd } = effect;

    if (typeof effectRegenAdd === "number") {
      regenAdd += effectRegenAdd * strength;
    }

    if (typeof effectDrainAdd === "number") {
      drainAdd += effectDrainAdd * strength;
    }

    (appliedEvents ??= []).push({ event: ev, effect, strength });
  }

  return {
    regenMultiplier,
    regenAdd,
    drainAdd,
    appliedEvents: appliedEvents ?? EMPTY_APPLIED_EVENTS,
  };
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

  const modifiers = accumulateEventModifiers({
    events,
    row,
    col,
    eventStrengthMultiplier,
    isEventAffecting,
    getEventEffect,
    effectCache,
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

  if (out && typeof out === "object") {
    out.nextEnergy = nextEnergy;
    out.drain = drain;
    out.appliedEvents = modifiers.appliedEvents;

    return out;
  }

  return { nextEnergy, drain, appliedEvents: modifiers.appliedEvents };
}
