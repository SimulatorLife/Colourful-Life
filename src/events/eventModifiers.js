import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

const EMPTY_APPLIED_EVENTS = Object.freeze([]);

const WARNINGS = Object.freeze({
  resolveEffect: "Custom event effect resolver threw; ignoring event effect.",
  isEventAffecting:
    "Custom event predicate threw; treating event as not affecting the tile.",
});

const NEUTRAL_EVENT_MODIFIER_VALUES = Object.freeze({
  regenMultiplier: 1,
  regenAdd: 0,
  drainAdd: 0,
});

const DEFAULT_EVENT_MODIFIERS = Object.freeze({
  ...NEUTRAL_EVENT_MODIFIER_VALUES,
  appliedEvents: EMPTY_APPLIED_EVENTS,
});

function createNeutralEventModifiers() {
  return { ...NEUTRAL_EVENT_MODIFIER_VALUES };
}

function resetEventModifiers(target) {
  if (!target || typeof target !== "object") {
    return createNeutralEventModifiers();
  }

  target.regenMultiplier = NEUTRAL_EVENT_MODIFIER_VALUES.regenMultiplier;
  target.regenAdd = NEUTRAL_EVENT_MODIFIER_VALUES.regenAdd;
  target.drainAdd = NEUTRAL_EVENT_MODIFIER_VALUES.drainAdd;

  return target;
}

function normalizeEventStrength(value) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric !== 0 ? numeric : null;
}

function prepareAppliedEventsCollection(existing) {
  if (Array.isArray(existing) && !Object.isFrozen(existing)) {
    existing.length = 0;

    return existing;
  }

  return [];
}

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

  if (effectCache) {
    const cached = effectCache.get(eventType);

    if (cached !== undefined) {
      return cached;
    }
  }

  let failed = false;
  const resolved = invokeWithErrorBoundary(resolveEffect, [eventType], {
    reporter: warnOnce,
    once: true,
    message: WARNINGS.resolveEffect,
    onError: () => {
      failed = true;
    },
  });

  const normalized = failed ? null : (resolved ?? null);

  if (effectCache) {
    effectCache.set(eventType, normalized);
  }

  return normalized;
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
    return createNeutralEventModifiers();
  }

  const baseStrength = normalizeEventStrength(event?.strength);

  if (baseStrength == null) {
    return createNeutralEventModifiers();
  }

  const numericMultiplier = Number(strengthMultiplier);
  const multiplier = Number.isFinite(numericMultiplier) ? numericMultiplier : 1;
  const strength = normalizeEventStrength(baseStrength * multiplier);

  if (strength == null) {
    return createNeutralEventModifiers();
  }

  const resolveEffect = typeof getEventEffect === "function" ? getEventEffect : null;
  const effectCache = prepareEffectCache(resolveEffect, externalEffectCache);
  const effect = resolveEffect
    ? lookupEventEffect(event.eventType, resolveEffect, effectCache)
    : null;

  if (!effect) {
    return createNeutralEventModifiers();
  }

  const modifiers = createNeutralEventModifiers();

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
      resetEventModifiers(providedResult);
      providedResult.appliedEvents = shouldCollect
        ? prepareAppliedEventsCollection(providedResult.appliedEvents)
        : EMPTY_APPLIED_EVENTS;

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

  const modifiers = resetEventModifiers(
    providedResult && typeof providedResult === "object" ? providedResult : undefined,
  );

  for (const eventInstance of providedEvents) {
    if (!eventInstance) continue;
    if (eventApplies) {
      let predicateFailed = false;
      const applies = invokeWithErrorBoundary(eventApplies, [eventInstance, row, col], {
        reporter: warnOnce,
        once: true,
        message: WARNINGS.isEventAffecting,
        onError: () => {
          predicateFailed = true;
        },
      });

      if (predicateFailed) {
        continue;
      }

      if (!applies) {
        continue;
      }
    }

    const baseStrength = normalizeEventStrength(eventInstance?.strength);

    if (baseStrength == null) {
      continue;
    }

    const strength = normalizeEventStrength(baseStrength * strengthMultiplier);

    if (strength == null) {
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
      const targetEvents = prepareAppliedEventsCollection(providedResult.appliedEvents);

      providedResult.appliedEvents = targetEvents;

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
