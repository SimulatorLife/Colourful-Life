import { test, assert } from "#tests/harness";
import {
  DEFAULT_RANDOM_EVENT_CONFIG,
  DEFAULT_SPAWN_COOLDOWN_RANGE,
  planRandomEvent,
  planSpawnCooldown,
  resolveSpawnCooldownRange,
  sanitizeRandomEventConfig,
} from "../src/events/eventGenerationPolicy.js";

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

test("planRandomEvent delegates type selection, duration, strength, and area to policy", () => {
  const rows = 12;
  const cols = 18;
  const sequence = [0.42, 0.37, 0.23, 0.71, 0.5, 0.6];
  const rng = makeSequenceRng(sequence.slice());
  const config = sanitizeRandomEventConfig({
    durationRange: { min: 120, max: 240 },
    strengthRange: { min: 0.4, max: 0.6 },
    span: { min: 4, ratio: 0.5 },
  });
  const picker = () => "heatwave";

  const plan = planRandomEvent({
    pickEventType: picker,
    randomEventConfig: config,
    rows,
    cols,
    rng,
  });

  assert.is(plan.eventType, "heatwave", "picker determines the event type");
  assert.is(plan.duration, Math.floor(0.42 * 120 + 120));
  assert.is(
    Math.round(plan.strength * 100),
    Math.round((0.4 + (0.6 - 0.4) * 0.37) * 100),
    "strength should be sampled from the configured range",
  );
  assert.ok(plan.affectedArea.width >= 1 && plan.affectedArea.width <= cols);
  assert.ok(plan.affectedArea.height >= 1 && plan.affectedArea.height <= rows);
  assert.ok(
    plan.affectedArea.x + plan.affectedArea.width <= cols,
    "width fits horizontally",
  );
  assert.ok(
    plan.affectedArea.y + plan.affectedArea.height <= rows,
    "height fits vertically",
  );
  assert.is(rng.getCalls(), sequence.length);
});

test("planRandomEvent surfaces errors when no picker is provided", () => {
  let caught = null;

  try {
    planRandomEvent({
      pickEventType: undefined,
      randomEventConfig: sanitizeRandomEventConfig(null),
      rows: 4,
      cols: 4,
      rng: makeSequenceRng([0.1]),
    });
  } catch (error) {
    caught = error;
  }

  assert.instance(caught, TypeError);
  assert.match(
    String(caught?.message ?? ""),
    /pickEventType function/,
    "missing picker should raise a descriptive TypeError",
  );
});

test("planRandomEvent never mutates its randomEventConfig argument", () => {
  const rows = 6;
  const cols = 8;
  const config = sanitizeRandomEventConfig({
    durationRange: { min: 50, max: 60 },
    strengthRange: { min: 0.1, max: 0.2 },
    span: { min: 1, ratio: 0 },
  });
  const snapshot = JSON.stringify(config);
  const picker = () => "flood";

  planRandomEvent({
    pickEventType: picker,
    randomEventConfig: config,
    rows,
    cols,
    rng: makeSequenceRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.05]),
  });

  assert.is(
    JSON.stringify(config),
    snapshot,
    "planRandomEvent should treat randomEventConfig as immutable",
  );
});

test("planRandomEvent keeps affected area within grid bounds across repeated draws", () => {
  const rows = 5;
  const cols = 7;
  const config = sanitizeRandomEventConfig({
    durationRange: { min: 100, max: 100 },
    strengthRange: { min: 0.5, max: 0.5 },
    span: { min: 3, ratio: 0.4 },
  });

  for (let i = 0; i < 20; i += 1) {
    const rng = makeSequenceRng([0.01, 0.5, 0.5, 0.99, 0.99, 0.01, 0.01]);
    const plan = planRandomEvent({
      pickEventType: () => "flood",
      randomEventConfig: config,
      rows,
      cols,
      rng,
    });
    const { x, y, width, height } = plan.affectedArea;

    assert.ok(width >= 1 && width <= cols, `width ${width} within cols ${cols}`);
    assert.ok(height >= 1 && height <= rows, `height ${height} within rows ${rows}`);
    assert.ok(x >= 0 && x + width <= cols, "x keeps width inside grid");
    assert.ok(y >= 0 && y + height <= rows, "y keeps height inside grid");
  }
});

