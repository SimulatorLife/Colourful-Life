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
