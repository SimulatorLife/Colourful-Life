import { assert, test } from "#tests/harness";

const statsModulePromise = import("../src/stats.js");

test("getRecentLifeEvents returns empty array for non-positive limits", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.onBirth({ color: "#abc" });
  stats.onBirth({ color: "#def" });

  assert.equal(stats.getRecentLifeEvents(0), []);
  assert.equal(stats.getRecentLifeEvents(-3), []);
  assert.equal(stats.getRecentLifeEvents("0"), []);
});

test("getRecentLifeEvents returns the most recent events up to the requested limit", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.onBirth({ color: "#111" });
  stats.onBirth({ color: "#222" });
  stats.onBirth({ color: "#333" });

  const recent = stats.getRecentLifeEvents(2);

  assert.is(recent.length, 2);
  assert.equal(
    recent.map((event) => event.color),
    ["#333", "#222"],
    "returns newest events first",
  );
});
