import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";
import {
  resolveEventContribution,
  accumulateEventModifiers,
  EMPTY_APPLIED_EVENTS,
} from "../src/events/eventModifiers.js";

function neutralContribution() {
  return { regenMultiplier: 1, regenAdd: 0, drainAdd: 0 };
}

test("resolveEventContribution scales modifiers using cached event effects", () => {
  const effect = {
    regenScale: { base: 0.7, change: 0.4, min: 0.5 },
    regenAdd: 0.1,
    drainAdd: 0.05,
  };
  const effectCache = new Map();
  let effectCalls = 0;

  const contribution = resolveEventContribution({
    event: { eventType: "storm", strength: 0.6 },
    strengthMultiplier: 2,
    getEventEffect: (type) => {
      effectCalls += 1;
      assert.is(type, "storm");

      return effect;
    },
    effectCache,
  });

  assert.is(effectCalls, 1, "event effect should be resolved exactly once");
  assert.is(
    effectCache.get("storm"),
    effect,
    "effect cache should store resolved effect",
  );
  approxEqual(contribution.regenMultiplier, 1.18, 1e-12);
  approxEqual(contribution.regenAdd, 0.12, 1e-12);
  approxEqual(contribution.drainAdd, 0.06, 1e-12);
});

test("resolveEventContribution returns neutral modifiers for null-like inputs", () => {
  assert.equal(resolveEventContribution(), neutralContribution());
  assert.equal(
    resolveEventContribution({
      event: { eventType: "storm", strength: 0 },
      strengthMultiplier: 5,
    }),
    neutralContribution(),
    "zero-strength events should be ignored",
  );

  const cache = new Map();
  const contribution = resolveEventContribution({
    event: { eventType: "unknown", strength: 1 },
    getEventEffect: () => null,
    effectCache: cache,
  });

  assert.equal(contribution, neutralContribution());
  assert.ok(
    cache.has("unknown"),
    "null effects should still be cached to avoid repeat lookups",
  );
});

test("accumulateEventModifiers caches effects, reuses result containers, and tracks applied events", () => {
  const events = [
    { eventType: "alpha", strength: 0.5, allowedRows: [2] },
    { eventType: "skip", strength: 0.4, allowedRows: [1] },
    { eventType: "alpha", strength: 0, allowedRows: [2] },
    { eventType: "beta", strength: -0.4, allowedRows: [2] },
    { eventType: "alpha", strength: 0.25, allowedRows: [2] },
    { eventType: "gamma", strength: Number.POSITIVE_INFINITY, allowedRows: [2] },
  ];
  const effects = {
    alpha: {
      regenScale: { base: 0.9, change: 0.5, min: 0.7 },
      regenAdd: 0.2,
      drainAdd: 0.1,
    },
    beta: {
      regenScale: { base: 1, change: -0.3, min: 0.2 },
      drainAdd: 0.4,
    },
  };
  const effectCalls = [];
  const effectCache = new Map();
  const result = {
    regenMultiplier: 99,
    regenAdd: 99,
    drainAdd: 99,
    appliedEvents: [{ stale: true }],
  };

  const output = accumulateEventModifiers({
    events,
    row: 2,
    col: 3,
    eventStrengthMultiplier: 1.5,
    isEventAffecting: (event, rowIndex) => event.allowedRows?.includes(rowIndex),
    getEventEffect: (type) => {
      effectCalls.push(type);

      return effects[type] ?? null;
    },
    effectCache,
    result,
  });

  assert.is(
    output,
    result,
    "accumulateEventModifiers should reuse provided result objects",
  );
  assert.is(
    output.appliedEvents,
    result.appliedEvents,
    "appliedEvents array should be reused when mutable",
  );
  assert.equal(
    effectCalls,
    ["alpha", "beta"],
    "effect resolution should occur once per event type thanks to caching",
  );
  assert.is(effectCache.get("alpha"), effects.alpha);
  assert.is(effectCache.get("beta"), effects.beta);

  approxEqual(output.regenMultiplier, 1.63614375, 1e-12);
  approxEqual(output.regenAdd, 0.225, 1e-12);
  approxEqual(output.drainAdd, -0.1275, 1e-12);
  assert.is(
    output.appliedEvents.length,
    3,
    "only applicable events should be recorded",
  );
  const strengths = output.appliedEvents.map((entry) => entry.strength);

  approxEqual(strengths[0], 0.75, 1e-12);
  approxEqual(strengths[1], -0.6, 1e-12);
  approxEqual(strengths[2], 0.375, 1e-12);
  assert.ok(
    output.appliedEvents.every((entry) => events.includes(entry.event)),
    "applied events should reference originals",
  );
  assert.ok(
    output.appliedEvents.every((entry) =>
      Object.values(effects).includes(entry.effect),
    ),
  );
});

test("accumulateEventModifiers can skip applied event collection while sanitizing results", () => {
  const events = [{ eventType: "alpha", strength: 1 }];
  const result = {
    regenMultiplier: 5,
    regenAdd: 5,
    drainAdd: 5,
    appliedEvents: [{ stale: true }],
  };
  const output = accumulateEventModifiers({
    events,
    collectAppliedEvents: false,
    getEventEffect: () => ({ regenScale: { base: 1, change: 0.2, min: 0 } }),
    result,
  });

  assert.is(output, result);
  approxEqual(output.regenMultiplier, 1.2, 1e-12);
  approxEqual(output.regenAdd, 0, 1e-12);
  approxEqual(output.drainAdd, 0, 1e-12);
  assert.is(
    output.appliedEvents,
    EMPTY_APPLIED_EVENTS,
    "applied events should be replaced by immutable empty array",
  );
});
