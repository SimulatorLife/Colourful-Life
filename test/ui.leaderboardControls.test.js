import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui leaderboard cadence controls");

test("leaderboard panel exposes dashboard cadence slider", async () => {
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

    const slider = findSliderByLabel(
      uiManager.leaderPanel,
      "Dashboard Refresh Interval",
    );

    assert.ok(slider, "leaderboard should surface dashboard cadence slider");
    assert.is(slider.value, String(uiManager.leaderboardIntervalMs));

    const insightsSlider = findSliderByLabel(
      uiManager.insightsPanel,
      "Dashboard Refresh Interval",
    );

    assert.is(
      insightsSlider,
      null,
      "evolution insights should no longer host the cadence slider",
    );

    const nextValue = uiManager.leaderboardIntervalMs + 250;

    slider.value = String(nextValue);
    slider.trigger("input");

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
