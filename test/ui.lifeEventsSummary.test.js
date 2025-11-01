import { assert, suite } from "#tests/harness";
import { MockCanvas, MockElement, setupDom } from "./helpers/mockDom.js";

if (!MockElement.prototype.hasChildNodes) {
  MockElement.prototype.hasChildNodes = function hasChildNodes() {
    return Array.isArray(this.children) && this.children.length > 0;
  };
}

MockCanvas.prototype.getContext = function getContext(type) {
  if (type !== "2d") return null;

  return {
    canvas: this,
    clearRect() {},
    moveTo() {},
    lineTo() {},
    beginPath() {},
    stroke() {},
    fillRect() {},
    strokeRect() {},
    save() {},
    restore() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText() {},
    strokeText() {},
    lineWidth: 1,
    strokeStyle: "#000",
  };
};

function openPanel(panel) {
  const header = panel?.querySelector?.(".panel-header");

  header?.trigger?.("click");
}

function stubCanvasElements({ width = 220, height = 48 } = {}) {
  const originalCreateElement = document.createElement.bind(document);

  document.createElement = (tagName) => {
    if (String(tagName).toLowerCase() === "canvas") {
      return new MockCanvas(width, height);
    }

    return originalCreateElement(tagName);
  };

  return () => {
    document.createElement = originalCreateElement;
  };
}

function createMetricsStatsFixture() {
  return {
    totals: { fights: 4, cooperations: 6 },
    history: {
      population: [100, 105, 110],
      diversity: [0.31, 0.33, 0.35],
      energy: [2.2, 2.3, 2.4],
      growth: [1, 2, 3],
      eventStrength: [1, 1, 1],
      mutationMultiplier: [1, 1, 1],
      diversePairingRate: [0.2, 0.25, 0.3],
      meanDiversityAppetite: [0.4, 0.45, 0.5],
    },
    traitPresence: {
      population: 120,
      counts: { cooperation: 80, fighting: 60, breeding: 40, sight: 90 },
      fractions: { cooperation: 0.66, fighting: 0.5, breeding: 0.33, sight: 0.75 },
    },
    traitHistory: {
      presence: {
        cooperation: [0.6, 0.62, 0.64],
        fighting: [0.4, 0.42, 0.44],
        breeding: [0.3, 0.31, 0.32],
        sight: [0.7, 0.72, 0.74],
      },
      average: {
        cooperation: [0.55, 0.56, 0.57],
        fighting: [0.35, 0.36, 0.37],
        breeding: [0.28, 0.29, 0.3],
        sight: [0.65, 0.66, 0.67],
      },
    },
    meanBehaviorComplementarity: 0.48,
    successfulBehaviorComplementarity: 0.6,
    meanStrategyPenalty: 0.85,
    meanStrategyPressure: 0.4,
    strategyPressure: 0.35,
    mateNoveltyPressure: 0.5,
    getRecentLifeEvents: () => [],
    getLifeEventRateSummary: () => ({
      births: 0,
      deaths: 0,
      net: 0,
      total: 0,
      window: 120,
      eventsPer100Ticks: 0,
    }),
  };
}

function createSnapshotFixture() {
  return {
    population: 140,
    births: 5,
    deaths: 3,
    growth: 2,
    mutationMultiplier: 1.1,
    meanEnergy: 3.5,
    meanAge: 9.8,
    diversity: 0.45,
    blockedMatings: 1,
    lastBlockedReproduction: null,
    mateChoices: 6,
    successfulMatings: 4,
    diverseChoiceRate: 0.3,
    diverseMatingRate: 0.4,
    meanDiversityAppetite: 0.5,
    curiositySelections: 2,
    behaviorEvenness: 0.6,
    meanBehaviorComplementarity: 0.52,
    successfulBehaviorComplementarity: 0.61,
    meanStrategyPenalty: 0.8,
    meanStrategyPressure: 0.45,
    strategyPressure: 0.33,
    mateNoveltyPressure: 0.54,
  };
}

function createLifeEventStatsFixture() {
  const base = createMetricsStatsFixture();

  return {
    ...base,
    deathBreakdown: {
      starvation: 5,
      obstacle: 3,
      combat: 2,
    },
    getRecentLifeEvents: () => [
      {
        type: "birth",
        tick: 410,
        row: 12,
        col: 6,
        energy: 4.2,
      },
      {
        type: "death",
        tick: 415,
        cause: "combat",
        row: 8,
        col: 3,
        energy: 2.4,
        opponentColor: "#ff6b6b",
      },
    ],
    getLifeEventRateSummary: () => ({
      births: 6,
      deaths: 4,
      net: 2,
      total: 10,
      window: 120,
      eventsPer100Ticks: 8.3,
      birthsPer100Ticks: 5,
      deathsPer100Ticks: 3.3,
    }),
  };
}