test("planSpawnCooldown honours the default range and frequency multiplier", () => {
  const rng = makeSequenceRng([0.5]);
  const cooldown = planSpawnCooldown({ rng, frequencyMultiplier: 2 });

  const expected = Math.max(
    0,
    Math.floor(
      Math.floor(
        0.5 * (DEFAULT_SPAWN_COOLDOWN_RANGE.max - DEFAULT_SPAWN_COOLDOWN_RANGE.min) +
          DEFAULT_SPAWN_COOLDOWN_RANGE.min,
      ) / 2,
    ),
  );

  assert.is(cooldown, expected);
  assert.ok(
    cooldown <= DEFAULT_SPAWN_COOLDOWN_RANGE.max,
    "cooldown should never exceed the upper bound of the range",
  );
});

test("planSpawnCooldown accepts caller-supplied cooldown range overrides", () => {
  const rng = makeSequenceRng([0.25]);
  const cooldown = planSpawnCooldown({
    rng,
    frequencyMultiplier: 1,
    cooldownRange: { min: 100, max: 200 },
  });

  assert.is(cooldown, Math.floor(0.25 * 100 + 100));
});

test("planSpawnCooldown is robust to non-positive frequency multipliers", () => {
  const rng = makeSequenceRng([0.9]);
  const cooldown = planSpawnCooldown({
    rng,
    frequencyMultiplier: 0,
    cooldownRange: { min: 50, max: 60 },
  });

  assert.ok(Number.isFinite(cooldown));
  assert.ok(cooldown >= 0, "cooldown stays non-negative even with zero multiplier");
});

test("planSpawnCooldown floors fractional results", () => {
  const rng = makeSequenceRng([0.99]);
  const cooldown = planSpawnCooldown({
    rng,
    frequencyMultiplier: 1,
    cooldownRange: { min: 10, max: 11 },
  });

  assert.is(cooldown, Math.floor(10 + 0.99));
});

test("resolveSpawnCooldownRange clones defaults and validates overrides", () => {
  const defaulted = resolveSpawnCooldownRange();

  assert.equal(defaulted, { ...DEFAULT_SPAWN_COOLDOWN_RANGE });
  assert.is(defaulted.min, DEFAULT_SPAWN_COOLDOWN_RANGE.min);
  assert.is(defaulted.max, DEFAULT_SPAWN_COOLDOWN_RANGE.max);
  assert.is(
    JSON.stringify(defaulted),
    JSON.stringify({ ...DEFAULT_SPAWN_COOLDOWN_RANGE }),
  );

  const overridden = resolveSpawnCooldownRange({ min: 30, max: 10 });

  assert.is(overridden.min, 10, "swapped bounds should be re-ordered");
  assert.is(overridden.max, 30);

  const fromArray = resolveSpawnCooldownRange([120, 240]);

  assert.is(fromArray.min, 120);
  assert.is(fromArray.max, 240);

  const fallback = resolveSpawnCooldownRange({ min: 50, max: Number.NaN });

  assert.equal(fallback, { ...DEFAULT_SPAWN_COOLDOWN_RANGE });
});

test("DEFAULT_RANDOM_EVENT_CONFIG and DEFAULT_SPAWN_COOLDOWN_RANGE stay frozen", () => {
  assert.ok(Object.isFrozen(DEFAULT_RANDOM_EVENT_CONFIG));
  assert.ok(Object.isFrozen(DEFAULT_RANDOM_EVENT_CONFIG.durationRange));
  assert.ok(Object.isFrozen(DEFAULT_RANDOM_EVENT_CONFIG.strengthRange));
  assert.ok(Object.isFrozen(DEFAULT_RANDOM_EVENT_CONFIG.span));
  assert.ok(Object.isFrozen(DEFAULT_SPAWN_COOLDOWN_RANGE));
});
