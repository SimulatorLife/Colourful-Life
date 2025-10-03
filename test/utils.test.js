import { assert, test } from "#tests/harness";
import {
  randomRange,
  lerp,
  clamp,
  clamp01,
  sanitizeNumber,
  cloneTracePayload,
  createRankedBuffer,
  createRNG,
  reportError,
  toFiniteOrNull,
  toPlainObject,
  warnOnce,
} from "../src/utils.js";

function* cycle(values) {
  let index = 0;

  while (true) {
    yield values[index % values.length];
    index += 1;
  }
}

test("numeric helpers clamp and interpolate values deterministically", () => {
  const rngValues = cycle([0, 0.5, 1]);
  const rng = () => rngValues.next().value;

  assert.is(randomRange(10, 20, rng), 10);
  assert.is(randomRange(10, 20, rng), 15);
  assert.is(randomRange(10, 20, rng), 20);

  assert.is(lerp(0, 10, 0.25), 2.5);
  assert.is(lerp(5, 15, 1.5), 15, "lerp clamps interpolation factor to 1");

  assert.is(clamp(5, 0, 4), 4);
  assert.is(clamp(-1, 0, 4), 0);
  assert.is(clamp01("0.7"), 0.7);
  assert.is(clamp01(Number.POSITIVE_INFINITY), 0);
});

test("cloneTracePayload performs deep copies of sensors and nodes", () => {
  const trace = {
    sensors: [
      { id: "energy", value: 0.5 },
      { id: "neighbors", value: 3 },
    ],
    nodes: [
      {
        id: "hidden-1",
        bias: 0.1,
        inputs: [
          { id: "input-1", weight: 0.2 },
          { id: "input-2", weight: 0.3 },
        ],
      },
    ],
  };

  const clone = cloneTracePayload(trace);

  assert.ok(clone !== trace);
  assert.ok(clone.sensors[0] !== trace.sensors[0]);
  assert.ok(clone.nodes[0] !== trace.nodes[0]);
  assert.ok(clone.nodes[0].inputs[0] !== trace.nodes[0].inputs[0]);

  clone.sensors[0].value = 1;
  clone.nodes[0].inputs[0].weight = 0.9;

  assert.is(trace.sensors[0].value, 0.5);
  assert.is(trace.nodes[0].inputs[0].weight, 0.2);
  assert.is(cloneTracePayload(null), null);
});

test("sanitizeNumber normalizes input with bounds and rounding strategies", () => {
  assert.is(
    sanitizeNumber("17.2", { min: 10, max: 20 }),
    17.2,
    "accepts numeric-like strings",
  );
  assert.is(
    sanitizeNumber("oops", { fallback: -1 }),
    -1,
    "returns fallback for non-numeric input",
  );
  assert.is(sanitizeNumber(25, { max: 10 }), 10, "enforces upper bound");
  assert.is(sanitizeNumber(-4, { min: 0 }), 0, "enforces lower bound");
  assert.is(sanitizeNumber(3.6, { round: true }), 4, "round=true applies Math.round");
  assert.is(
    sanitizeNumber(6.8, { round: Math.floor }),
    6,
    "accepts custom rounding functions",
  );
  assert.is(
    sanitizeNumber("9.1", {
      round: () => Number.POSITIVE_INFINITY,
      fallback: 42,
    }),
    42,
    "falls back when rounding produces non-finite values",
  );
});

test("createRankedBuffer maintains sorted order and honors capacity limits", () => {
  const buffer = createRankedBuffer(3, (a, b) => b.score - a.score);

  buffer.add({ score: 5, id: "a" });
  buffer.add({ score: 1, id: "b" });
  buffer.add({ score: 3, id: "c" });
  buffer.add({ score: 4, id: "d" });
  buffer.add({ score: 2, id: "e" });
  buffer.add(null);

  assert.equal(buffer.getItems(), [
    { score: 5, id: "a" },
    { score: 4, id: "d" },
    { score: 3, id: "c" },
  ]);

  const zeroBuffer = createRankedBuffer(0, (a, b) => b - a);

  zeroBuffer.add(1);
  assert.equal(zeroBuffer.getItems(), []);
});

