const EMPTY_APPLIED_EVENTS = Object.freeze([]);
const DEFAULT_EVENT_MODIFIERS = Object.freeze({
  regenMultiplier: 1,
  regenAdd: 0,
  drainAdd: 0,
  appliedEvents: EMPTY_APPLIED_EVENTS,
});

function prepareEffectCache(resolveEffect, sharedEffectCache) {
  if (!resolveEffect) return null;

  const cacheIsReusable =
    sharedEffectCache &&
    typeof sharedEffectCache.get === "function" &&
    typeof sharedEffectCache.set === "function";

  return cacheIsReusable ? sharedEffectCache : new Map();
}

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

export function resolveEventContribution({
  event,
  strengthMultiplier = 1,
  getEventEffect,
  effectCache: externalEffectCache,
} = {}) {
  if (!event) {
    return { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };
  }

  const baseStrength = Number(event?.strength ?? 0);

  if (!Number.isFinite(baseStrength) || baseStrength === 0) {
    return { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };
  }

  const numericMultiplier = Number(strengthMultiplier);
  const multiplier = Number.isFinite(numericMultiplier) ? numericMultiplier : 1;
  const strength = baseStrength * multiplier;

  if (!Number.isFinite(strength) || strength === 0) {
    return { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };
  }

  const resolveEffect = typeof getEventEffect === "function" ? getEventEffect : null;
  const effectCache = prepareEffectCache(resolveEffect, externalEffectCache);
  const effect = resolveEffect
    ? lookupEventEffect(event.eventType, resolveEffect, effectCache)
    : null;

  if (!effect) {
    return { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };
  }

  const { regenScale, regenAdd: effectRegenAdd, drainAdd: effectDrainAdd } = effect;

  let regenMultiplier = 1;
  let regenAdd = 0;
  let drainAdd = 0;

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

  return { regenMultiplier, regenAdd, drainAdd };
}

export function accumulateEventModifiers({
  events,
  row,
  col,
  eventStrengthMultiplier = 1,
  isEventAffecting,
  getEventEffect,
  effectCache: externalEffectCache,
  collectAppliedEvents = true,
  result: providedResult,
} = {}) {
  const shouldCollect = collectAppliedEvents !== false;
  const providedEvents = Array.isArray(events) ? events : [];

  let regenMultiplier = 1;
  let regenAdd = 0;
  let drainAdd = 0;
  let appliedEvents = shouldCollect ? null : EMPTY_APPLIED_EVENTS;

  if (providedEvents.length === 0) {
    if (providedResult && typeof providedResult === "object") {
      providedResult.regenMultiplier = 1;
      providedResult.regenAdd = 0;
      providedResult.drainAdd = 0;
      providedResult.appliedEvents = shouldCollect
        ? (providedResult.appliedEvents ?? [])
        : EMPTY_APPLIED_EVENTS;

      if (shouldCollect && providedResult.appliedEvents.length > 0) {
        providedResult.appliedEvents.length = 0;
      }

      return providedResult;
    }

    return DEFAULT_EVENT_MODIFIERS;
  }

  const eventApplies = typeof isEventAffecting === "function" ? isEventAffecting : null;
  const resolveEffect = typeof getEventEffect === "function" ? getEventEffect : null;
  const effectCache = prepareEffectCache(resolveEffect, externalEffectCache);
  const numericStrengthMultiplier = Number(eventStrengthMultiplier);
  const strengthMultiplier = Number.isFinite(numericStrengthMultiplier)
    ? numericStrengthMultiplier
    : 1;

  for (const eventInstance of providedEvents) {
    if (!eventInstance) continue;
    if (eventApplies && !eventApplies(eventInstance, row, col)) continue;

    const baseStrength = Number(eventInstance?.strength ?? 0);

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

export { DEFAULT_EVENT_MODIFIERS, EMPTY_APPLIED_EVENTS };
