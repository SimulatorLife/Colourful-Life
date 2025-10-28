import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

const statsModulePromise = import("../src/stats/index.js");

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

test("life event helpers reuse fallback cell data when context is provided first", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();
  const cell = {
    dna: { toColor: () => "#abc" },
    energy: 5,
    interactionGenes: {},
  };

  stats.onDeath({ row: 3, col: 4 }, cell);

  const [event] = stats.getRecentLifeEvents(1);

  assert.equal(event.color, "#abc", "uses the secondary cell to resolve color");
  assert.is(event.energy, 5, "uses the secondary cell to resolve energy");
  assert.is(event.row, 3);
  assert.is(event.col, 4);
});

test("life event payload trims context strings and falls back to cell data", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();
  const cell = {
    color: " ",
    dna: { toColor: () => "  #def  " },
    interactionGenes: { cooperate: 0.7 },
  };
  const context = {
    color: "   ",
    opponentColor: "  #123  ",
    note: "   ",
    cause: "  ",
    parents: ["#456", "  ", "  #789  "],
  };

  stats.onDeath(context, cell);

  const [event] = stats.getRecentLifeEvents(1);

  assert.equal(event.color, "#def", "falls back to the resolved cell color");
  assert.equal(event.cause, "death", "uses event type when cause is blank");
  assert.equal(event.opponentColor, "#123", "trims opponent color inputs");
  assert.equal(event.parents, ["#456", "#789"], "filters empty parent colors");
  assert.is("note" in event, false, "drops whitespace-only notes");
});

test("life event payload surfaces genome summary when cell data is present", async () => {
  const { default: Stats } = await statsModulePromise;
  const stats = new Stats();
  const cell = {
    dna: { toColor: () => "#abc" },
    brain: { neuronCount: 128, connectionCount: 420 },
    neurons: 128,
    sight: 4.2,
    metabolicProfile: {
      baseline: 0.82,
      neuralDrag: 0.41,
      crowdingTax: 0.19,
      neuralSignature: 0.57,
    },
    strategy: 0.58,
    diversityAppetite: 0.71,
    matePreferenceBias: -0.33,
    interactionGenes: {},
  };

  stats.onBirth(cell);

  const [event] = stats.getRecentLifeEvents(1);

  assert.ok(event.genome, "life event should include genome summary payload");
  assert.equal(event.genome.neurons, 128);
  assert.equal(event.genome.connections, 420);
  assert.equal(event.genome.sight, 4.2);
  assert.equal(event.genome.strategy, { value: 0.58 });
  assert.equal(event.genome.diversityAppetite, 0.71);
  assert.equal(event.genome.matePreferenceBias, -0.33);
  assert.equal(event.genome.metabolism, {
    baseline: 0.82,
    neuralDrag: 0.41,
    crowdingTax: 0.19,
    neuralSignature: 0.57,
  });
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
