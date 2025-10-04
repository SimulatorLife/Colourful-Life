import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

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

test("getLifeEventRateSummary captures windowed birth/death cadence", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.totals.ticks = 90;
  stats.onBirth({ color: "#abc" });
  stats.totals.ticks = 120;
  stats.onDeath({ color: "#def" });
  stats.totals.ticks = 140;
  stats.onBirth({ color: "#ghi" });
  stats.totals.ticks = 150;

  const summary = stats.getLifeEventRateSummary(60);

  assert.equal(summary.births, 2, "counts births within window");
  assert.equal(summary.deaths, 1, "counts deaths within window");
  assert.equal(summary.net, 1, "computes net change");
  assert.equal(summary.total, 3, "reports total events");
  approxEqual(summary.eventsPer100Ticks, 5, 0.001);
  approxEqual(summary.birthsPer100Ticks, (2 / 60) * 100, 0.001);
  approxEqual(summary.deathsPer100Ticks, (1 / 60) * 100, 0.001);
});

test("getLifeEventRateSummary returns zeros for invalid input", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  const summary = stats.getLifeEventRateSummary(-5);

  assert.equal(summary, {
    births: 0,
    deaths: 0,
    net: 0,
    total: 0,
    window: 0,
    eventsPer100Ticks: 0,
    birthsPer100Ticks: 0,
    deathsPer100Ticks: 0,
  });
});

test("getLifeEventRateSummary spans quiet periods within the window", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.totals.ticks = 100;
  stats.onBirth({ color: "#123" });
  stats.totals.ticks = 150;

  const summary = stats.getLifeEventRateSummary(100);

  assert.is(summary.window, 100);
  approxEqual(summary.eventsPer100Ticks, 1, 1e-9);
  approxEqual(summary.birthsPer100Ticks, 1, 1e-9);
  approxEqual(summary.deathsPer100Ticks, 0, 1e-9);
});

test("getLifeEventTimeline aggregates births and deaths per tick", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();

  stats.totals.ticks = 10;
  stats.onBirth({ color: "#abc" });
  stats.totals.ticks = 11;
  stats.onBirth({ color: "#def" });
  stats.totals.ticks = 12;
  stats.onDeath({ color: "#123" });
  stats.totals.ticks = 13;

  const timeline = stats.getLifeEventTimeline(4);

  assert.equal(timeline.ticks, [10, 11, 12, 13], "spans the requested window");
  assert.equal(
    timeline.births,
    [1, 1, 0, 0],
    "counts births for each tick within the window",
  );
  assert.equal(
    timeline.deaths,
    [0, 0, 1, 0],
    "counts deaths for each tick within the window",
  );
  assert.is(timeline.window, 4, "retains requested window size");
  assert.is(timeline.span, 4, "reports the number of ticks returned");
});
