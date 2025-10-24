import { sanitizeNumber } from "../utils.js";

const DEFAULT_LEADERBOARD_SIZE = 5;
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

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

  resetThrottle(timestamp = NEGATIVE_INFINITY) {
    this.#lastSlowEmit = Number.isFinite(timestamp) ? timestamp : NEGATIVE_INFINITY;
  }

  getLastEmissionTimestamp() {
    return this.#lastSlowEmit;
  }

  setInitialSnapshot(snapshot) {
    this.#lastSnapshot = snapshot ?? null;
  }

  ingestSnapshot(snapshot) {
    this.#lastSnapshot = snapshot ?? null;
    this.#lastMetrics =
      this.#lastSnapshot && typeof this.stats?.updateFromSnapshot === "function"
        ? this.stats.updateFromSnapshot(this.#lastSnapshot)
        : null;
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
    const environment =
      typeof getEnvironment === "function" ? getEnvironment() : getEnvironment;

    if (typeof emitMetrics === "function" && this.#lastMetrics) {
      emitMetrics({
        stats: this.stats,
        metrics: this.#lastMetrics,
        environment,
      });
    }

    if (typeof emitLeaderboard === "function") {
      const entries = this.#lastSnapshot
        ? this.#computeLeaderboard(this.#lastSnapshot, this.#leaderboardSize)
        : [];

      emitLeaderboard({ entries });
    }
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
}
