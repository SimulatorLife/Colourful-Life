import { assert, test } from "#tests/harness";

const statsModulePromise = import("../src/stats/index.js");

test("FixedSizeRingBuffer.takeLast clamps limits via sanitizeNumber", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats(10);
  const ring = stats.lifeEventLog;

  ring.push(1);
  ring.push(2);
  ring.push(3);
  ring.push(4);

  assert.equal(ring.takeLast(2), [4, 3]);
  assert.equal(ring.takeLast(-5), []);
  assert.equal(ring.takeLast(2.8), [4, 3]);
  assert.equal(ring.takeLast("invalid"), [4, 3, 2, 1]);
  assert.equal(ring.takeLast(99), [4, 3, 2, 1]);
});
