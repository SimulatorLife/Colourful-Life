import { sanitizeNumber } from "../utils.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

const DEFAULT_LEADERBOARD_SIZE = 5;
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

const WARNINGS = Object.freeze({
  getEnvironment:
    "Telemetry environment resolver failed; continuing without environment context.",
  computeLeaderboard:
    "Telemetry leaderboard computation failed; emitting empty leaderboard.",
  emitMetrics: "Telemetry metrics emitter failed; skipping metrics publication.",
  emitLeaderboard:
    "Telemetry leaderboard emitter failed; skipping leaderboard publication.",
});

function normalizeLeaderboardSize(value, fallback = DEFAULT_LEADERBOARD_SIZE) {
  const sanitized = sanitizeNumber(value, {
    fallback,
    min: 0,
    round: Math.floor,
  });

  return Math.max(0, sanitized);
}

function resolveNow(now) {
  if (typeof now === "function") {
    return () => {
      const value = now();

      return Number.isFinite(value) ? value : Date.now();
    };
  }

  return () => Date.now();
}

function resolveLeaderboardFactory(factory) {
  if (typeof factory === "function") {
    return factory;
  }

  return () => [];
}

export default class TelemetryController {
  constructor({
    stats = null,
    computeLeaderboard,
    leaderboardSize = DEFAULT_LEADERBOARD_SIZE,
    now,
  } = {}) {
    this.stats = stats;
    this.#computeLeaderboard = resolveLeaderboardFactory(computeLeaderboard);
    this.#leaderboardSize = normalizeLeaderboardSize(leaderboardSize);
    this.#now = resolveNow(now);
    this.#lastSnapshot = null;
    this.#lastMetrics = null;
    this.#pending = false;
    this.#lastSlowEmit = NEGATIVE_INFINITY;
    this.#lastRenderStats = null;
  }

  get snapshot() {
    return this.#lastSnapshot;
  }

  get metrics() {
    return this.#lastMetrics;
  }

  hasPending() {
    return this.#pending;
  }

  markPending() {
    this.#pending = true;
  }

  clearPending() {
    this.#pending = false;
  }

  setLeaderboardSize(value) {
    const nextSize = normalizeLeaderboardSize(value, this.#leaderboardSize);

    if (nextSize === this.#leaderboardSize) {
      return this.#leaderboardSize;
    }

    this.#leaderboardSize = nextSize;

    return this.#leaderboardSize;
  }

  resetThrottle(timestamp = NEGATIVE_INFINITY) {
    this.#lastSlowEmit = Number.isFinite(timestamp) ? timestamp : NEGATIVE_INFINITY;
  }

  getLastEmissionTimestamp() {
    return this.#lastSlowEmit;
  }

  setInitialSnapshot(snapshot) {
    this.#lastSnapshot = this.#prepareSnapshotForRetention(snapshot);
  }

  ingestSnapshot(snapshot) {
    const workingSnapshot = snapshot ?? null;

    this.#lastMetrics =
      workingSnapshot && typeof this.stats?.updateFromSnapshot === "function"
        ? this.stats.updateFromSnapshot(workingSnapshot)
        : null;
    this.#lastSnapshot = this.#prepareSnapshotForRetention(workingSnapshot);
    this.#pending = true;

    return this.#lastMetrics;
  }

  includeRenderStats(renderStats) {
    if (!renderStats || renderStats === this.#lastRenderStats) {
      return;
    }

    this.#lastRenderStats = renderStats;

    if (this.#lastMetrics && typeof renderStats === "object") {
      this.#lastMetrics = { ...this.#lastMetrics, rendering: renderStats };
    }
  }

  publishIfDue({
    timestamp,
    interval,
    getEnvironment,
    emitMetrics,
    emitLeaderboard,
  } = {}) {
    if (!this.#pending) {
      return false;
    }

    const now = this.#resolveTimestamp(timestamp);
    const wait = this.#normalizeInterval(interval);

    if (wait > 0 && now - this.#lastSlowEmit < wait) {
      return false;
    }

    this.#lastSlowEmit = now;
    this.#pending = false;
    this.#emit({ getEnvironment, emitMetrics, emitLeaderboard });

    return true;
  }

  publishNow({ timestamp, getEnvironment, emitMetrics, emitLeaderboard } = {}) {
    const now = this.#resolveTimestamp(timestamp);

    this.#lastSlowEmit = now;
    this.#pending = false;
    this.#emit({ getEnvironment, emitMetrics, emitLeaderboard });
  }

  #emit({ getEnvironment, emitMetrics, emitLeaderboard }) {
    const environment = this.#resolveEnvironment(getEnvironment);

    this.#emitMetrics(emitMetrics, environment);
    this.#emitLeaderboard(emitLeaderboard);
  }

