import { clamp } from "./utils.js";

const EMPTY_APPLIED_EVENTS = Object.freeze([]);
// Used when no events apply so downstream calculations always receive a
// consistent modifier object. Keeping it frozen avoids accidental mutation in
// tight loops that reuse the baseline reference.
const DEFAULT_EVENT_MODIFIERS = Object.freeze({
  regenMultiplier: 1,
  regenAdd: 0,
  drainAdd: 0,
  appliedEvents: EMPTY_APPLIED_EVENTS,
});

/**
 * Returns a cache suitable for storing resolved event effects. When callers
 * supply a shared cache, reuse it so neighbouring tiles piggyback on identical
 * effect lookups during a tick. Otherwise fall back to a fresh in-memory map.
 */
function prepareEffectCache(resolveEffect, sharedEffectCache) {
  if (!resolveEffect) return null;

  const cacheIsReusable =
    sharedEffectCache &&
    typeof sharedEffectCache.get === "function" &&
    typeof sharedEffectCache.set === "function";

  return cacheIsReusable ? sharedEffectCache : new Map();
}

/**
 * Retrieves the event effect configuration, caching results to avoid repeated
 * resolution work for identical event types within the same update cycle.
 */
function lookupEventEffect(eventType, resolveEffect, effectCache) {
  if (!resolveEffect) return null;

  if (!effectCache) {
    return resolveEffect(eventType);
  }

  const cached = effectCache.get(eventType);

  if (cached !== undefined) {
    return cached;
  }

  const resolved = resolveEffect(eventType) ?? null;

  effectCache.set(eventType, resolved);

  return resolved;
}

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
  effectCache: externalEffectCache,
  result: providedResult,
  collectAppliedEvents = true,
} = {}) {
  const shouldCollect = collectAppliedEvents !== false;
  let regenMultiplier = 1;
  let regenAdd = 0;
  let drainAdd = 0;
  let appliedEvents = null;

  if (!Array.isArray(events) || events.length === 0) {
    if (providedResult && typeof providedResult === "object") {
      providedResult.regenMultiplier = 1;
      providedResult.regenAdd = 0;
      providedResult.drainAdd = 0;
      if (shouldCollect) {
        if (Array.isArray(providedResult.appliedEvents)) {
          providedResult.appliedEvents.length = 0;
        } else {
          providedResult.appliedEvents = [];
        }
      } else {
        providedResult.appliedEvents = EMPTY_APPLIED_EVENTS;
      }

      return providedResult;
    }

    return {
      regenMultiplier,
      regenAdd,
      drainAdd,
      appliedEvents: shouldCollect ? EMPTY_APPLIED_EVENTS : EMPTY_APPLIED_EVENTS,
    };
  }

  const eventApplies = typeof isEventAffecting === "function" ? isEventAffecting : null;
  const resolveEffect = typeof getEventEffect === "function" ? getEventEffect : null;
  const effectCache = prepareEffectCache(resolveEffect, externalEffectCache);
  const numericStrengthMultiplier = Number(eventStrengthMultiplier);
  const strengthMultiplier = Number.isFinite(numericStrengthMultiplier)
    ? numericStrengthMultiplier
    : 1;

  for (const eventInstance of events) {
    if (!eventInstance) continue;
    if (eventApplies && !eventApplies(eventInstance, row, col)) continue;

    const baseStrength = Number(eventInstance?.strength ?? 0);

    // Guard common zero-strength events before resolving their effect configs.
    // This avoids repeated cache lookups and map churn in dense event fields
    // where only a minority of events actually contribute energy modifiers.
    if (!Number.isFinite(baseStrength) || baseStrength === 0) {
      continue;
    }

    const strength = baseStrength * strengthMultiplier;

    if (!Number.isFinite(strength) || strength === 0) {
      continue;
    }

    const eventEffect = lookupEventEffect(
      eventInstance.eventType,
      resolveEffect,
      effectCache,
    );

    if (!eventEffect) continue;

    const {
      regenScale,
      regenAdd: effectRegenAdd,
      drainAdd: effectDrainAdd,
    } = eventEffect;

    if (regenScale) {
      const { base = 1, change = 0, min = 0 } = regenScale;
      const scale = Math.max(min, base + change * strength);

      regenMultiplier *= scale;
    }

    if (typeof effectRegenAdd === "number") {
      regenAdd += effectRegenAdd * strength;
    }

    if (typeof effectDrainAdd === "number") {
      drainAdd += effectDrainAdd * strength;
    }

    if (shouldCollect) {
      (appliedEvents ??= []).push({
        event: eventInstance,
        effect: eventEffect,
        strength,
      });
    }
  }

  if (providedResult && typeof providedResult === "object") {
    providedResult.regenMultiplier = regenMultiplier;
    providedResult.regenAdd = regenAdd;
    providedResult.drainAdd = drainAdd;

    if (shouldCollect) {
      const existingApplied = providedResult.appliedEvents;
      const targetEvents =
        Array.isArray(existingApplied) && !Object.isFrozen(existingApplied)
          ? existingApplied
          : (providedResult.appliedEvents = []);

      targetEvents.length = 0;

      if (appliedEvents) {
        targetEvents.push(...appliedEvents);
      }
    } else {
      providedResult.appliedEvents = EMPTY_APPLIED_EVENTS;
    }

    return providedResult;
  }

  return {
    regenMultiplier,
    regenAdd,
    drainAdd,
    appliedEvents: shouldCollect
      ? (appliedEvents ?? EMPTY_APPLIED_EVENTS)
      : EMPTY_APPLIED_EVENTS,
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
