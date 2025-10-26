import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui leaderboard cadence controls");

test("dashboard settings panel exposes dashboard cadence slider", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const settingChanges = [];

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        onSettingChange: (key, value) => {
          settingChanges.push([key, value]);
        },
      },
      "#app",
      {},
      {},
    );

    uiManager.renderLeaderboard([]);

    const settingsPanel = uiManager.dashboardSettingsPanel;

    assert.ok(
      settingsPanel,
      "dashboard settings panel should be constructed when cadence config exists",
    );

    const settingsSlider = findSliderByLabel(
      settingsPanel,
      "Dashboard Refresh Interval",
    );

    assert.ok(
      settingsSlider,
      "dashboard settings should surface dashboard cadence slider",
    );
    assert.is(
      settingsSlider.value,
      String(uiManager.leaderboardIntervalMs),
      "slider should reflect current cadence",
    );

    const insightsSlider = findSliderByLabel(
      uiManager.insightsPanel,
      "Dashboard Refresh Interval",
    );

    assert.is(
      insightsSlider,
      null,
      "evolution insights panel should no longer host the cadence slider",
    );

    const leaderboardSlider = findSliderByLabel(
      uiManager.leaderPanel,
      "Dashboard Refresh Interval",
    );

    assert.is(
      leaderboardSlider,
      null,
      "leaderboard panel should no longer host the cadence slider",
    );

    const nextValue = uiManager.leaderboardIntervalMs + 250;

    settingsSlider.value = String(nextValue);
    settingsSlider.trigger("input");

    assert.is(
      uiManager.leaderboardIntervalMs,
      nextValue,
      "slider input should update cadence value",
    );
    assert.equal(settingChanges[settingChanges.length - 1], [
      "leaderboardIntervalMs",
      nextValue,
    ]);
  } finally {
    restore();
  }
});

test.run();
