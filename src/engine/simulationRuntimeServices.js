import Stats from "../stats.js";
import TelemetryController from "./telemetryController.js";
import { computeLeaderboard as defaultComputeLeaderboard } from "./leaderboard.js";

/**
 * Adds lazily-evaluated telemetry accessors onto the provided target. The
 * accessors are non-enumerable so existing iteration behaviour remains
 * unchanged while consumers gain convenient getters for the latest telemetry
 * snapshot.
 *
 * @param {object} target - Host object that should expose telemetry metadata.
 *   Calls with non-object inputs are ignored to protect existing mutation
 *   flows.
 * @param {TelemetryController} telemetry - Controller supplying snapshot data
 *   and throttling helpers for UI integrations.
 */
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

/**
 * Builds the shared runtime services used by the simulation engine. The
 * resulting bundle owns a `Stats` instance and telemetry controller, and
 * exposes an `attachTo` helper for wiring telemetry accessors onto UI-facing
 * objects.
 *
 * @param {{
 *   rng?: () => number,
 *   computeLeaderboard?: typeof defaultComputeLeaderboard,
 *   leaderboardSize?: number,
 *   now?: () => number,
 * }} [options] - Optional overrides injected by tests or host environments.
 *   When omitted, defaults mirror production behaviour so telemetry continues
 *   to reflect authoritative leaderboard calculations.
 * @returns {{
 *   stats: Stats,
 *   telemetry: TelemetryController,
 *   attachTo(target: object): void,
 * }} Runtime services ready for consumption by {@link SimulationEngine}.
 */
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
