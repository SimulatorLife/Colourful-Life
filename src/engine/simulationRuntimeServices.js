import Stats from "../stats.js";
import TelemetryController from "./telemetryController.js";
import { computeLeaderboard as defaultComputeLeaderboard } from "./leaderboard.js";

function defineTelemetryAccessors(target, telemetry) {
  if (!target || typeof target !== "object") {
    return;
  }

  Object.defineProperties(target, {
    pendingSlowUiUpdate: {
      configurable: true,
      enumerable: false,
      get: () => telemetry.hasPending(),
      set: (value) => {
        if (value) {
          telemetry.markPending();
        } else {
          telemetry.clearPending();
        }
      },
    },
    lastSnapshot: {
      configurable: true,
      enumerable: false,
      get: () => telemetry.snapshot,
    },
    lastMetrics: {
      configurable: true,
      enumerable: false,
      get: () => telemetry.metrics,
    },
    lastSlowUiRender: {
      configurable: true,
      enumerable: false,
      get: () => telemetry.getLastEmissionTimestamp(),
      set: (value) => {
        telemetry.resetThrottle(value);
      },
    },
    lastRenderStats: {
      configurable: true,
      enumerable: false,
      get: () => telemetry.metrics?.rendering ?? null,
    },
  });
}

export function createSimulationRuntimeServices({
  rng,
  computeLeaderboard = defaultComputeLeaderboard,
  leaderboardSize,
  now,
} = {}) {
  const stats = new Stats(undefined, { rng });
  const telemetry = new TelemetryController({
    stats,
    computeLeaderboard,
    leaderboardSize,
    now,
  });

  return {
    stats,
    telemetry,
    attachTo(target) {
      defineTelemetryAccessors(target, telemetry);
    },
  };
}

export default createSimulationRuntimeServices;
