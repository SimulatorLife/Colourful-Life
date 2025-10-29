import { assert, suite } from "#tests/harness";

const test = suite("ui simulation ui bridge initial settings");

test("layout initial settings override sanitized defaults", async () => {
  const { bindSimulationToUi } = await import("../src/ui/simulationUiBridge.js");
  const { resolveSimulationDefaults } = await import("../src/config.js");

  const sanitizedDefaults = resolveSimulationDefaults({
    showEnergy: false,
    paused: false,
  });

  const engineStub = { canvas: {}, selectionManager: null };

  const { layout } = bindSimulationToUi({
    engine: engineStub,
    uiOptions: {
      layout: {
        initialSettings: {
          showEnergy: true,
          paused: true,
        },
      },
    },
    sanitizedDefaults,
    simulationCallbacks: {},
    headless: true,
  });

  assert.is(
    layout.initialSettings.showEnergy,
    true,
    "layout overrides should enable the energy overlay",
  );
  assert.is(
    layout.initialSettings.paused,
    true,
    "layout overrides should start the simulation paused",
  );
});

test("sanitized defaults survive layout overrides when values are invalid", async () => {
  const { bindSimulationToUi } = await import("../src/ui/simulationUiBridge.js");
  const { resolveSimulationDefaults } = await import("../src/config.js");

  const sanitizedDefaults = resolveSimulationDefaults({
    eventFrequencyMultiplier: "  ",
    leaderboardIntervalMs: "80",
    autoPauseOnBlur: "YES",
  });

  const { layout } = bindSimulationToUi({
    engine: { canvas: {}, selectionManager: null },
    uiOptions: {
      layout: {
        initialSettings: {
          eventFrequencyMultiplier: "  ",
          leaderboardIntervalMs: "80",
          autoPauseOnBlur: "YES",
        },
      },
    },
    sanitizedDefaults,
    simulationCallbacks: {},
    headless: true,
  });

  assert.is(
    layout.initialSettings.eventFrequencyMultiplier,
    sanitizedDefaults.eventFrequencyMultiplier,
    "event multiplier should reflect the sanitized fallback",
  );
  assert.is(
    layout.initialSettings.leaderboardIntervalMs,
    sanitizedDefaults.leaderboardIntervalMs,
    "leaderboard cadence should apply the minimum interval floor",
  );
  assert.is(
    layout.initialSettings.autoPauseOnBlur,
    sanitizedDefaults.autoPauseOnBlur,
    "boolean overrides should be coerced before reaching layout consumers",
  );
});
test.run();
