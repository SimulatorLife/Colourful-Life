import { test } from "uvu";
import * as assert from "uvu/assert";

import {
  EVENT_EFFECTS,
  EVENT_TYPES,
  getEventEffect,
} from "../src/events/eventEffects.js";

test("event effect descriptors expose consistent structure and tuning", () => {
  const expected = {
    flood: {
      regenAdd: 0.25,
      regenScale: null,
      drainAdd: 0,
      cell: { energyLoss: 0.3, resistanceGene: "floodResist" },
    },
    drought: {
      regenAdd: 0,
      regenScale: { base: 1, change: -0.7, min: 0 },
      drainAdd: 0.1,
      cell: { energyLoss: 0.25, resistanceGene: "droughtResist" },
    },
    heatwave: {
      regenAdd: 0,
      regenScale: { base: 1, change: -0.45, min: 0 },
      drainAdd: 0.08,
      cell: { energyLoss: 0.35, resistanceGene: "heatResist" },
    },
    coldwave: {
      regenAdd: 0,
      regenScale: { base: 1, change: -0.25, min: 0 },
      drainAdd: 0,
      cell: { energyLoss: 0.2, resistanceGene: "coldResist" },
    },
  };

  assert.equal(EVENT_EFFECTS, expected);
  Object.entries(EVENT_EFFECTS).forEach(([event, effect]) => {
    assert.ok(effect.cell, `${event} defines a per-cell configuration`);
    assert.type(effect.cell.energyLoss, "number");
    assert.type(effect.cell.resistanceGene, "string");
  });
});

test("EVENT_TYPES stays synchronized with EVENT_EFFECTS and is immutable", () => {
  assert.equal(EVENT_TYPES, Object.keys(EVENT_EFFECTS));
  assert.throws(() => {
    EVENT_TYPES[0] = "storm";
  }, TypeError);
  assert.throws(() => {
    EVENT_TYPES.push("volcano");
  }, TypeError);
});

test("getEventEffect returns descriptors or null for unknown events", () => {
  EVENT_TYPES.forEach((eventType) => {
    assert.is(getEventEffect(eventType), EVENT_EFFECTS[eventType]);
  });

  assert.is(getEventEffect("solar-flare"), null);
  assert.is(getEventEffect(undefined), null);
});

test.run();
