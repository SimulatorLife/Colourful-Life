import { assert, test } from "#tests/harness";
import {
  randomRange,
  lerp,
  clamp,
  clamp01,
  clampFinite,
  sanitizeNumber,
  sanitizePositiveInteger,
  sanitizeNonNegativeInteger,
  sanitizeUnitInterval,
  pickFirstFinitePositive,
  createRNG,
  toFiniteOrNull,
  applyIntervalFloor,
} from "../src/utils/math.js";
import { coerceBoolean, resolveNonEmptyString } from "../src/utils/primitives.js";
import { resolveCellColor } from "../src/utils/cell.js";
import { cloneTracePayload, toPlainObject } from "../src/utils/object.js";
import {
  createRankedBuffer,
  isArrayLike,
  takeTopBy,
  toArray,
} from "../src/utils/collections.js";
import {
  __dangerousGetWarnOnceSize,
  __dangerousResetWarnOnce,
  invokeWithErrorBoundary,
  warnOnce,
} from "../src/utils/error.js";
import { resolveColorRecord } from "../src/grid/colorRecords.js";

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

test("clampFinite coerces invalid inputs and sanitizes fallbacks", () => {
  assert.is(clampFinite("7.2", 0, 10, 3), 7.2, "string candidates are coerced");
  assert.is(
    clampFinite(-5, -2, 2, 0),
    -2,
    "values below the range clamp to the lower bound",
  );
  assert.is(
    clampFinite(9, -2, 2, 0),
    2,
    "values above the range clamp to the upper bound",
  );
  assert.is(
    clampFinite("oops", 0, 5, 3),
    3,
    "fallback is returned when candidate is non-finite",
  );
  assert.is(
    clampFinite("oops", 0, 5, 8),
    5,
    "fallback values are also clamped into range",
  );
  assert.is(
    clampFinite("oops", -4, 4, Number.POSITIVE_INFINITY),
    -4,
    "non-finite fallbacks collapse to the lower bound",
  );
});

test("coerceBoolean normalizes boolean-like values with sane fallbacks", () => {
  assert.is(coerceBoolean(true), true);
  assert.is(coerceBoolean(false), false);

  assert.is(coerceBoolean(null, true), true, "null returns fallback");
  assert.is(coerceBoolean(undefined, true), true, "undefined returns fallback");

  assert.is(coerceBoolean(0), false);
  assert.is(coerceBoolean(1), true);
  assert.is(coerceBoolean(-2), true);
  assert.is(
    coerceBoolean(Number.POSITIVE_INFINITY, false),
    false,
    "non-finite numbers use fallback",
  );
  assert.is(coerceBoolean(Number.NaN, true), true, "NaN values use fallback");

  assert.is(coerceBoolean("true"), true);
  assert.is(coerceBoolean("FALSE"), false);
  assert.is(coerceBoolean("  yes  "), true);
  assert.is(coerceBoolean("Off"), false);
  assert.is(coerceBoolean("2"), true, "numeric strings are coerced");
  assert.is(coerceBoolean("0"), false, "numeric string zero coerces to false");
  assert.is(
    coerceBoolean("maybe", false),
    false,
    "non-numeric/keyword strings fall back",
  );
  assert.is(coerceBoolean("   ", true), true, "empty strings after trim use fallback");

  assert.is(coerceBoolean({}, true), true, "objects fall back to the provided default");
  assert.is(
    coerceBoolean({}, false),
    false,
    "objects respect a false fallback when unspecified",
  );
  assert.is(
    coerceBoolean(Symbol("token"), true),
    true,
    "symbols fall back to the provided default",
  );
  assert.is(
    coerceBoolean(Symbol("token"), false),
    false,
    "symbols respect a false fallback",
  );
});

test("resolveNonEmptyString filters out blank or non-string values", () => {
  assert.is(resolveNonEmptyString("hello", "fallback"), "hello");
  assert.is(
    resolveNonEmptyString("  padded  ", "fallback"),
    "padded",
    "leading and trailing whitespace should be trimmed",
  );
  assert.is(resolveNonEmptyString("", "fallback"), "fallback");
  assert.is(
    resolveNonEmptyString("   ", "fallback"),
    "fallback",
    "whitespace-only strings use fallback",
  );
  assert.is(resolveNonEmptyString(null, "fallback"), "fallback");
  assert.is(resolveNonEmptyString(undefined), null);
});