test("createRNG yields deterministic pseudo-random sequences", () => {
  const sequenceFrom = (seed) => {
    const rng = createRNG(seed);

    return Array.from({ length: 5 }, () => rng());
  };

  const seqA = sequenceFrom(1234);
  const seqB = sequenceFrom(1234);
  const seqC = sequenceFrom(5678);

  assert.equal(seqA, seqB, "same seed yields identical sequences");
  assert.ok(seqA.some((value, index) => value !== seqC[index]));
});

test("warnOnce logs each unique message/error combination only once", () => {
  const originalWarn = console.warn;
  const calls = [];
  let detailedError;
  let fallbackError;

  console.warn = (...args) => {
    calls.push(args);
  };

  try {
    warnOnce("alpha-message");
    warnOnce("alpha-message");

    detailedError = new Error("boom");

    warnOnce("alpha-message", detailedError);
    warnOnce("alpha-message", new Error("boom"));

    fallbackError = new Error("uh-oh");

    warnOnce("beta-message", fallbackError);
  } finally {
    console.warn = originalWarn;
  }

  assert.is(calls.length, 3);
  assert.equal(
    calls.map(([message]) => message),
    ["alpha-message", "alpha-message", "beta-message"],
  );
  assert.is(calls[1][1], detailedError);
  assert.is(calls[2][1], fallbackError);
});

test("warnOnce ignores non-string or empty messages", () => {
  const originalWarn = console.warn;
  const calls = [];

  console.warn = (...args) => {
    calls.push(args);
  };

  try {
    warnOnce(null);
    warnOnce(42);
    warnOnce(0);
    warnOnce("");
    warnOnce(undefined, new Error("skipped"));
    warnOnce("gamma-message");
    warnOnce("gamma-message");
  } finally {
    console.warn = originalWarn;
  }

  assert.is(calls.length, 1);
  assert.equal(calls[0], ["gamma-message"]);
});

test("reportError logs errors and supports optional deduplication", () => {
  const originalError = console.error;
  const calls = [];

  console.error = (...args) => {
    calls.push(args);
  };

  try {
    const firstError = new Error("alpha");
    const secondError = new Error("beta");

    reportError("first message", firstError);
    reportError("first message", firstError);

    reportError("dedup message", firstError, { once: true });
    reportError("dedup message", firstError, { once: true });
    reportError("dedup message", secondError, { once: true });

    reportError("message only");
    reportError("", secondError);
  } finally {
    console.error = originalError;
  }

  assert.is(calls.length, 5);
  assert.equal(
    calls.map((args) => args[0]),
    [
      "first message",
      "first message",
      "dedup message",
      "dedup message",
      "message only",
    ],
  );
  assert.is(calls[0][1], calls[1][1]);
});

test("toPlainObject returns candidate objects and coerces primitives", () => {
  const objectCandidate = { alpha: 1 };
  const arrayCandidate = [1, 2, 3];

  assert.is(toPlainObject(objectCandidate), objectCandidate);
  assert.is(toPlainObject(arrayCandidate), arrayCandidate);
  assert.equal(toPlainObject(null), {});
  assert.equal(toPlainObject(undefined), {});
  assert.equal(toPlainObject(""), {});
  assert.equal(toPlainObject(7), {});
  assert.equal(
    toPlainObject(() => {}),
    {},
    "functions are coerced to empty objects",
  );
});

test("toFiniteOrNull converts numeric-like values and discards invalid input", () => {
  assert.is(toFiniteOrNull(42), 42);
  assert.is(toFiniteOrNull(3.14), 3.14);
  assert.is(toFiniteOrNull("7.5"), 7.5);
  assert.is(toFiniteOrNull("  12  "), 12);
  assert.is(toFiniteOrNull(BigInt(8)), 8);

  assert.is(toFiniteOrNull(null), null);
  assert.is(toFiniteOrNull(undefined), null);
  assert.is(toFiniteOrNull(""), null);
  assert.is(toFiniteOrNull("abc"), null);
  assert.is(toFiniteOrNull(Number.POSITIVE_INFINITY), null);
  assert.is(toFiniteOrNull(Number.NaN), null);
});
