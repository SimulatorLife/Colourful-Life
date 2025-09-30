import * as assert from 'uvu/assert';

/**
 * Asserts that two numeric values are approximately equal within the provided
 * tolerance. Mirrors existing ad-hoc helpers while providing consistent error
 * messaging across the test suite.
 *
 * @param {number} actual - Observed value.
 * @param {number} expected - Target value.
 * @param {number} [tolerance=1e-6] - Maximum allowed absolute difference.
 * @param {string} [message] - Optional override message for assertion failure.
 */
export function approxEqual(actual, expected, tolerance = 1e-6, message) {
  const difference = Math.abs(actual - expected);

  assert.ok(
    difference <= tolerance,
    message ?? `Expected ${expected} ±${tolerance}, received ${actual} (|Δ|=${difference})`
  );
}
