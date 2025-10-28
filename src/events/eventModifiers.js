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

function applyEventEffectModifiers(target, effect, strength) {
  if (!effect) {
    return target;
  }

  const { regenScale, regenAdd: effectRegenAdd, drainAdd: effectDrainAdd } = effect;

  if (regenScale) {
    const { base = 1, change = 0, min = 0 } = regenScale;
    const scale = Math.max(min, base + change * strength);

    target.regenMultiplier *= scale;
  }

  if (typeof effectRegenAdd === "number") {
    target.regenAdd += effectRegenAdd * strength;
  }

  if (typeof effectDrainAdd === "number") {
    target.drainAdd += effectDrainAdd * strength;
  }

  return target;
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

  const modifiers = { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };

  applyEventEffectModifiers(modifiers, effect, strength);

  return modifiers;
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

  const modifiers =
    providedResult && typeof providedResult === "object"
      ? providedResult
      : { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };

  modifiers.regenMultiplier = 1;
  modifiers.regenAdd = 0;
  modifiers.drainAdd = 0;

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

    applyEventEffectModifiers(modifiers, eventEffect, strength);

    if (shouldCollect) {
      (appliedEvents ??= []).push({
        event: eventInstance,
        effect: eventEffect,
        strength,
      });
    }
  }

  if (providedResult && typeof providedResult === "object") {
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

  modifiers.appliedEvents = shouldCollect
    ? (appliedEvents ?? EMPTY_APPLIED_EVENTS)
    : EMPTY_APPLIED_EVENTS;

  return modifiers;
}

export { DEFAULT_EVENT_MODIFIERS, EMPTY_APPLIED_EVENTS };
