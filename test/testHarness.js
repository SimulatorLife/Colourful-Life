import {
  test as nodeTest,
  describe as nodeDescribe,
  before as nodeBefore,
  after as nodeAfter,
  beforeEach as nodeBeforeEach,
  afterEach as nodeAfterEach,
} from "node:test";
import assertModule from "node:assert/strict";

if (typeof globalThis.window === "undefined") {
  globalThis.window = globalThis;
}

function formatMessage(message, fallback) {
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  return fallback;
}

function createAssert(base) {
  const is = (actual, expected, message) => {
    base.strictEqual(actual, expected, message);
  };

  is.not = (actual, expected, message) => {
    base.notStrictEqual(actual, expected, message);
  };

  const assert = {
    ...base,
    is,
    equal(actual, expected, message) {
      base.deepStrictEqual(actual, expected, message);
    },
    type(actual, expectedType, message) {
      const actualType = typeof actual;

      base.strictEqual(
        actualType,
        expectedType,
        formatMessage(message, `Expected type ${expectedType}, received ${actualType}`),
      );
    },
    instance(actual, expectedConstructor, message) {
      base.ok(
        actual instanceof expectedConstructor,
        formatMessage(
          message,
          `Expected value to be instance of ${expectedConstructor?.name ?? "<unknown>"}`,
        ),
      );
    },
    match(actual, expected, message) {
      if (expected instanceof RegExp) {
        base.match(actual, expected, message);

        return;
      }

      const haystack = typeof actual === "string" ? actual : String(actual);
      const needle = typeof expected === "string" ? expected : String(expected);

      base.ok(
        haystack.includes(needle),
        formatMessage(
          message,
          `Expected ${JSON.stringify(haystack)} to include ${JSON.stringify(needle)}`,
        ),
      );
    },
    unreachable(message = "Expected code path to be unreachable") {
      base.fail(message);
    },
    not: {
      ok(value, message) {
        base.ok(!value, formatMessage(message, "Expected value to be falsy"));
      },
      equal(actual, expected, message) {
        base.notDeepStrictEqual(actual, expected, message);
      },
      throws(fn, expected, message) {
        base.doesNotThrow(fn, expected, message);
      },
    },
  };

  return assert;
}

const assert = createAssert(assertModule);

function wrapTestFunction(fn) {
  return function (title, optionsOrFn, maybeFn) {
    if (typeof optionsOrFn === "function" || optionsOrFn == null) {
      return fn(title, optionsOrFn);
    }

    return fn(title, optionsOrFn, maybeFn);
  };
}

function createTest() {
  const callable = wrapTestFunction(nodeTest);

  callable.skip = wrapTestFunction(nodeTest.skip.bind(nodeTest));
  callable.only = wrapTestFunction(nodeTest.only.bind(nodeTest));
  callable.todo = wrapTestFunction(nodeTest.todo.bind(nodeTest));

  callable.before = (fn) => nodeBefore(fn);
  callable.after = (fn) => nodeAfter(fn);
  callable.before.each = (fn) => nodeBeforeEach(fn);
  callable.after.each = (fn) => nodeAfterEach(fn);

  return callable;
}

export const test = createTest();

export function suite(name) {
  const registrations = [];
  const hooks = {
    before: [],
    after: [],
    beforeEach: [],
    afterEach: [],
  };

  const register = wrapTestFunction((title, optionsOrFn, maybeFn) => {
    registrations.push({ title, optionsOrFn, maybeFn });
  });

  register.before = (fn) => {
    hooks.before.push(fn);
  };
  register.after = (fn) => {
    hooks.after.push(fn);
  };
  register.before.each = (fn) => {
    hooks.beforeEach.push(fn);
  };
  register.after.each = (fn) => {
    hooks.afterEach.push(fn);
  };

  register.run = () => {
    nodeDescribe(name, () => {
      hooks.before.forEach((fn) => nodeBefore(fn));
      hooks.after.forEach((fn) => nodeAfter(fn));
      hooks.beforeEach.forEach((fn) => nodeBeforeEach(fn));
      hooks.afterEach.forEach((fn) => nodeAfterEach(fn));

      registrations.forEach(({ title, optionsOrFn, maybeFn }) => {
        test(title, optionsOrFn, maybeFn);
      });
    });
  };

  return register;
}

export const before = nodeBefore;
export const after = nodeAfter;
export const beforeEach = nodeBeforeEach;
export const afterEach = nodeAfterEach;
export { assert };
