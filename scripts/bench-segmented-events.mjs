#!/usr/bin/env node
import { performance } from "node:perf_hooks";

import GridManager from "../src/grid/gridManager.js";
import {
  accumulateEventModifiers,
  resolveEventContribution,
} from "../src/energySystem.js";
import { EVENT_TYPES } from "../src/events/eventEffects.js";

class BenchmarkGridManager extends GridManager {
  init() {}
  consumeEnergy() {}
}

function clampIndex(value, min, max) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return min;
  }

  if (numeric < min) return min;
  if (numeric > max) return max;

  return numeric;
}

const rows = clampIndex(process.env.BENCH_ROWS ?? 48, 4, 256);
const cols = clampIndex(process.env.BENCH_COLS ?? 48, 4, 256);
const eventCount = clampIndex(process.env.BENCH_EVENTS ?? 160, 1, 2000);
const warmup = clampIndex(process.env.BENCH_WARMUP ?? 10, 0, 2000);
const iterations = clampIndex(process.env.BENCH_ITERATIONS ?? 200, 1, 20000);

const gm = new BenchmarkGridManager(rows, cols, {
  stats: {},
  maxTileEnergy: 12,
});

gm.eventEffectCache?.clear?.();

const rng = (() => {
  let seed = 1337;

  return () => {
    seed = (seed * 1664525 + 1013904223) % 0xffffffff;

    return seed / 0xffffffff;
  };
})();

const events = Array.from({ length: eventCount }, (_, index) => {
  const spanWidth = 4 + Math.floor(rng() * Math.min(12, cols));
  const spanHeight = 3 + Math.floor(rng() * Math.min(10, rows));
  const x = Math.floor(rng() * Math.max(1, cols - spanWidth));
  const y = Math.floor(rng() * Math.max(1, rows - spanHeight));
  const type = EVENT_TYPES[index % EVENT_TYPES.length];
  const strength = 0.2 + (index % 5) * 0.18;

  return {
    id: `event-${index}`,
    eventType: type,
    strength,
    affectedArea: {
      x,
      y,
      width: spanWidth,
      height: spanHeight,
    },
  };
});

const eventOptions = {
  events,
  row: 0,
  col: 0,
  eventStrengthMultiplier: 1,
  isEventAffecting: gm.eventContext.isEventAffecting,
  getEventEffect: gm.eventContext.getEventEffect,
  effectCache: gm.eventEffectCache,
  collectAppliedEvents: false,
};

function precomputeWithAccumulate() {
  const contributions = new Map();
  const singleEventList = [null];
  const previousRow = eventOptions.row;
  const previousCol = eventOptions.col;
  const previousEvents = eventOptions.events;

  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];

    if (!ev) continue;

    const area = ev.affectedArea;
    const sampleRow = area
      ? Math.min(rows - 1, Math.max(0, Math.floor(area.y ?? 0)))
      : 0;
    const sampleCol = area
      ? Math.min(cols - 1, Math.max(0, Math.floor(area.x ?? 0)))
      : 0;

    eventOptions.row = sampleRow;
    eventOptions.col = sampleCol;
    singleEventList[0] = ev;
    eventOptions.events = singleEventList;

    const modifiers = accumulateEventModifiers(eventOptions);

    contributions.set(ev, modifiers);
  }

  eventOptions.row = previousRow;
  eventOptions.col = previousCol;
  eventOptions.events = previousEvents;

  return contributions;
}

function createCachedPrecomputer() {
  const cache = new WeakMap();
  const { getEventEffect, effectCache } = eventOptions;

  return () => {
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];

      if (!ev) continue;

      const baseStrength = Number(ev?.strength ?? 0);
      const normalizedBase = Number.isFinite(baseStrength) ? baseStrength : 0;
      const strength = normalizedBase * eventOptions.eventStrengthMultiplier;
      const cached = cache.get(ev);

      if (
        cached &&
        cached.strength === strength &&
        cached.effectResolver === getEventEffect
      ) {
        continue;
      }

      const contribution = resolveEventContribution({
        event: ev,
        strengthMultiplier: eventOptions.eventStrengthMultiplier,
        getEventEffect,
        effectCache,
      });

      cache.set(ev, {
        strength,
        effectResolver: getEventEffect,
        contribution,
      });
    }
  };
}

const runCachedPrecompute = createCachedPrecomputer();

for (let i = 0; i < warmup; i += 1) {
  precomputeWithAccumulate();
}

let start = performance.now();

for (let i = 0; i < iterations; i += 1) {
  precomputeWithAccumulate();
}

const oldDuration = performance.now() - start;

for (let i = 0; i < warmup; i += 1) {
  runCachedPrecompute();
}

start = performance.now();

for (let i = 0; i < iterations; i += 1) {
  runCachedPrecompute();
}

const newDuration = performance.now() - start;

const metrics = {
  rows,
  cols,
  events: eventCount,
  warmup,
  iterations,
  accumulateTotalMs: oldDuration,
  cachedTotalMs: newDuration,
  accumulateAvgMs: oldDuration / iterations,
  cachedAvgMs: newDuration / iterations,
  speedup: oldDuration / newDuration,
};

console.log(JSON.stringify(metrics, null, 2));
