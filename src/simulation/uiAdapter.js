import { computeLeaderboard } from '../leaderboard.js';

export default function createUiAdapter({ runtime, uiManager }) {
  if (!runtime || !uiManager) return () => {};

  let lastSlowUiRender = Number.NEGATIVE_INFINITY;
  let lastMetrics = null;
  let lastSnapshot = null;
  let lastStats = null;
  let pendingSlowUpdate = false;

  const flushUi = (timestamp, state) => {
    if (!pendingSlowUpdate) return;

    const interval = Math.max(0, state?.leaderboardIntervalMs ?? 0);

    if (interval > 0 && typeof timestamp === 'number' && timestamp - lastSlowUiRender < interval) {
      return;
    }

    lastSlowUiRender = typeof timestamp === 'number' ? timestamp : lastSlowUiRender;
    pendingSlowUpdate = false;

    if (typeof uiManager.renderMetrics === 'function' && lastStats) {
      uiManager.renderMetrics(lastStats, lastMetrics);
    }

    if (lastSnapshot && typeof uiManager.renderLeaderboard === 'function') {
      const top = computeLeaderboard(lastSnapshot, 5);

      uiManager.renderLeaderboard(top);
    }
  };

  const handleTick = ({ snapshot, metrics, stats, timestamp, state }) => {
    lastSnapshot = snapshot ?? lastSnapshot;
    if (metrics !== undefined) {
      lastMetrics = metrics;
    }
    lastMetrics = lastMetrics ?? null;
    lastStats = stats ?? lastStats;
    pendingSlowUpdate = true;

    flushUi(timestamp, state);
  };

  const handleState = ({ state, changes }) => {
    if (changes?.paused !== undefined && typeof uiManager.setPauseState === 'function') {
      uiManager.setPauseState(changes.paused);
    }

    if (changes?.leaderboardIntervalMs !== undefined) {
      lastSlowUiRender = Number.NEGATIVE_INFINITY;
      pendingSlowUpdate = true;
    }

    if (changes?.lingerPenalty !== undefined && typeof uiManager.setLingerPenalty === 'function') {
      uiManager.setLingerPenalty(changes.lingerPenalty);
    }

    flushUi(runtime.now?.() ?? Date.now(), state);
  };

  const subs = [runtime.on('tick', handleTick), runtime.on('state', handleState)];

  if (typeof uiManager.setPauseState === 'function') {
    uiManager.setPauseState(runtime.isPaused());
  }

  if (typeof uiManager.getLingerPenalty === 'function') {
    const value = uiManager.getLingerPenalty();

    if (value != null) runtime.setLingerPenalty(value);
  }

  return () => {
    while (subs.length) {
      const unsub = subs.pop();

      if (typeof unsub === 'function') unsub();
    }
  };
}