test("resolveCellColor falls back to DNA color when runtime color is blank", () => {
  const dna = { toColor: () => "#abcdef" };
  const cell = { color: "   ", dna };

  assert.is(
    resolveCellColor(cell),
    "#abcdef",
    "whitespace color strings should not block DNA fallback",
  );
});

test("resolveColorRecord parses rgba alpha percentages", () => {
  const record = resolveColorRecord("rgba(10, 20, 30, 50%)");

  assert.equal(record.rgba, [10, 20, 30, 128]);
});

test("resolveColorRecord parses fractional alpha values", () => {
  const record = resolveColorRecord("rgba(10, 20, 30, 0.25)");

  assert.equal(record.rgba, [10, 20, 30, 64]);
});

test("resolveColorRecord parses space-separated rgb values", () => {
  const record = resolveColorRecord("rgb(255 128 64)");

  assert.equal(record.rgba, [255, 128, 64, 255]);
});

test("resolveColorRecord parses slash-delimited alpha syntax", () => {
  const record = resolveColorRecord("rgb(255 128 64 / 50%)");

  assert.equal(record.rgba, [255, 128, 64, 128]);
});

test("sanitizeNumber treats blank strings as missing overrides", () => {
  assert.is(
    sanitizeNumber("   ", { fallback: 42 }),
    42,
    "whitespace-only strings use fallback",
  );
  assert.is(
    sanitizeNumber("\n\t", { fallback: 7, min: 0 }),
    7,
    "control characters are trimmed before coercion",
  );
  assert.is(
    sanitizeNumber(null, { fallback: 11 }),
    11,
    "null candidates use the provided fallback",
  );
  assert.is(
    sanitizePositiveInteger("", { fallback: 9, min: 1 }),
    9,
    "positive integer sanitizer inherits blank string handling",
  );
});

test("sanitizeUnitInterval clamps candidates into the unit range", () => {
  assert.is(sanitizeUnitInterval(0.5), 0.5);
  assert.is(sanitizeUnitInterval(2), 1, "values above the upper bound clamp to 1");
  assert.is(sanitizeUnitInterval(-0.3), 0, "values below the lower bound clamp to 0");
  assert.is(
    sanitizeUnitInterval("0.25"),
    0.25,
    "string inputs are coerced when numeric",
  );
  assert.is(
    sanitizeUnitInterval("oops", 0.4),
    0.4,
    "invalid inputs use the provided fallback",
  );
});

test("sanitizeNonNegativeInteger floors candidates and clamps fallbacks", () => {
  assert.is(sanitizeNonNegativeInteger(7.9), 7);
  assert.is(
    sanitizeNonNegativeInteger(-3, { fallback: 2 }),
    2,
    "negative values use sanitized fallback",
  );
  assert.is(
    sanitizeNonNegativeInteger("invalid", { fallback: 4 }),
    4,
    "non-numeric strings use fallback",
  );
  assert.is(
    sanitizeNonNegativeInteger(12, { fallback: 9, max: 10 }),
    9,
    "values exceeding max fall back within range",
  );
  assert.is(
    sanitizeNonNegativeInteger(5, { fallback: -2, max: 4 }),
    0,
    "fallback is sanitized to respect range",
  );
});

test("pickFirstFinitePositive selects the earliest positive candidate", () => {
  assert.is(
    pickFirstFinitePositive([null, undefined, "", "5", 3]),
    5,
    "stringified numbers are converted",
  );
  assert.is(
    pickFirstFinitePositive([0, -2, Number.NaN, "-5", BigInt(7)]),
    7,
    "BigInt candidates are coerced when finite",
  );
  assert.is(
    pickFirstFinitePositive([0, null, undefined], 42),
    42,
    "fallback is returned when no candidate qualifies",
  );
});

