import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";

function openPanel(panel) {
  const header = panel?.querySelector?.(".panel-header");

  header?.trigger?.("click");
}

const test = suite("ui leaderboard accessibility");

test("leaderboard entries announce accessible summaries", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
      },
      "#app",
    );

    const entries = [
      {
        fitness: 18.4321,
        brain: { fitness: 12.9, neuronCount: 144, connectionCount: 360 },
        offspring: 17,
        fightsWon: 8,
        age: 612,
      },
      {
        fitness: Number.NaN,
        brain: { fitness: null, neuronCount: 0, connectionCount: 0 },
        offspring: Number.NaN,
        fightsWon: 0,
        age: 0,
      },
    ];

    uiManager.renderLeaderboard(entries);
    openPanel(uiManager.leaderPanel);

    const container = uiManager.leaderEntriesContainer;

    assert.ok(container, "leaderboard container should exist");
    assert.is(container.getAttribute("role"), "list");
    assert.is(container.getAttribute("aria-live"), "polite");
    assert.is(
      container.getAttribute("aria-label"),
      "Top organisms ranked by overall fitness",
      "container should describe the leaderboard entries",
    );
    assert.is(container.getAttribute("aria-busy"), "false");

    assert.is(container.children.length, 2, "each entry should render as a list item");

    const [first, second] = container.children;

    assert.is(first.getAttribute("role"), "listitem");
    assert.is(first.tabIndex, 0, "entries should be keyboard focusable");
    assert.ok(
      first.classList.contains("leaderboard-entry--top"),
      "top entry should receive highlight styling",
    );
    assert.match(
      first.getAttribute("aria-label"),
      /Rank 1 organism with fitness 18\.43/,
      "aria label should announce the rank and fitness",
    );

    const firstSummaryValue = first.querySelector(".leaderboard-summary-value");

    assert.ok(firstSummaryValue, "summary value should render inside the entry");
    assert.is(firstSummaryValue.textContent, "18.43");

    const firstStats = first.querySelector(".leaderboard-stats");

    assert.ok(firstStats, "leaderboard stats should render detail rows");
    assert.is(firstStats.children.length, 3, "all detail stats should be present");

    const secondSummaryValue = second.querySelector(".leaderboard-summary-value");

    assert.ok(secondSummaryValue, "second entry should render summary value");
    assert.is(
      secondSummaryValue.textContent,
      "—",
      "non-finite fitness should fall back to an em dash",
    );
    assert.match(
      second.getAttribute("aria-label"),
      /Rank 2 organism with fitness —/,
      "second entry label should describe missing fitness",
    );
  } finally {
    restore();
  }
});

test("leaderboard empty state guides users to run the simulation", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
      },
      "#app",
    );

    uiManager.renderLeaderboard([]);
    openPanel(uiManager.leaderPanel);

    const container = uiManager.leaderEntriesContainer;

    assert.ok(container, "leaderboard container should exist");
    assert.is(
      container.children.length,
      1,
      "empty state should render as a single list item",
    );

    const emptyState = container.children[0];

    assert.is(emptyState.className, "leaderboard-empty-state");
    assert.is(emptyState.getAttribute("role"), "listitem");
    assert.match(
      emptyState.textContent,
      /Run the simulation to populate the leaderboard\./,
      "empty state should encourage starting the simulation",
    );
  } finally {
    restore();
  }
});

test.run();
