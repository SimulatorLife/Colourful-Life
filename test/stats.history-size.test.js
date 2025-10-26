import { assert, test } from "#tests/harness";

const statsModulePromise = import("../src/stats.js");

test("Stats falls back to default history size when invalid value provided", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats("not-a-number");

  assert.equal(stats.historySize, 10000);

  stats.pushHistory("population", 42);
  stats.pushHistory("population", 43);

  assert.equal(stats.getHistorySeries("population"), [42, 43]);
  assert.equal(stats.history.population, [42, 43]);
});