  #resolveEnvironment(getEnvironment) {
    if (typeof getEnvironment !== "function") {
      return getEnvironment ?? null;
    }

    const resolved = invokeWithErrorBoundary(getEnvironment, [], {
      message: WARNINGS.getEnvironment,
      reporter: warnOnce,
      once: true,
    });

    return resolved ?? null;
  }

  #emitMetrics(emitMetrics, environment) {
    if (typeof emitMetrics !== "function") return;
    if (!this.#lastMetrics) return;

    invokeWithErrorBoundary(
      emitMetrics,
      [
        {
          stats: this.stats,
          metrics: this.#lastMetrics,
          environment,
        },
      ],
      {
        message: WARNINGS.emitMetrics,
        reporter: warnOnce,
        once: true,
      },
    );
  }

  #emitLeaderboard(emitLeaderboard) {
    if (typeof emitLeaderboard !== "function") return;

    const rawEntries = this.#lastSnapshot
      ? invokeWithErrorBoundary(
          this.#computeLeaderboard,
          [this.#lastSnapshot, this.#leaderboardSize],
          {
            message: WARNINGS.computeLeaderboard,
            reporter: warnOnce,
            once: true,
          },
        )
      : [];
    const entries = Array.isArray(rawEntries) ? rawEntries : [];

    invokeWithErrorBoundary(emitLeaderboard, [{ entries }], {
      message: WARNINGS.emitLeaderboard,
      reporter: warnOnce,
      once: true,
    });
  }

  #resolveTimestamp(candidate) {
    if (Number.isFinite(candidate)) {
      return candidate;
    }

    return this.#now();
  }

  #normalizeInterval(interval) {
    if (!Number.isFinite(interval) || interval <= 0) {
      return 0;
    }

    return Math.max(0, Math.floor(interval));
  }

  #computeLeaderboard;
  #leaderboardSize;
  #now;
  #lastSnapshot;
  #lastMetrics;
  #pending;
  #lastSlowEmit;
  #lastRenderStats;

  #prepareSnapshotForRetention(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }

    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : null;
    const ensureStat = (value, fallback = 0) =>
      Number.isFinite(value) ? value : fallback;

    entries?.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const cellStats =
        entry.cell && typeof entry.cell === "object" ? entry.cell : null;
      const fallbackStat = (key) => ensureStat(cellStats?.[key], 0);

      entry.offspring = ensureStat(entry.offspring, fallbackStat("offspring"));
      entry.fightsWon = ensureStat(entry.fightsWon, fallbackStat("fightsWon"));
      entry.age = ensureStat(entry.age, fallbackStat("age"));

      if (entry.color == null) {
        const colorFromCell =
          typeof cellStats?.color === "string" ? cellStats.color : null;

        entry.color = colorFromCell;
      }

      if ("cell" in entry) {
        delete entry.cell;
      }
    });

    const brainSnapshots = Array.isArray(snapshot.brainSnapshots)
      ? snapshot.brainSnapshots
      : null;

    brainSnapshots?.forEach((entry, index) => {
      if (!entry || typeof entry !== "object") return;

      const entryColor = entries?.[index]?.color;

      if (entry.color == null && typeof entryColor === "string") {
        entry.color = entryColor;
      }

      if ("cell" in entry) {
        delete entry.cell;
      }
    });

    if (Array.isArray(snapshot.populationCells)) {
      snapshot.populationCells.length = 0;
    }

    if (Object.hasOwn(snapshot, "populationCells")) {
      delete snapshot.populationCells;
    }

    return snapshot;
  }
}