test("applyIntervalFloor enforces zero disablement and positive floors", () => {
  assert.ok(Number.isNaN(applyIntervalFloor("oops", 100)), "invalid input returns NaN");
  assert.is(applyIntervalFloor(-50, 100), 0, "negative values collapse to zero");
  assert.is(applyIntervalFloor(0, 100), 0, "explicit zero remains zero");
  assert.is(
    applyIntervalFloor(40, 100),
    100,
    "values below the floor adopt the minimum",
  );
  assert.is(applyIntervalFloor(250, 100), 250, "values above the floor pass through");
  assert.is(applyIntervalFloor(5, -20), 5, "non-positive floors are ignored");
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

test("cloneTracePayload deeply clones nodes and normalizes numeric fields", () => {
  const trace = {
    sensors: [],
    nodes: [
      {
        id: "hidden-1",
        sum: "1.2",
        output: "0.4",
        bias: 0.1,
        inputs: [
          {
            id: "input-1",
            weight: "0.2",
            value: "0.3",
            extras: { path: ["a", "b"] },
          },
        ],
        extras: {
          config: { threshold: "0.5" },
          history: [{ weight: "0.1" }],
        },
      },
    ],
  };

  const clone = cloneTracePayload(trace);

  assert.ok(clone !== trace);
  assert.ok(clone.nodes !== trace.nodes);
  assert.ok(clone.nodes[0] !== trace.nodes[0]);
  assert.ok(clone.nodes[0].inputs !== trace.nodes[0].inputs);
  assert.ok(clone.nodes[0].inputs[0] !== trace.nodes[0].inputs[0]);
  assert.is(clone.nodes[0].sum, 1.2);
  assert.is(clone.nodes[0].output, 0.4);
  assert.is(clone.nodes[0].inputs[0].weight, 0.2);
  assert.is(clone.nodes[0].inputs[0].value, 0.3);
  assert.ok(clone.nodes[0].extras !== trace.nodes[0].extras);

  clone.nodes[0].inputs[0].weight = 1;
  assert.is(trace.nodes[0].inputs[0].weight, "0.2");
});

test("cloneTracePayload clones sensor arrays with referential independence", () => {
  const trace = {
    sensors: [
      {
        id: "energy",
        key: "energy",
        value: "3.5",
        history: [1, "2", { nested: ["a", "b"] }],
      },
      { id: "neighbors", value: 2 },
    ],
    nodes: [],
  };

  const clone = cloneTracePayload(trace);

  assert.ok(clone !== trace);
  assert.ok(clone.sensors !== trace.sensors);
  assert.ok(clone.sensors[0] !== trace.sensors[0]);
  assert.is(clone.sensors[0].value, 3.5);
  assert.ok(clone.sensors[0].history !== trace.sensors[0].history);
  assert.is(clone.sensors[0].history[1], 2);
  assert.ok(clone.sensors[0].history[2] !== trace.sensors[0].history[2]);
  assert.ok(clone.sensors[0].history[2].nested !== trace.sensors[0].history[2].nested);

  clone.sensors[0].history.push(99);
  assert.is(trace.sensors[0].history.length, 3);
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
  assert.is(
    sanitizeNumber(Symbol("nope"), { fallback: 9 }),
    9,
    "returns fallback when conversion throws",
  );
});

test("sanitizePositiveInteger coerces dimension-like input safely", () => {
  assert.is(
    sanitizePositiveInteger("9.7", { fallback: 5 }),
    9,
    "floors numeric-like strings",
  );
  assert.is(
    sanitizePositiveInteger("oops", { fallback: 4 }),
    4,
    "falls back for invalid input",
  );
  assert.is(
    sanitizePositiveInteger(0, { fallback: 3 }),
    3,
    "returns fallback when input falls below minimum bound",
  );
  assert.is(
    sanitizePositiveInteger(500, { fallback: 3, max: 100 }),
    3,
    "returns fallback when exceeding max bound",
  );
  assert.is(
    sanitizePositiveInteger(undefined, { fallback: 0 }),
    1,
    "clamps fallback into the minimum bound",
  );
  assert.is(
    sanitizePositiveInteger(500, { fallback: 250, max: 100 }),
    100,
    "clamps fallback into the configured range",
  );
});

test("isArrayLike recognizes indexed sequences and filters non-arrays", () => {
  assert.ok(isArrayLike([1, 2, 3]));
  assert.ok(isArrayLike(new Uint8Array([4, 5, 6])));

  assert.not.ok(isArrayLike({ length: 3 }), "plain objects are not array-like");
  assert.not.ok(isArrayLike(new Map([["a", 1]])));
  assert.not.ok(isArrayLike(null));
});

test("toArray normalizes iterables and honours fallbacks", () => {
  const list = [1, 2, 3];
  const normalizedList = toArray(list);

  assert.equal(normalizedList, list, "existing arrays are returned intact");

  const typed = new Uint8Array([7, 8]);

  assert.equal(toArray(typed), [7, 8], "typed arrays are converted to standard arrays");

  const iterable = new Set(["a", "b"]);

  assert.equal(toArray(iterable), ["a", "b"], "iterables are collected into arrays");

  const arrayLike = { 0: "x", 1: "y", length: 2 };

  assert.equal(
    toArray(arrayLike),
    ["x", "y"],
    "array-like objects fallback to index-based collection",
  );

  const fallback = [42];

  assert.equal(
    toArray(null, { fallback }),
    fallback,
    "null candidates collapse to the provided fallback",
  );
});

test("createRankedBuffer sorts entries, trims capacity, and preserves tie order", () => {
  const buffer = createRankedBuffer(3, (a, b) => b.score - a.score);

  buffer.add({ score: 1, id: "low" });
  buffer.add({ score: 5, id: "top" });
  buffer.add({ score: 3, id: "mid" });
  buffer.add({ score: 4, id: "upper" });
  buffer.add({ score: 2, id: "ignored" });

  assert.equal(
    buffer.getItems().map((entry) => entry.id),
    ["top", "upper", "mid"],
  );

  buffer.add({ score: 5, id: "tie" });

  assert.equal(
    buffer.getItems().map((entry) => entry.id),
    ["top", "tie", "upper"],
    "ties insert after existing peers while removing the lowest-ranked entry",
  );

  buffer.add({ score: 2, id: "late" });

  assert.equal(
    buffer.getItems().map((entry) => entry.id),
    ["top", "tie", "upper"],
    "entries worse than the tail are ignored once capacity is full",
  );
});

test("createRankedBuffer sanitizes capacity and returns defensive copies", () => {
  const zeroBuffer = createRankedBuffer(-2, (a, b) => a - b);

  zeroBuffer.add(1);
  assert.equal(zeroBuffer.getItems(), []);

  const fractionalBuffer = createRankedBuffer(2.9, (a, b) => a - b);

  fractionalBuffer.add(3);
  fractionalBuffer.add(1);
  fractionalBuffer.add(2);

  const snapshot = fractionalBuffer.getItems();

  assert.equal(snapshot, [1, 2]);

  snapshot.push(0);

  assert.equal(
    fractionalBuffer.getItems(),
    [1, 2],
    "mutating a snapshot does not leak back into the buffer",
  );
});

test("createRankedBuffer falls back to insertion order without a comparator", () => {
  const buffer = createRankedBuffer(2);

  buffer.add("alpha");
  buffer.add("beta");
  buffer.add("gamma");

  assert.equal(buffer.getItems(), ["alpha", "beta"]);
});

test("takeTopBy extracts top scoring entries and removes them from the source", () => {
  const candidates = [
    { id: "a", score: 0.1 },
    { id: "b", score: 0.42 },
    { id: "c", score: 0.9 },
    { id: "d", score: 0.75 },
    { id: "e", score: 0.3 },
    { id: "f", score: 0.88 },
  ];

  const top = takeTopBy(candidates, 3, (entry) => entry.score);

  assert.equal(
    top.map((entry) => entry.id).sort(),
    ["c", "d", "f"],
    "top entries should include the highest scores",
  );
  assert.equal(
    candidates.map((entry) => entry.id).sort(),
    ["a", "b", "e"],
    "original array should only retain the remainder",
  );
});

test("takeTopBy gracefully handles duplicates and oversized requests", () => {
  const entries = [
    { id: 1, score: 0.8 },
    { id: 2, score: 0.8 },
    { id: 3, score: 0.5 },
    { id: 4, score: 0.5 },
  ];

  const band = takeTopBy(entries, 3, (entry) => entry.score);

  assert.is(band.length, 3);
  assert.equal(band.map((entry) => entry.id).sort(), [1, 2, 3]);

  const everything = takeTopBy(entries, 10, (entry) => entry.score);

  assert.equal(everything.map((entry) => entry.id).sort(), [4]);
  assert.equal(entries, [], "all entries should be removed when count exceeds length");
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
  __dangerousResetWarnOnce();
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
    __dangerousResetWarnOnce();
  }

  assert.is(calls.length, 3);
  assert.equal(
    calls.map(([message]) => message),
    ["alpha-message", "alpha-message", "beta-message"],
  );
  assert.is(calls[1][1], detailedError);
  assert.is(calls[2][1], fallbackError);
});

test("warnOnce treats distinct primitive details as unique", () => {
  __dangerousResetWarnOnce();
  const originalWarn = console.warn;
  const calls = [];

  console.warn = (...args) => {
    calls.push(args);
  };

  try {
    warnOnce("primitive-message", "first-detail");
    warnOnce("primitive-message", "second-detail");
    warnOnce("primitive-message", 42);
    warnOnce("primitive-message", 42n);
    warnOnce("primitive-message", Symbol.for("token"));
    warnOnce("primitive-message", Symbol.for("token"));
  } finally {
    console.warn = originalWarn;
    __dangerousResetWarnOnce();
  }

  assert.is(calls.length, 5);
  assert.equal(
    calls.map(([message, detail]) => [message, detail]),
    [
      ["primitive-message", "first-detail"],
      ["primitive-message", "second-detail"],
      ["primitive-message", 42],
      ["primitive-message", 42n],
      ["primitive-message", Symbol.for("token")],
    ],
  );
});

test("warnOnce ignores non-string or empty messages", () => {
  __dangerousResetWarnOnce();
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
    __dangerousResetWarnOnce();
  }

  assert.is(calls.length, 1);
  assert.equal(calls[0], ["gamma-message"]);
});

