import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui leaderboard cadence controls");

test("simulation controls panel hosts the dashboard cadence slider", async () => {
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

    const controlsSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Dashboard Refresh Interval",
    );

    assert.ok(
      controlsSlider,
      "simulation controls should surface the dashboard cadence slider",
    );
    assert.is(
      controlsSlider.value,
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

    const nextValue = uiManager.leaderboardIntervalMs + 250;

    controlsSlider.value = String(nextValue);
    controlsSlider.trigger("input");

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
