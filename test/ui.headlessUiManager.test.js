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

  manager.setLeaderboardIntervalMs(-1);
  manager.setLeaderboardIntervalMs("oops");
  manager.setLeaderboardIntervalMs(1250.4);

  manager.setEventFrequencyMultiplier(1.25);
  manager.setEventFrequencyMultiplier(-0.1);
  manager.setEventFrequencyMultiplier("oops");

  manager.setDensityEffectMultiplier(0.8);
  manager.setDensityEffectMultiplier(-1);
  manager.setDensityEffectMultiplier("oops");

  manager.setEnergyRegenRate(0.12);
  manager.setEnergyRegenRate(-0.3);

  manager.setEnergyDiffusionRate(0.45);
  manager.setEnergyDiffusionRate("oops");

  manager.setAutoPauseOnBlur(true);

  assert.equal(notifications, [
    ["updatesPerSecond", 89],
    ["matingDiversityThreshold", 0.62],
    ["lowDiversityReproMultiplier", 0],
    ["combatEdgeSharpness", 4.5],
    ["combatTerritoryEdgeFactor", 0.6],
    ["maxConcurrentEvents", 3],
    ["maxConcurrentEvents", 0],
    ["leaderboardIntervalMs", 0],
    ["leaderboardIntervalMs", 1250],
    ["eventFrequencyMultiplier", 1.25],
    ["eventFrequencyMultiplier", 0],
    ["densityEffectMultiplier", 0.8],
    ["densityEffectMultiplier", 0],
    ["energyRegenRate", 0.12],
    ["energyRegenRate", 0],
    ["energyDiffusionRate", 0.45],
    ["autoPauseOnBlur", true],
  ]);

  assert.is(manager.getUpdatesPerSecond(), 89);
  assert.is(manager.getMatingDiversityThreshold(), 0.62);
  assert.is(manager.getLowDiversityReproMultiplier(), 0);
  assert.is(manager.getCombatEdgeSharpness(), 4.5);
  assert.is(manager.getCombatTerritoryEdgeFactor(), 0.6);
  assert.is(manager.getMaxConcurrentEvents(), 0);
  assert.is(manager.getLeaderboardIntervalMs(), 1250);
  assert.is(manager.getEventFrequencyMultiplier(), 0);
  assert.is(manager.getDensityEffectMultiplier(), 0);
  assert.is(manager.getEnergyRegenRate(), 0);
  assert.is(manager.getEnergyDiffusionRate(), 0.45);
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

  manager.setLeaderboardIntervalMs(500);
  assert.is(manager.getLeaderboardIntervalMs(), 500);
  assert.is(manager.shouldRenderSlowUi(750), false);
  assert.is(manager.shouldRenderSlowUi(1001), true);
});

test("createHeadlessUiManager exposes leaderboard cadence controls", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    leaderboardIntervalMs: 400,
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  assert.is(manager.getLeaderboardIntervalMs(), 400);

  manager.setLeaderboardIntervalMs(-50);
  manager.setLeaderboardIntervalMs("oops");
  manager.setLeaderboardIntervalMs(1200);

  assert.equal(notifications, [
    ["leaderboardIntervalMs", 0],
    ["leaderboardIntervalMs", 1200],
  ]);

  assert.is(manager.getLeaderboardIntervalMs(), 1200);

  assert.is(manager.shouldRenderSlowUi(0), true);
  assert.is(manager.shouldRenderSlowUi(100), false);
  manager.setLeaderboardIntervalMs(50);
  assert.is(manager.shouldRenderSlowUi(120), true);
});

test("createHeadlessUiManager allows adjusting the event strength multiplier", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    eventStrengthMultiplier: 1.1,
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  assert.type(manager.setEventStrengthMultiplier, "function");

  manager.setEventStrengthMultiplier(-1);
  manager.setEventStrengthMultiplier("oops");
  manager.setEventStrengthMultiplier(2.4);

  assert.equal(notifications, [
    ["eventStrengthMultiplier", 0],
    ["eventStrengthMultiplier", 2.4],
  ]);
  assert.is(manager.getEventStrengthMultiplier(), 2.4);
});

test("createHeadlessUiManager allows adjusting the mutation multiplier", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    mutationMultiplier: 0.75,
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  assert.type(manager.setMutationMultiplier, "function");

  manager.setMutationMultiplier(-1);
  manager.setMutationMultiplier("oops");
  manager.setMutationMultiplier(1.5);

  assert.equal(notifications, [
    ["mutationMultiplier", 0],
    ["mutationMultiplier", 1.5],
  ]);
  assert.is(manager.getMutationMultiplier(), 1.5);
});

test("createHeadlessUiManager exposes overlay visibility toggles", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    showObstacles: false,
    showEnergy: true,
    showDensity: false,
    showFitness: false,
    showLifeEventMarkers: true,
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  assert.is(manager.getShowObstacles(), false);
  assert.is(manager.getShowEnergy(), true);
  assert.is(manager.getShowDensity(), false);
  assert.is(manager.getShowFitness(), false);
  assert.is(manager.getShowLifeEventMarkers(), true);

  manager.setShowObstacles("true");
  manager.setShowObstacles(true); // should not notify again

  manager.setShowEnergy("false");
  manager.setShowEnergy(0); // no change

  manager.setShowDensity("1");

  manager.setShowFitness("yes");

  manager.setShowLifeEventMarkers("no");
  manager.setShowLifeEventMarkers(false); // no change

  assert.equal(notifications, [
    ["showObstacles", true],
    ["showEnergy", false],
    ["showDensity", true],
    ["showFitness", true],
    ["showLifeEventMarkers", false],
  ]);

  assert.is(manager.getShowObstacles(), true);
  assert.is(manager.getShowEnergy(), false);
  assert.is(manager.getShowDensity(), true);
  assert.is(manager.getShowFitness(), true);
  assert.is(manager.getShowLifeEventMarkers(), false);
});

test("createHeadlessUiManager setAutoPauseOnBlur normalizes string inputs", () => {
  const notifications = [];
  const manager = createHeadlessUiManager({
    onSettingChange: (key, value) => notifications.push([key, value]),
  });

  assert.is(manager.getAutoPauseOnBlur(), false);

  manager.setAutoPauseOnBlur("true");
  assert.is(manager.getAutoPauseOnBlur(), true);

  manager.setAutoPauseOnBlur("false");
  assert.is(manager.getAutoPauseOnBlur(), false);

  manager.setAutoPauseOnBlur("1");
  manager.setAutoPauseOnBlur("0");

  assert.equal(notifications, [
    ["autoPauseOnBlur", true],
    ["autoPauseOnBlur", false],
    ["autoPauseOnBlur", true],
    ["autoPauseOnBlur", false],
  ]);
});