function createLeaderboardEntriesFixture() {
  return [
    {
      fitness: 12.5,
      color: "#a29bfe",
      brain: { fitness: 10.2, neuronCount: 128, connectionCount: 356 },
      offspring: 14,
      fightsWon: 9,
      age: 480,
    },
    {
      fitness: 11.1,
      color: "#74b9ff",
      brain: { fitness: 9.6, neuronCount: 110, connectionCount: 300 },
      offspring: 11,
      fightsWon: 6,
      age: 420,
    },
  ];
}

const test = suite("ui life events summary");

test("life event summary reflects rate window totals", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);
    openPanel(uiManager.lifeEventsPanel);

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
    restoreCanvas();
    restore();
  }
});

test("life event death breakdown surfaces leading causes", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);
    openPanel(uiManager.lifeEventsPanel);

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
    restoreCanvas();
    restore();
  }
});

test("life event death breakdown falls back to metrics payload", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);
    openPanel(uiManager.lifeEventsPanel);

    const stats = createLifeEventStatsFixture();

    delete stats.deathBreakdown;

    const metrics = {
      ...createSnapshotFixture(),
      deathBreakdown: {
        starvation: 3,
        combat: 1,
      },
    };

    uiManager.renderMetrics(stats, metrics, {
      eventStrengthMultiplier: 1,
      activeEvents: [],
    });

    assert.equal(
      uiManager.deathBreakdownList.hidden,
      false,
      "death breakdown should render when counts arrive via metrics",
    );

    const labels = Array.from(
      uiManager.deathBreakdownList.querySelectorAll(".death-breakdown-label"),
    ).map((node) => node.textContent);

    assert.include(
      labels,
      "Starvation",
      "metrics-provided causes should populate the breakdown list",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("life event death breakdown honours custom death cause colors", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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
      {
        canvasElement: new MockCanvas(400, 400),
        deathCauseColors: {
          Starvation: "rgb(10, 20, 30)",
          pandemic: "rgb(0, 255, 153)",
        },
      },
    );

    openPanel(uiManager.insightsPanel);
    openPanel(uiManager.lifeEventsPanel);

    const stats = createMetricsStatsFixture();

    stats.deathBreakdown = {
      starvation: 5,
      pandemic: 3,
      unclassified: 1,
    };
    stats.getRecentLifeEvents = () => [
      { type: "death", tick: 10, cause: "starvation" },
      { type: "death", tick: 11, cause: "pandemic" },
      { type: "death", tick: 12, cause: "unclassified" },
    ];
    stats.getLifeEventRateSummary = () => ({
      births: 4,
      deaths: 9,
      net: -5,
      total: 13,
      window: 120,
      eventsPer100Ticks: 10,
      birthsPer100Ticks: 3.3,
      deathsPer100Ticks: 7.5,
    });

    const snapshot = createSnapshotFixture();

    uiManager.renderMetrics(stats, snapshot, {
      eventStrengthMultiplier: 1,
      activeEvents: [],
    });

    const items = Array.from(
      uiManager.deathBreakdownList?.querySelectorAll(".death-breakdown-item") ?? [],
    );

    const colorByLabel = (label) => {
      const entry = items.find(
        (item) => item.querySelector(".death-breakdown-label")?.textContent === label,
      );

      return entry?.querySelector(".death-breakdown-fill")?.style.background ?? "";
    };

    assert.is(
      colorByLabel("Starvation"),
      "rgb(10, 20, 30)",
      "overrides should update existing cause colors",
    );
    assert.is(
      colorByLabel("Pandemic"),
      "rgb(0, 255, 153)",
      "new death causes should use the provided palette entry",
    );

    const fallbackColor = colorByLabel("Unclassified").toLowerCase();

    assert.ok(
      fallbackColor === "#e74c3c" || fallbackColor === "rgb(231, 76, 60)",
      "unknown causes should fall back to the default color",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("insights panel defers metrics work while collapsed", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    const initialChildCount = uiManager.metricsBox.children.length;
    const stats = createMetricsStatsFixture();
    const snapshot = createSnapshotFixture();
    const environment = { eventStrengthMultiplier: 1, activeEvents: [] };

    uiManager.renderMetrics(stats, snapshot, environment);

    assert.is(
      uiManager.metricsBox.children.length,
      initialChildCount,
      "collapsed panel should retain its placeholder",
    );
    assert.ok(
      uiManager._pendingMetrics,
      "collapsed panel should queue metrics payload",
    );

    openPanel(uiManager.insightsPanel);

    assert.ok(
      uiManager.metricsBox.children.length > initialChildCount,
      "expanding panel should render queued metrics",
    );
    assert.is(
      uiManager._pendingMetrics,
      null,
      "metrics queue should clear after flush",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("trait metrics render custom definitions", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);

    const stats = createMetricsStatsFixture();

    stats.traitDefinitions = [{ key: "cooperation" }, { key: "camouflage" }];
    stats.traitPresence = {
      population: 50,
      counts: { cooperation: 30, camouflage: 20 },
      fractions: { cooperation: 0.6, camouflage: 0.4 },
    };
    stats.traitHistory = {
      presence: { cooperation: [0.6], camouflage: [0.4] },
      average: { cooperation: [0.5], camouflage: [0.3] },
    };

    const snapshot = createSnapshotFixture();
    const environment = { eventStrengthMultiplier: 1, activeEvents: [] };

    uiManager.renderMetrics(stats, snapshot, environment);

    const traitBar = uiManager.metricsBox.querySelector(
      '.trait-bar-item[data-trait="camouflage"]',
    );
    const traitSpark = uiManager.insightsPanel.querySelector(
      '.sparkline-card[data-trait="camouflage"]',
    );

    assert.ok(traitBar, "custom trait should render in trait presence list");
    assert.ok(traitSpark, "custom trait should render sparkline card");
  } finally {
    restoreCanvas();
    restore();
  }
});

test("behavior balance meter announces evenness with accessible meter semantics", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);
    openPanel(uiManager.lifeEventsPanel);

    const stats = createMetricsStatsFixture();
    const snapshot = createSnapshotFixture();

    snapshot.behaviorEvenness = 0.83;

    uiManager.renderMetrics(stats, snapshot, {
      eventStrengthMultiplier: 1,
      activeEvents: [],
    });

    const balanceCard = uiManager.metricsBox.querySelector(".trait-balance");

    assert.ok(
      balanceCard,
      "Behavior Balance card should render when trait evenness data is available",
    );
    assert.is(
      balanceCard.classList.contains("trait-balance--empty"),
      false,
      "card should not render as empty when a population sample exists",
    );

    const value = balanceCard.querySelector(".trait-balance-value");

    assert.is(
      value?.textContent,
      "83% Balanced",
      "value label should reflect evenness",
    );
    assert.is(
      balanceCard.title,
      "Traits are evenly expressed across the population this tick. Normalized evenness 83%.",
      "tooltip should narrate the evenness description and normalized percent",
    );

    const summary = balanceCard.querySelector(".trait-balance-summary");

    assert.is(
      summary?.textContent,
      "Traits are evenly expressed across the population this tick.",
      "summary copy should describe the balanced state",
    );

    const meter = balanceCard.querySelector(".trait-balance-meter");

    assert.ok(meter, "meter element should be present for assistive tech");
    assert.is(
      meter?.getAttribute("role"),
      "meter",
      "meter should expose semantic role",
    );
    assert.is(
      meter?.getAttribute("aria-label"),
      "Behavior balance across traits",
      "aria-label should clarify what the meter represents",
    );
    assert.is(meter?.getAttribute("aria-valuemin"), "0", "aria-valuemin should be 0");
    assert.is(meter?.getAttribute("aria-valuemax"), "1", "aria-valuemax should be 1");
    assert.is(
      meter?.getAttribute("aria-valuenow"),
      "0.83",
      "aria-valuenow should match the normalized evenness",
    );
    assert.is(
      meter?.getAttribute("aria-valuetext"),
      "83% of behaviors are evenly distributed",
      "aria-valuetext should narrate the evenness percent",
    );

    const fill = meter?.querySelector(".trait-balance-fill");

    assert.is(
      fill?.style.width,
      "83%",
      "fill width should mirror the evenness percent",
    );
    assert.is(
      fill?.style.background,
      "#2ecc71",
      "balanced state should use the success palette color",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("population snapshot reports occupancy share", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    uiManager.gridRows = 4;
    uiManager.gridCols = 5;

    openPanel(uiManager.insightsPanel);

    const stats = createMetricsStatsFixture();
    const snapshot = { ...createSnapshotFixture(), population: 10 };
    const environment = { eventStrengthMultiplier: 1, activeEvents: [] };

    uiManager.renderMetrics(stats, snapshot, environment);

    const occupancyCard = uiManager.metricsBox.querySelector(
      "[data-metric-label='Occupancy']",
    );

    assert.ok(occupancyCard, "occupancy metric should be rendered");
    assert.is(
      occupancyCard?.querySelector?.(".metrics-stat-value")?.textContent?.trim(),
      "50%",
      "occupancy metric should display the occupied share as a percentage",
    );
    assert.match(
      occupancyCard?.getAttribute?.("title") ?? "",
      /10 of 20 tiles in use/,
      "occupancy tooltip should describe tiles in use",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("reproduction metrics highlight complementarity and pressure signals", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    openPanel(uiManager.insightsPanel);

    const stats = createMetricsStatsFixture();
    const snapshot = createSnapshotFixture();
    const environment = { eventStrengthMultiplier: 1, activeEvents: [] };

    uiManager.renderMetrics(stats, snapshot, environment);

    const sections = Array.from(
      uiManager.metricsBox.querySelectorAll(".metrics-section"),
    );
    const reproductionSection = sections.find((section) => {
      const heading = section.querySelector(".metrics-section-title");

      return heading?.textContent?.trim() === "Reproduction Trends";
    });

    assert.ok(reproductionSection, "should render the reproduction trends section");

    const labels = Array.from(
      reproductionSection.querySelectorAll(".metrics-stat-label"),
    ).map((node) => node.textContent.trim());

    assert.include(labels, "Avg Complementarity");
    assert.include(labels, "Successful Complementarity");
    assert.include(labels, "Strategy Penalty");
    assert.include(labels, "Strategy Pressure");
    assert.include(labels, "Global Pressure");
    assert.include(labels, "Novelty Pressure");

    const readValue = (label) => {
      const stat = Array.from(
        reproductionSection.querySelectorAll(".metrics-stat"),
      ).find(
        (node) =>
          node.querySelector(".metrics-stat-label")?.textContent.trim() === label,
      );

      return stat?.querySelector(".metrics-stat-value")?.textContent.trim();
    };

    assert.is(
      readValue("Avg Complementarity"),
      "52%",
      "should show mean complementarity",
    );
    assert.is(
      readValue("Successful Complementarity"),
      "61%",
      "should show successful complementarity",
    );
    assert.is(readValue("Strategy Penalty"), "80%", "should show average penalty");
    assert.is(readValue("Strategy Pressure"), "45%", "should show mean pressure");
    assert.is(
      readValue("Global Pressure"),
      "33%",
      "should show global pressure signal",
    );
    assert.is(
      readValue("Novelty Pressure"),
      "54%",
      "should show novelty pressure signal",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("life events only render after the panel expands", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    const stats = createLifeEventStatsFixture();
    const snapshot = createSnapshotFixture();

    uiManager.renderMetrics(stats, snapshot, {
      eventStrengthMultiplier: 1,
      activeEvents: [],
    });

    assert.is(
      uiManager.lifeEventList.children.length,
      0,
      "collapsed life events panel should not render entries",
    );
    assert.ok(
      uiManager._pendingLifeEventsStats,
      "life events stats should be cached while panel is collapsed",
    );
    assert.equal(
      uiManager._pendingLifeEventsStats?.stats,
      stats,
      "cached payload should retain original stats reference",
    );

    openPanel(uiManager.lifeEventsPanel);

    assert.ok(
      uiManager.lifeEventList.children.length > 0,
      "expanding panel should render queued life events",
    );
    assert.is(
      uiManager._pendingLifeEventsStats,
      null,
      "life events queue should clear after rendering",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});

test("leaderboard waits to render until expanded", async () => {
  const restore = setupDom();
  const restoreCanvas = stubCanvasElements();

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

    const entries = createLeaderboardEntriesFixture();

    uiManager.renderLeaderboard(entries);

    assert.ok(
      uiManager.leaderEntriesContainer,
      "leaderboard container should be created",
    );
    assert.is(
      uiManager.leaderEntriesContainer.children.length,
      0,
      "collapsed leaderboard should skip entry construction",
    );
    assert.equal(
      uiManager._pendingLeaderboardEntries,
      entries,
      "leaderboard entries should queue while collapsed",
    );

    openPanel(uiManager.leaderPanel);

    assert.ok(
      uiManager.leaderEntriesContainer.children.length > 0,
      "expanded leaderboard should render queued entries",
    );
    assert.is(
      uiManager._pendingLeaderboardEntries,
      null,
      "leaderboard queue should clear after rendering",
    );
  } finally {
    restoreCanvas();
    restore();
  }
});
