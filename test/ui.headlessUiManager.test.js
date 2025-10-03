import { assert, test } from "#tests/harness";
import { createHeadlessUiManager } from "../src/ui/headlessUiManager.js";

test("createHeadlessUiManager notifies observers only for sanitized updates", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  manager.setUpdatesPerSecond("not-a-number");
  manager.setUpdatesPerSecond(88.6);

  manager.setMatingDiversityThreshold("0.62");
  manager.setMatingDiversityThreshold("nan");

  manager.setLowDiversityReproMultiplier(-1);
  manager.setLowDiversityReproMultiplier("oops");

  manager.setCombatEdgeSharpness("nope");
  manager.setCombatEdgeSharpness(4.5);

  manager.setCombatTerritoryEdgeFactor("invalid");
  manager.setCombatTerritoryEdgeFactor(0.6);

  manager.setMaxConcurrentEvents(3.9);
  manager.setMaxConcurrentEvents(-2.2);
  manager.setMaxConcurrentEvents("invalid");

  manager.setEventFrequencyMultiplier(1.25);
  manager.setEventFrequencyMultiplier(-0.1);
  manager.setEventFrequencyMultiplier("oops");

  manager.setAutoPauseOnBlur(true);

  assert.equal(notifications, [
    ["updatesPerSecond", 89],
    ["matingDiversityThreshold", 0.62],
    ["lowDiversityReproMultiplier", 0],
    ["combatEdgeSharpness", 4.5],
    ["combatTerritoryEdgeFactor", 0.6],
    ["maxConcurrentEvents", 3],
    ["maxConcurrentEvents", 0],
    ["eventFrequencyMultiplier", 1.25],
    ["eventFrequencyMultiplier", 0],
    ["autoPauseOnBlur", true],
  ]);

  assert.is(manager.getUpdatesPerSecond(), 89);
  assert.is(manager.getMatingDiversityThreshold(), 0.62);
  assert.is(manager.getLowDiversityReproMultiplier(), 0);
  assert.is(manager.getCombatEdgeSharpness(), 4.5);
  assert.is(manager.getCombatTerritoryEdgeFactor(), 0.6);
  assert.is(manager.getMaxConcurrentEvents(), 0);
  assert.is(manager.getEventFrequencyMultiplier(), 0);
  assert.is(manager.getAutoPauseOnBlur(), true);
});

test("createHeadlessUiManager shouldRenderSlowUi enforces the cadence window", () => {
  const manager = createHeadlessUiManager({ leaderboardIntervalMs: 250 });

  assert.is(manager.shouldRenderSlowUi(""), false);
  assert.is(manager.shouldRenderSlowUi(Number.NaN), false);

  assert.is(manager.shouldRenderSlowUi(0), true);
  assert.is(manager.shouldRenderSlowUi(100), false);
  assert.is(manager.shouldRenderSlowUi(200), false);
  assert.is(manager.shouldRenderSlowUi(250), true);
  assert.is(manager.shouldRenderSlowUi(400), false);
  assert.is(manager.shouldRenderSlowUi(501), true);
});
