import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui life events summary");

test("life event summary reflects rate window totals", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        getCellSize: () => 5,
      },
      { canvasElement: new MockCanvas(400, 400) },
    );

    const events = [
      { type: "birth", tick: 101 },
      { type: "birth", tick: 102 },
      { type: "death", tick: 103 },
    ];

    const rateSummary = {
      births: 18,
      deaths: 26,
      net: -8,
      total: 44,
      window: 120,
      eventsPer100Ticks: 14.5,
      birthsPer100Ticks: 8.2,
      deathsPer100Ticks: 6.3,
    };

    const stats = {
      totals: { fights: 0, cooperations: 0 },
      history: {
        population: [],
        diversity: [],
        energy: [],
        growth: [],
        eventStrength: [],
        mutationMultiplier: [],
        diversePairingRate: [],
        meanDiversityAppetite: [],
      },
      traitPresence: {
        population: 0,
        counts: { cooperation: 0, fighting: 0, breeding: 0, sight: 0 },
        fractions: { cooperation: 0, fighting: 0, breeding: 0, sight: 0 },
      },
      traitHistory: {},
      getRecentLifeEvents: () => events,
      getLifeEventRateSummary: () => rateSummary,
    };

    const snapshot = {
      population: 100,
      births: 4,
      deaths: 2,
      growth: 2,
      mutationMultiplier: 1,
      meanEnergy: 3.4,
      meanAge: 12.1,
      diversity: 0.42,
      blockedMatings: 1,
      lastBlockedReproduction: null,
      mateChoices: 5,
      successfulMatings: 3,
      diverseChoiceRate: 0.25,
      diverseMatingRate: 0.5,
      meanDiversityAppetite: 0.4,
      curiositySelections: 2,
      behaviorEvenness: 0.7,
    };

    const environment = { eventStrengthMultiplier: 1, activeEvents: [] };

    uiManager.renderMetrics(stats, snapshot, environment);

    assert.is(
      uiManager.lifeEventsSummaryBirthCount.textContent,
      String(rateSummary.births),
      "birth summary should reflect rate window totals",
    );
    assert.is(
      uiManager.lifeEventsSummaryDeathCount.textContent,
      String(rateSummary.deaths),
      "death summary should reflect rate window totals",
    );
    assert.is(
      uiManager.lifeEventsSummaryNet.textContent,
      String(rateSummary.net),
      "net change should mirror summary net value",
    );
    assert.is(
      uiManager.lifeEventsSummaryRate.textContent,
      `≈${rateSummary.eventsPer100Ticks.toFixed(1)} events / 100 ticks`,
      "rate label should use rate summary cadence",
    );
  } finally {
    restore();
  }
});

test("life event death breakdown surfaces leading causes", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        getCellSize: () => 5,
      },
      { canvasElement: new MockCanvas(400, 400) },
    );

    const events = [
      { type: "death", tick: 200, cause: "starvation" },
      { type: "birth", tick: 201 },
      { type: "death", tick: 202, cause: "combat" },
    ];

    const rateSummary = {
      births: 4,
      deaths: 12,
      net: -8,
      total: 16,
      window: 120,
      eventsPer100Ticks: 10.2,
      birthsPer100Ticks: 3.4,
      deathsPer100Ticks: 6.8,
    };

    const stats = {
      totals: { fights: 0, cooperations: 0 },
      history: {
        population: [],
        diversity: [],
        energy: [],
        growth: [],
        eventStrength: [],
        mutationMultiplier: [],
        diversePairingRate: [],
        meanDiversityAppetite: [],
      },
      traitPresence: {
        population: 0,
        counts: { cooperation: 0, fighting: 0, breeding: 0, sight: 0 },
        fractions: { cooperation: 0, fighting: 0, breeding: 0, sight: 0 },
      },
      traitHistory: {},
      deathBreakdown: {
        starvation: 5,
        obstacle: 3,
        combat: 2,
        reproduction: 1,
        seed: 1,
      },
      getRecentLifeEvents: () => events,
      getLifeEventRateSummary: () => rateSummary,
    };

    const snapshot = {
      population: 80,
      births: 2,
      deaths: 3,
      growth: -1,
      mutationMultiplier: 1,
      meanEnergy: 2.1,
      meanAge: 8.5,
      diversity: 0.31,
      blockedMatings: 0,
      lastBlockedReproduction: null,
      mateChoices: 2,
      successfulMatings: 1,
      diverseChoiceRate: 0.25,
      diverseMatingRate: 0.5,
      meanDiversityAppetite: 0.4,
      curiositySelections: 1,
      behaviorEvenness: 0.4,
    };

    uiManager.renderMetrics(stats, snapshot, {
      eventStrengthMultiplier: 1,
      activeEvents: [],
    });

    assert.ok(uiManager.deathBreakdownList, "death breakdown list should be available");
    assert.equal(
      uiManager.deathBreakdownList.hidden,
      false,
      "death breakdown should be visible when counts are supplied",
    );
    const items = uiManager.deathBreakdownList.querySelectorAll(
      ".death-breakdown-item",
    );

    assert.equal(
      items.length,
      5,
      "should render top causes plus an 'Other causes' bucket",
    );
    const topLabel = items[0]?.querySelector(".death-breakdown-label")?.textContent;

    assert.is(topLabel, "Starvation", "highest death cause should surface first");

    const otherLabel = items[items.length - 1]?.querySelector(
      ".death-breakdown-label",
    )?.textContent;

    assert.is(
      otherLabel,
      "Other causes",
      "remaining categories should collapse into an 'Other' row",
    );

    const meter = items[0]?.querySelector(".death-breakdown-meter");

    assert.is(
      meter?.getAttribute("aria-valuenow"),
      "0.42",
      "aria-valuenow should reflect share of deaths for the top cause",
    );
  } finally {
    restore();
  }
});