test("warnOnce bounds retained warning history to configured limit", () => {
  __dangerousResetWarnOnce({ limit: 4 });
  const originalWarn = console.warn;
  const calls = [];

  console.warn = (...args) => {
    calls.push(args[0]);
  };

  try {
    for (let i = 0; i < 6; i++) {
      warnOnce(`bounded-message-${i}`);
    }

    assert.is(__dangerousGetWarnOnceSize(), 4);

    warnOnce("bounded-message-0");
  } finally {
    console.warn = originalWarn;
    __dangerousResetWarnOnce();
  }

  assert.is(calls.length, 7);
  assert.equal(calls.slice(0, 6), [
    "bounded-message-0",
    "bounded-message-1",
    "bounded-message-2",
    "bounded-message-3",
    "bounded-message-4",
    "bounded-message-5",
  ]);
  assert.is(calls[6], "bounded-message-0");
});

test("invokeWithErrorBoundary reports errors through console.error by default", () => {
  const originalError = console.error;
  const calls = [];

  console.error = (...args) => {
    calls.push(args);
  };

  try {
    invokeWithErrorBoundary(
      () => {
        throw new Error("boom");
      },
      [],
      { message: "default reporter" },
    );
  } finally {
    console.error = originalError;
  }

  assert.is(calls.length, 1);
  assert.is(calls[0][0], "default reporter");
  assert.ok(calls[0][1] instanceof Error);
});

test("invokeWithErrorBoundary supports custom reporters and onError hooks", () => {
  const reports = [];
  let observedError;

  const result = invokeWithErrorBoundary(
    () => {
      throw new Error("boom");
    },
    ["alpha"],
    {
      message: "custom warning",
      reporter: (message, error) => {
        reports.push([message, error]);
      },
      onError: (error) => {
        observedError = error;
      },
    },
  );

  assert.is(result, undefined);
  assert.is(reports.length, 1);
  assert.is(reports[0][0], "custom warning");
  assert.ok(reports[0][1] instanceof Error);
  assert.ok(observedError instanceof Error);
  assert.is(observedError?.message, "boom");
});

test("invokeWithErrorBoundary swallows errors thrown by onError handlers", () => {
  const originalWarn = console.warn;
  const originalError = console.error;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };
  console.error = () => {};

  try {
    invokeWithErrorBoundary(
      () => {
        throw new Error("primary failure");
      },
      [],
      {
        onError: () => {
          throw new Error("onError failure");
        },
      },
    );
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }

  assert.is(warnings.length, 1);
  assert.is(warnings[0][0], "Error boundary onError handler threw; ignoring.");
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
  assert.is(toFiniteOrNull(Symbol("invalid")), null);
});
