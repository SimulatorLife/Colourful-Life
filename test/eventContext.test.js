import { test } from "uvu";
import * as assert from "uvu/assert";

import {
  createEventContext,
  defaultEventContext,
  defaultIsEventAffecting,
} from "../src/events/eventContext.js";

const sampleEvent = {
  type: "flood",
  affectedArea: { x: 4, y: 6, width: 3, height: 2 },
};

test("defaultIsEventAffecting applies inclusive rectangle bounds", () => {
  assert.ok(defaultIsEventAffecting(sampleEvent, 6, 4), "top-left corner included");
  assert.ok(defaultIsEventAffecting(sampleEvent, 7, 6), "interior tile included");

  assert.is(
    defaultIsEventAffecting(sampleEvent, 8, 4),
    false,
    "rows beyond height excluded",
  );
  assert.is(
    defaultIsEventAffecting(sampleEvent, 6, 7),
    false,
    "cols beyond width excluded",
  );
  assert.is(defaultIsEventAffecting(null, 6, 4), false, "missing event ignored");
  assert.is(
    defaultIsEventAffecting({ type: "flood" }, 6, 4),
    false,
    "missing area ignored",
  );
});

test("createEventContext falls back to defaults for invalid overrides", () => {
  const context = createEventContext({
    isEventAffecting: "not-a-function",
    getEventEffect: null,
  });

  assert.type(context.isEventAffecting, "function");
  assert.type(context.getEventEffect, "function");
  assert.is(context.isEventAffecting, defaultEventContext.isEventAffecting);
  assert.is(context.getEventEffect, defaultEventContext.getEventEffect);
});

test("createEventContext preserves supplied helper overrides", () => {
  const calls = [];
  const overrides = {
    isEventAffecting: (event, row, col) => {
      calls.push(["affecting", row, col]);

      return event?.type === "storm" && row === 2 && col === 3;
    },
    getEventEffect: (type) => {
      calls.push(["effect", type]);

      return type === "storm" ? { drainAdd: 0.5 } : null;
    },
  };

  const context = createEventContext(overrides);
  const matches = context.isEventAffecting({ type: "storm" }, 2, 3);
  const misses = context.isEventAffecting({ type: "storm" }, 0, 0);
  const effect = context.getEventEffect("storm");

  assert.ok(matches);
  assert.is(misses, false);
  assert.equal(effect, { drainAdd: 0.5 });
  assert.equal(calls, [
    ["affecting", 2, 3],
    ["affecting", 0, 0],
    ["effect", "storm"],
  ]);
});

// Ensure the default context remains stable for consumers reusing the exported singleton
// while still permitting per-call overrides without mutation.
test("defaultEventContext remains immutable under consumer usage", () => {
  const { isEventAffecting } = defaultEventContext;

  const before = defaultEventContext.getEventEffect("flood");
  const override = createEventContext({ isEventAffecting: () => true });

  assert.is(
    defaultEventContext.isEventAffecting,
    isEventAffecting,
    "default context function stable",
  );
  assert.equal(before, defaultEventContext.getEventEffect("flood"));
  assert.ok(
    override.isEventAffecting !== defaultEventContext.isEventAffecting,
    "override should not mutate the shared default context",
  );
});

test.run();
