import { test } from "uvu";
import * as assert from "uvu/assert";

function makeSequenceRng(sequence) {
  let index = 0;

  const rng = () => {
    if (index >= sequence.length) {
      throw new Error("RNG sequence exhausted");
    }

    const value = sequence[index];

    index += 1;

    return value;
  };

  rng.getCalls = () => index;

  return rng;
}

function sampleEventSpanFromSequence(size, sample) {
  const maxSpan = Math.max(1, Math.floor(size));
  const minSpan = Math.min(10, maxSpan);
  const spanCandidate = Math.max(minSpan, Math.floor(maxSpan / 3));
  const upperExclusive = spanCandidate === minSpan ? minSpan + 1 : spanCandidate + 1;
  const raw = Math.floor(sample(minSpan, upperExclusive));

  return Math.max(1, Math.min(maxSpan, raw));
}

function clampEventStart(rawStart, span, limit) {
  const maxStart = Math.max(0, Math.floor(limit) - span);

  if (maxStart <= 0) {
    return 0;
  }

  return Math.min(maxStart, Math.max(0, rawStart));
}

function expectedEventFromSequence(sequence, rows, cols, eventTypes) {
  let idx = 0;

  const sample = (min, max) => min + sequence[idx++] * (max - min);
  const eventType = eventTypes[Math.floor(sample(0, eventTypes.length))];
  const duration = Math.floor(sample(300, 900));
  const strength = sample(0.25, 1);
  const rawX = Math.floor(sample(0, cols));
  const rawY = Math.floor(sample(0, rows));
  const width = sampleEventSpanFromSequence(cols, sample);
  const height = sampleEventSpanFromSequence(rows, sample);
  const x = clampEventStart(rawX, width, cols);
  const y = clampEventStart(rawY, height, rows);

  return {
    eventType,
    duration,
    strength,
    affectedArea: { x, y, width, height },
    remaining: duration,
  };
}

test("EventManager respects injected RNG for deterministic events", async () => {
  const [{ default: EventManager }, { EVENT_TYPES }] = await Promise.all([
    import("../src/events/eventManager.js"),
    import("../src/events/eventEffects.js"),
  ]);
  const rows = 40;
  const cols = 60;
  const sequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const rng = makeSequenceRng(sequence.slice());
  const manager = new EventManager(rows, cols, rng);
  const expected = expectedEventFromSequence(sequence, rows, cols, EVENT_TYPES);

  assert.equal(manager.currentEvent, expected);
  assert.is(rng.getCalls(), sequence.length);
});

test("EventManager can disable the initial event when requested", async () => {
  const { default: EventManager } = await import("../src/events/eventManager.js");
  const manager = new EventManager(12, 18, Math.random, { startWithEvent: false });

  assert.is(manager.activeEvents.length, 0);
  assert.is(manager.currentEvent, null);
});

test("EventManager allows overriding event colors via options", async () => {
  const { default: EventManager } = await import("../src/events/eventManager.js");
  const rows = 10;
  const cols = 10;
  const customColors = {
    flood: "#0011ff",
    drought: "#ccaa77",
    custom: "#123123",
  };
  const managerWithMap = new EventManager(rows, cols, Math.random, {
    eventColors: customColors,
  });

  assert.is(managerWithMap.getColor({ eventType: "flood" }), customColors.flood);
  assert.is(
    managerWithMap.getColor({ eventType: "heatwave" }),
    EventManager.EVENT_COLORS.heatwave,
  );
  assert.is(
    managerWithMap.getColor({ eventType: "unknown" }),
    EventManager.DEFAULT_EVENT_COLOR,
  );

  const managerWithResolver = new EventManager(rows, cols, Math.random, {
    resolveEventColor(eventType) {
      if (eventType === "heatwave") return "#ff6600";

      return undefined;
    },
  });

  assert.is(managerWithResolver.getColor({ eventType: "heatwave" }), "#ff6600");
  assert.is(
    managerWithResolver.getColor({ eventType: "drought" }),
    EventManager.EVENT_COLORS.drought,
  );
});

test("generateRandomEvent keeps affected area within the grid bounds", async () => {
  const { default: EventManager } = await import("../src/events/eventManager.js");
  const rows = 4;
  const cols = 6;
  const manager = new EventManager(rows, cols, Math.random, { startWithEvent: false });

  for (let i = 0; i < 25; i++) {
    const event = manager.generateRandomEvent();
    const { x, y, width, height } = event.affectedArea;

    assert.ok(
      width >= 1 && width <= cols,
      `width ${width} should fit within cols ${cols}`,
    );
    assert.ok(
      height >= 1 && height <= rows,
      `height ${height} should fit within rows ${rows}`,
    );
    assert.ok(x >= 0 && x + width <= cols, "event width stays inside grid");
    assert.ok(y >= 0 && y + height <= rows, "event height stays inside grid");
  }
});

test("isEventAffecting checks if coordinates fall within event area", async () => {
  const { isEventAffecting } = await import("../src/events/eventManager.js");
  const event = {
    affectedArea: { x: 5, y: 10, width: 3, height: 4 },
  };

  assert.ok(isEventAffecting(event, 10, 5), "top-left corner included");
  assert.ok(isEventAffecting(event, 13, 7), "bottom-right boundary-1 included");
  assert.not.ok(isEventAffecting(event, 14, 7), "outside height excluded");
  assert.not.ok(isEventAffecting(event, 12, 8), "outside width excluded");
  assert.not.ok(isEventAffecting(null, 10, 5), "null event excluded");
});

test.run();
