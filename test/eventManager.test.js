import { assert, test } from "#tests/harness";
import EventManager, {
  sanitizeRandomEventConfig,
  sampleEventSpan,
  clampEventStart,
  isEventAffecting,
} from "../src/events/eventManager.js";
import { EVENT_TYPES } from "../src/events/eventEffects.js";
import { randomRange } from "../src/utils/math.js";

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

function expectedEventFromSequence(
  sequence,
  rows,
  cols,
  eventTypes,
  randomEventConfig,
) {
  const rng = makeSequenceRng(sequence.slice());
  const config = sanitizeRandomEventConfig(randomEventConfig);
  const pool =
    Array.isArray(eventTypes) && eventTypes.length > 0
      ? eventTypes
      : EventManager.DEFAULT_EVENT_TYPES;
  const fallbackPool = pool.length > 0 ? pool : EventManager.DEFAULT_EVENT_TYPES;
  const eventType = fallbackPool[Math.floor(randomRange(0, fallbackPool.length, rng))];
  const duration = Math.floor(
    randomRange(config.durationRange.min, config.durationRange.max, rng),
  );
  const strength = randomRange(config.strengthRange.min, config.strengthRange.max, rng);
  const rawX = Math.floor(randomRange(0, cols, rng));
  const rawY = Math.floor(randomRange(0, rows, rng));
  const width = sampleEventSpan(cols, rng, config.span);
  const height = sampleEventSpan(rows, rng, config.span);
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

test("EventManager leaves external influence dormant by default", () => {
  const rows = 40;
  const cols = 60;
  const rng = makeSequenceRng([0.1, 0.2, 0.3]);
  const manager = new EventManager(rows, cols, rng);

  assert.is(manager.currentEvent, null);
  assert.is(manager.activeEvents.length, 0);
  assert.is(rng.getCalls(), 0, "external events should not consume RNG when disabled");
});

test("EventManager respects injected RNG for deterministic events", () => {
  const rows = 40;
  const cols = 60;
  const sequence = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  const rng = makeSequenceRng(sequence.slice());
  const manager = new EventManager(rows, cols, rng, { startWithEvent: true });
  const expected = expectedEventFromSequence(sequence, rows, cols, EVENT_TYPES);

  assert.equal(manager.currentEvent, expected);
  assert.is(rng.getCalls(), sequence.length);
});

test("EventManager can disable the initial event when requested", () => {
  const manager = new EventManager(12, 18, Math.random, { startWithEvent: false });

  assert.is(manager.activeEvents.length, 0);
  assert.is(manager.currentEvent, null);
});

test("EventManager allows overriding event colors via options", () => {
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

test("randomEventConfig customizes generated event ranges", () => {
  const rows = 12;
  const cols = 18;
  const sequence = [0.11, 0.42, 0.37, 0.58, 0.23, 0.71, 0.19];
  const rng = makeSequenceRng(sequence.slice());
  const config = {
    durationRange: { min: 120, max: 240 },
    strengthRange: { min: 0.4, max: 0.6 },
    span: { min: 4, ratio: 0.5 },
  };
  const manager = new EventManager(rows, cols, rng, {
    startWithEvent: false,
    randomEventConfig: config,
  });
  const expected = expectedEventFromSequence(sequence, rows, cols, EVENT_TYPES, config);
  const event = manager.generateRandomEvent();

  assert.equal(event, expected);
  assert.is(rng.getCalls(), sequence.length);
});

test("randomEventConfig accepts deterministic ranges", () => {
  const rows = 20;
  const cols = 24;
  const sequence = [0.05, 0.33, 0.72, 0.1, 0.25, 0.4, 0.6];
  const rng = makeSequenceRng(sequence.slice());
  const config = {
    durationRange: { min: 150, max: 150 },
    strengthRange: { min: 0.5, max: 0.5 },
    span: { min: 6, ratio: 0 },
  };
  const manager = new EventManager(rows, cols, rng, {
    startWithEvent: false,
    randomEventConfig: config,
  });
  const expected = expectedEventFromSequence(sequence, rows, cols, EVENT_TYPES, config);
  const event = manager.generateRandomEvent();

  assert.equal(event, expected);
  assert.is(event.duration, 150);
  assert.is(event.strength, 0.5);
  assert.is(event.affectedArea.width, 6);
  assert.is(event.affectedArea.height, 6);
  assert.is(rng.getCalls(), sequence.length);
});

test("generateRandomEvent keeps affected area within the grid bounds", () => {
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

test("isEventAffecting checks if coordinates fall within event area", () => {
  const event = {
    affectedArea: { x: 5, y: 10, width: 3, height: 4 },
  };

  assert.ok(isEventAffecting(event, 10, 5), "top-left corner included");
  assert.ok(isEventAffecting(event, 13, 7), "bottom-right boundary-1 included");
  assert.not.ok(isEventAffecting(event, 14, 7), "outside height excluded");
  assert.not.ok(isEventAffecting(event, 12, 8), "outside width excluded");
  assert.not.ok(isEventAffecting(null, 10, 5), "null event excluded");
});
