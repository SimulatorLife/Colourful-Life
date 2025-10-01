import EventManager from "./events/eventManager.js";
import GridManager from "./grid/gridManager.js";
import SelectionManager from "./ui/selectionManager.js";
import Stats from "./stats.js";
import { drawOverlays as defaultDrawOverlays } from "./ui/overlays.js";
import { computeLeaderboard } from "./leaderboard.js";
import {
  ENERGY_DIFFUSION_RATE_DEFAULT,
  ENERGY_REGEN_RATE_DEFAULT,
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  SIMULATION_DEFAULTS,
  resolveSimulationDefaults,
} from "./config.js";
import { OBSTACLE_PRESETS } from "./grid/obstaclePresets.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

const defaultNow = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
};

const defaultRequestAnimationFrame = (cb) => setTimeout(() => cb(defaultNow()), 16);
const defaultCancelAnimationFrame = (id) => clearTimeout(id);

function sanitizeNumeric(
  value,
  {
    fallback,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
    round = false,
  },
) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return fallback;

  let sanitized = numeric;

  if (round === true) {
    sanitized = Math.round(sanitized);
  } else if (typeof round === "function") {
    sanitized = round(sanitized);
  }

  if (Number.isFinite(min)) sanitized = Math.max(min, sanitized);
  if (Number.isFinite(max)) sanitized = Math.min(max, sanitized);

  return sanitized;
}

function resolveCanvas(canvas, documentRef) {
  if (canvas) return canvas;

  if (documentRef && typeof documentRef.getElementById === "function") {
    return documentRef.getElementById("gameCanvas");
  }

  return null;
}

function ensureCanvasDimensions(canvas, config) {
  const candidates = [
    config?.width,
    config?.canvasWidth,
    config?.canvasSize?.width,
    canvas?.width,
  ];
  const heightCandidates = [
    config?.height,
    config?.canvasHeight,
    config?.canvasSize?.height,
    canvas?.height,
  ];

  const width = candidates.find((value) => typeof value === "number");
  const height = heightCandidates.find((value) => typeof value === "number");

  if (canvas && typeof width === "number") canvas.width = width;
  if (canvas && typeof height === "number") canvas.height = height;

  if (typeof canvas?.width === "number" && typeof canvas?.height === "number") {
    return { width: canvas.width, height: canvas.height };
  }

  if (typeof width === "number" && typeof height === "number") {
    return { width, height };
  }

  throw new Error("SimulationEngine requires canvas dimensions to be specified.");
}

/**
 * Coordinates the main simulation loop, rendering pipeline, and UI-facing events.
 *
 * Responsibilities include constructing the grid, stats, and selection managers, wiring
 * simulation state to rendering, and broadcasting lifecycle events such as `tick`, `metrics`,
 * `leaderboard`, and `state`. Consumers can use the public properties `grid`, `stats`,
 * `selectionManager`, `canvas`, and `ctx` to interact with the world, while methods such as
 * `start`, `stop`, `pause`, and `tick` expose controls over the loop cadence.
 *
 * @fires SimulationEngine#tick
 * @fires SimulationEngine#metrics
 * @fires SimulationEngine#leaderboard
 * @fires SimulationEngine#state
 *
 * @param {Object} [options]
 * @param {HTMLCanvasElement} [options.canvas] - Canvas to render into; resolved via
 *   `document.getElementById('gameCanvas')` when omitted.
 * @param {Object} [options.config] - Initial configuration (cell size, UI slider defaults, etc.).
 * @param {() => number} [options.rng=Math.random] - PRNG used by the grid and events.
 * @param {(cb: FrameRequestCallback) => number} [options.requestAnimationFrame] - Injected
 *   frame scheduler. Defaults to `window.requestAnimationFrame` or a setTimeout shim.
 * @param {(handle: number) => void} [options.cancelAnimationFrame] - Injected cancellation hook,
 *   mirroring the rAF source.
 * @param {() => number} [options.performanceNow] - High-resolution timer hook, defaults to
 *   `performance.now` with a Date fallback.
 * @param {Function} [options.drawOverlays] - Optional overlay renderer invoked each frame.
 * @param {Window} [options.window] - Optional window reference for SSR/test injection.
 * @param {Document} [options.document] - Optional document reference for SSR/test injection.
 * @param {boolean} [options.autoStart=true] - When true the engine immediately starts ticking.
 * @param {Function|{captureFromEntries: Function}} [options.brainSnapshotCollector]
 *   Hook used by {@link GridManager} to build brain snapshots for the leaderboard.
 */
export default class SimulationEngine {
  constructor({
    canvas,
    config = {},
    rng = Math.random,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    drawOverlays = defaultDrawOverlays,
    window: injectedWindow,
    document: injectedDocument,
    autoStart = true,
    brainSnapshotCollector,
  } = {}) {
    const win = injectedWindow ?? (typeof window !== "undefined" ? window : undefined);
    const doc =
      injectedDocument ?? (typeof document !== "undefined" ? document : undefined);
    const resolvedCanvas = resolveCanvas(canvas, doc);

    if (!resolvedCanvas) {
      throw new Error("SimulationEngine requires a canvas element.");
    }

    const ctx = resolvedCanvas.getContext("2d");

    if (!ctx) {
      throw new Error("SimulationEngine requires a 2D canvas context.");
    }

    const { width, height } = ensureCanvasDimensions(resolvedCanvas, config);
    const cellSize = config.cellSize ?? 5;
    const rows = config.rows ?? Math.floor(height / cellSize);
    const cols = config.cols ?? Math.floor(width / cellSize);

    this.window = win;
    this.document = doc;
    this.canvas = resolvedCanvas;
    this.ctx = ctx;
    this.cellSize = cellSize;
    this.rows = rows;
    this.cols = cols;
    this.now = typeof injectedNow === "function" ? injectedNow : defaultNow;
    this.raf =
      typeof injectedRaf === "function"
        ? injectedRaf
        : win && typeof win.requestAnimationFrame === "function"
          ? win.requestAnimationFrame.bind(win)
          : defaultRequestAnimationFrame;
    this.caf =
      typeof injectedCaf === "function"
        ? injectedCaf
        : win && typeof win.cancelAnimationFrame === "function"
          ? win.cancelAnimationFrame.bind(win)
          : defaultCancelAnimationFrame;
    this.drawOverlays = drawOverlays;

    const defaults = resolveSimulationDefaults(config);

    this.eventManager = new EventManager(rows, cols, rng, {
      startWithEvent: (defaults.eventFrequencyMultiplier ?? 1) > 0,
    });
    this.stats = new Stats();
    this.selectionManager = new SelectionManager(rows, cols);
    const hasInitialPreset = typeof config.initialObstaclePreset === "string";
    const randomizeInitialObstacles =
      config.randomizeInitialObstacles ??
      (!hasInitialPreset || config.initialObstaclePreset === "random");
    const initialObstaclePreset = hasInitialPreset
      ? config.initialObstaclePreset
      : randomizeInitialObstacles
        ? "random"
        : "none";

    this.brainSnapshotCollector = brainSnapshotCollector ?? null;
    this.grid = new GridManager(rows, cols, {
      eventManager: this.eventManager,
      ctx: this.ctx,
      cellSize: this.cellSize,
      stats: this.stats,
      selectionManager: this.selectionManager,
      initialObstaclePreset,
      initialObstaclePresetOptions: config.initialObstaclePresetOptions,
      randomizeInitialObstacles,
      randomObstaclePresetPool: config.randomObstaclePresetPool,
      rng,
      brainSnapshotCollector,
    });

    if (win) {
      win.grid = this.grid;
      win.simulationEngine = this;
    } else {
      GLOBAL.grid = this.grid;
      GLOBAL.simulationEngine = this;
    }

    this.autoPauseOnBlur = Boolean(defaults.autoPauseOnBlur);
    this._autoPauseResumePending = false;
    this._autoPauseCleanup = null;

    this.state = {
      paused: Boolean(defaults.paused),
      updatesPerSecond: Math.max(1, Math.round(defaults.updatesPerSecond)),
      eventFrequencyMultiplier: defaults.eventFrequencyMultiplier,
      mutationMultiplier: defaults.mutationMultiplier,
      densityEffectMultiplier: defaults.densityEffectMultiplier,
      societySimilarity: defaults.societySimilarity,
      enemySimilarity: defaults.enemySimilarity,
      eventStrengthMultiplier: defaults.eventStrengthMultiplier,
      energyRegenRate: defaults.energyRegenRate,
      energyDiffusionRate: defaults.energyDiffusionRate,
      combatEdgeSharpness: defaults.combatEdgeSharpness,
      showObstacles: defaults.showObstacles,
      showEnergy: defaults.showEnergy,
      showDensity: defaults.showDensity,
      showFitness: defaults.showFitness,
      leaderboardIntervalMs: defaults.leaderboardIntervalMs,
      matingDiversityThreshold: defaults.matingDiversityThreshold,
      lowDiversityReproMultiplier: defaults.lowDiversityReproMultiplier,
      autoPauseOnBlur: this.autoPauseOnBlur,
    };
    this.lingerPenalty = defaults.lingerPenalty;

    this.grid.setLingerPenalty(this.lingerPenalty);

    const initialThreshold = this.state.matingDiversityThreshold;

    if (typeof this.stats?.setMatingDiversityThreshold === "function") {
      this.stats.setMatingDiversityThreshold(initialThreshold);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = initialThreshold;
    }
    this.grid.setMatingDiversityOptions?.({
      threshold: this.stats?.matingDiversityThreshold,
      lowDiversityMultiplier: this.state.lowDiversityReproMultiplier,
    });

    // Flag signalling that leaderboard/metrics should be recalculated once the throttle allows it.
    this.pendingSlowUiUpdate = false;
    this.lastMetrics = null;
    this.lastSnapshot = this.grid.getLastSnapshot();
    this.lastSlowUiRender = Number.NEGATIVE_INFINITY;
    this.lastUpdateTime = 0;
    this.running = false;
    this.frameHandle = null;

    this.listeners = new Map();

    this._autoPauseCleanup = this.#installAutoPauseHandlers(win, doc);

    if (autoStart) {
      this.start();
    }
  }

  get obstaclePresets() {
    return OBSTACLE_PRESETS;
  }

  get isRunning() {
    return this.running;
  }

  isPaused() {
    return Boolean(this.state.paused);
  }

  getStateSnapshot() {
    return { ...this.state, lingerPenalty: this.lingerPenalty };
  }

  on(event, handler) {
    if (typeof handler !== "function") return () => {};

    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const bucket = this.listeners.get(event);

    bucket.add(handler);

    return () => {
      bucket.delete(handler);
      if (bucket.size === 0) this.listeners.delete(event);
    };
  }

  emit(event, payload) {
    const bucket = this.listeners.get(event);

    if (!bucket) return;

    bucket.forEach((handler) => {
      try {
        handler(payload);
      } catch (error) {
        // Surface errors asynchronously so the loop keeps running
        setTimeout(() => {
          throw error;
        }, 0);
      }
    });
  }

  #updateState(partial) {
    if (!partial || typeof partial !== "object") return false;

    let changed = false;
    const changes = {};

    Object.entries(partial).forEach(([key, value]) => {
      if (!(key in this.state)) return;
      if (this.state[key] === value) return;
      this.state[key] = value;
      changes[key] = value;
      changed = true;
    });

    if (changed) {
      if (changes.leaderboardIntervalMs !== undefined) {
        this.lastSlowUiRender = Number.NEGATIVE_INFINITY;
      }

      this.emit("state", { state: this.getStateSnapshot(), changes });
    }

    return changed;
  }

  #updateStateAndFlag(partial) {
    const changed = this.#updateState(partial);

    if (changed) {
      this.pendingSlowUiUpdate = true;
    }

    return changed;
  }

  #handleAutoPauseTrigger() {
    if (!this.autoPauseOnBlur) return;
    if (this._autoPauseResumePending) return;
    if (!this.running) return;
    if (this.isPaused()) return;

    this.pause();

    if (this.isPaused()) {
      this._autoPauseResumePending = true;
    }
  }

  #handleAutoPauseResume() {
    if (!this._autoPauseResumePending) return;

    this.resume();
    this._autoPauseResumePending = false;
  }

  #installAutoPauseHandlers(win, doc) {
    if (!win || typeof win.addEventListener !== "function") return () => {};

    const visibilityHandler = () => {
      if (!this.autoPauseOnBlur) return;

      const hidden = doc?.visibilityState === "hidden" || doc?.hidden === true;

      if (hidden) {
        this.#handleAutoPauseTrigger();
      } else {
        this.#handleAutoPauseResume();
      }
    };

    const blurHandler = () => {
      if (!this.autoPauseOnBlur) return;
      if (doc && doc.visibilityState === "hidden") return;

      this.#handleAutoPauseTrigger();
    };

    const focusHandler = () => {
      this.#handleAutoPauseResume();
    };

    const pageShowHandler = () => {
      this.#handleAutoPauseResume();
    };

    doc?.addEventListener("visibilitychange", visibilityHandler);
    win.addEventListener("blur", blurHandler);
    win.addEventListener("focus", focusHandler);
    win.addEventListener("pageshow", pageShowHandler);

    return () => {
      doc?.removeEventListener("visibilitychange", visibilityHandler);
      win.removeEventListener("blur", blurHandler);
      win.removeEventListener("focus", focusHandler);
      win.removeEventListener("pageshow", pageShowHandler);
    };
  }

  #summarizeActiveEvents() {
    const events = Array.isArray(this.eventManager?.activeEvents)
      ? this.eventManager.activeEvents
      : [];

    if (events.length === 0) {
      return [];
    }

    const totalTiles = Math.max(1, this.rows * this.cols);
    const updatesPerSecond = Math.max(1, Math.round(this.state.updatesPerSecond ?? 60));
    const strengthMultiplier = Number.isFinite(this.state.eventStrengthMultiplier)
      ? this.state.eventStrengthMultiplier
      : 1;

    return events.map((event, index) => {
      const area = event?.affectedArea ?? {};
      const rawWidth = Number.isFinite(area.width) ? area.width : 0;
      const rawHeight = Number.isFinite(area.height) ? area.height : 0;
      const width = Math.max(0, Math.min(this.cols, Math.round(rawWidth)));
      const height = Math.max(0, Math.min(this.rows, Math.round(rawHeight)));
      const coverageTiles = width * height;
      const coverageRatio = coverageTiles > 0 ? coverageTiles / totalTiles : 0;
      const remainingTicks = Math.max(0, Math.floor(event?.remaining ?? 0));
      const durationTicks = Math.max(remainingTicks, Math.floor(event?.duration ?? 0));
      const remainingSeconds = remainingTicks / updatesPerSecond;
      const normalizedStrength = Number.isFinite(event?.strength)
        ? event.strength
        : null;
      const effectiveStrength =
        normalizedStrength == null ? null : normalizedStrength * strengthMultiplier;

      return {
        id: `${event?.eventType ?? "event"}-${index}-${width}x${height}-${remainingTicks}`,
        type:
          typeof event?.eventType === "string" && event.eventType.length > 0
            ? event.eventType
            : "event",
        strength: normalizedStrength,
        effectiveStrength,
        coverageTiles,
        coverageRatio,
        remainingTicks,
        remainingSeconds,
        durationTicks,
      };
    });
  }

  #scheduleNextFrame() {
    if (!this.running || this.frameHandle != null) return;

    this.frameHandle = this.raf((timestamp) => {
      this.frameHandle = null;
      const ts = typeof timestamp === "number" ? timestamp : this.now();

      this.#frame(ts, { scheduleNext: true });
    });
  }

  requestFrame() {
    if (!this.running) return;
    this.#scheduleNextFrame();
  }

  /**
   * Internal scheduler entry-point used by both the animation frame loop and manual `tick`
   * invocations. It enforces the configured updates-per-second cadence, skips state mutation when
   * paused, and emits the public `tick`, `metrics`, and `leaderboard` events when appropriate.
   *
   * Timing semantics:
   * - Timestamps come from the injected `performanceNow`/`requestAnimationFrame` hooks.
   * - Update frequency is derived from `state.updatesPerSecond`; frames that arrive sooner simply
   *   redraw without advancing simulation time.
   * - Manual ticks pass `{ force: true }`, allowing the engine to advance even when the outer
   *   `start` loop is stopped (useful for tests and inspectors).
   *
   * Pause and events:
   * - When paused the grid still redraws, but no `tick` event is emitted and throttled UI updates
   *   remain pending until the next unpaused frame.
   * - `pendingSlowUiUpdate` is flipped to `true` whenever GridManager produces a new snapshot and
   *   Stats ingest fresh metrics. The `leaderboardIntervalMs` throttle guards how often the
   *   expensive leaderboard aggregation runs, ensuring UI work is batched even if simulation ticks
   *   faster.
   * - Grid mutations are delegated to `GridManager.update`, which consumes the current tuning
   *   values. The returned snapshot feeds directly into `Stats.updateFromSnapshot`, tying together
   *   world state, statistics, and UI surfaces.
   *
   * @private
   */
  #frame(
    timestamp,
    { scheduleNext = false, force = false, allowPausedTick = false } = {},
  ) {
    if (!this.running && !force) return false;

    const effectiveTimestamp = typeof timestamp === "number" ? timestamp : this.now();
    let tickOccurred = false;

    const paused = Boolean(this.state.paused);
    const interval = 1000 / Math.max(1, this.state.updatesPerSecond);
    const elapsed = effectiveTimestamp - this.lastUpdateTime;
    const shouldAdvance =
      (!paused && elapsed >= interval) || (allowPausedTick && paused);

    if (shouldAdvance) {
      this.lastUpdateTime = effectiveTimestamp;
      tickOccurred = true;
      this.stats.resetTick();
      this.eventManager.updateEvent?.(this.state.eventFrequencyMultiplier ?? 1, 2);
      const snapshot = this.grid.update({
        densityEffectMultiplier: this.state.densityEffectMultiplier ?? 1,
        societySimilarity:
          this.state.societySimilarity ?? SIMULATION_DEFAULTS.societySimilarity,
        enemySimilarity:
          this.state.enemySimilarity ?? SIMULATION_DEFAULTS.enemySimilarity,
        eventStrengthMultiplier: this.state.eventStrengthMultiplier ?? 1,
        energyRegenRate: this.state.energyRegenRate ?? ENERGY_REGEN_RATE_DEFAULT,
        energyDiffusionRate:
          this.state.energyDiffusionRate ?? ENERGY_DIFFUSION_RATE_DEFAULT,
        mutationMultiplier: this.state.mutationMultiplier ?? 1,
        matingDiversityThreshold:
          this.state.matingDiversityThreshold ??
          SIMULATION_DEFAULTS.matingDiversityThreshold,
        lowDiversityReproMultiplier:
          this.state.lowDiversityReproMultiplier ??
          SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
        combatEdgeSharpness:
          this.state.combatEdgeSharpness ?? COMBAT_EDGE_SHARPNESS_DEFAULT,
      });

      this.lastSnapshot = snapshot;
      this.stats.logEvent?.(
        this.eventManager.currentEvent,
        this.state.eventStrengthMultiplier ?? 1,
      );
      this.stats.setMutationMultiplier?.(this.state.mutationMultiplier ?? 1);
      this.lastMetrics = this.stats.updateFromSnapshot?.(snapshot);
      // Defer leaderboard/metrics publication until the throttle window allows another emit.
      this.pendingSlowUiUpdate = true;

      this.emit("tick", {
        snapshot,
        metrics: this.lastMetrics,
        timestamp: effectiveTimestamp,
      });
    }

    this.grid.draw({ showObstacles: this.state.showObstacles ?? true });

    this.drawOverlays(this.grid, this.ctx, this.cellSize, {
      showEnergy: this.state.showEnergy ?? false,
      showDensity: this.state.showDensity ?? false,
      showFitness: this.state.showFitness ?? false,
      showObstacles: this.state.showObstacles ?? true,
      maxTileEnergy: Number.isFinite(this.grid?.maxTileEnergy)
        ? this.grid.maxTileEnergy
        : GridManager.maxTileEnergy,
      snapshot: this.lastSnapshot,
      activeEvents: this.eventManager.activeEvents,
      getEventColor: this.eventManager.getColor?.bind(this.eventManager),
      mutationMultiplier: this.state.mutationMultiplier ?? 1,
      selectionManager: this.selectionManager,
    });

    if (this.pendingSlowUiUpdate) {
      const interval = Math.max(0, this.state.leaderboardIntervalMs ?? 0);

      if (interval === 0 || effectiveTimestamp - this.lastSlowUiRender >= interval) {
        this.lastSlowUiRender = effectiveTimestamp;

        if (this.lastMetrics) {
          this.emit("metrics", {
            stats: this.stats,
            metrics: this.lastMetrics,
            environment: {
              activeEvents: this.#summarizeActiveEvents(),
              updatesPerSecond: Math.max(
                1,
                Math.round(this.state.updatesPerSecond ?? 60),
              ),
              eventStrengthMultiplier: Number.isFinite(
                this.state.eventStrengthMultiplier,
              )
                ? this.state.eventStrengthMultiplier
                : 1,
            },
          });
        }

        const top = this.lastSnapshot ? computeLeaderboard(this.lastSnapshot, 5) : [];

        this.emit("leaderboard", { entries: top });
        this.pendingSlowUiUpdate = false;
      }
    }

    if (scheduleNext) {
      this.#scheduleNextFrame();
    }

    return tickOccurred;
  }

  start() {
    if (this.running) {
      this.setPaused(false);
      this.#scheduleNextFrame();

      return;
    }

    this.running = true;
    this.lastUpdateTime = 0;
    this.setPaused(false);
    this.#scheduleNextFrame();
  }

  setPaused(value) {
    const paused = Boolean(value);
    const changed = this.#updateState({ paused });

    if (!paused) {
      this._autoPauseResumePending = false;
    }

    if (!paused && this.running) {
      this.#scheduleNextFrame();
    }

    return changed;
  }

  pause() {
    this.setPaused(true);

    return this.isPaused();
  }

  resume() {
    this.setPaused(false);
    if (!this.running) this.start();

    return this.isPaused();
  }

  togglePause() {
    const next = !this.isPaused();

    this.setPaused(next);
    if (!next && !this.running) this.start();

    return next;
  }

  stop() {
    this.running = false;
    if (this.frameHandle != null) {
      this.caf(this.frameHandle);
      this.frameHandle = null;
    }
  }

  destroy() {
    if (typeof this._autoPauseCleanup === "function") {
      this._autoPauseCleanup();
      this._autoPauseCleanup = null;
    }

    this.stop();
  }

  /**
   * Advances the simulation once using the supplied timestamp (defaulting to `performance.now`).
   * Unlike the running loop, this does not schedule another frame, making it ideal for deterministic
   * tests or single-step debugging. The call honours the paused state for world updates but still
   * triggers redraws and pending slow UI work so instrumentation stays in sync.
   *
   * @param {number} [timestamp]
   * @returns {boolean} Whether a simulation update (as opposed to a redraw) occurred.
   */
  tick(timestamp = this.now()) {
    return this.#frame(timestamp, { scheduleNext: false, force: true });
  }

  /**
   * Advances the simulation by exactly one update even while paused, keeping the
   * paused state intact so users can inspect the world frame-by-frame.
   *
   * @returns {boolean} Whether a simulation update occurred.
   */
  step(timestamp) {
    if (!this.state.paused) return false;

    const effectiveTimestamp = Number.isFinite(timestamp) ? timestamp : this.now();

    return this.#frame(effectiveTimestamp, {
      scheduleNext: false,
      force: true,
      allowPausedTick: true,
    });
  }

  setUpdatesPerSecond(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.updatesPerSecond,
      min: 1,
      round: true,
    });

    this.#updateStateAndFlag({ updatesPerSecond: sanitized });

    return sanitized;
  }

  setEventFrequencyMultiplier(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.eventFrequencyMultiplier,
      min: 0,
    });

    this.#updateStateAndFlag({ eventFrequencyMultiplier: sanitized });
  }

  setMutationMultiplier(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.mutationMultiplier,
      min: 0,
    });

    this.#updateStateAndFlag({ mutationMultiplier: sanitized });
  }

  setCombatEdgeSharpness(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.combatEdgeSharpness,
      min: 0.1,
    });

    this.#updateStateAndFlag({ combatEdgeSharpness: sanitized });
  }

  setDensityEffectMultiplier(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.densityEffectMultiplier,
      min: 0,
    });

    this.#updateStateAndFlag({ densityEffectMultiplier: sanitized });
  }

  setSimilarityThresholds({ societySimilarity, enemySimilarity }) {
    const changes = {};

    if (societySimilarity !== undefined) {
      changes.societySimilarity = sanitizeNumeric(societySimilarity, {
        fallback: this.state.societySimilarity,
        min: 0,
        max: 1,
      });
    }

    if (enemySimilarity !== undefined) {
      changes.enemySimilarity = sanitizeNumeric(enemySimilarity, {
        fallback: this.state.enemySimilarity,
        min: 0,
        max: 1,
      });
    }

    if (Object.keys(changes).length > 0) {
      this.#updateStateAndFlag(changes);
    }
  }

  setEventStrengthMultiplier(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.eventStrengthMultiplier,
      min: 0,
    });

    this.#updateStateAndFlag({ eventStrengthMultiplier: sanitized });
  }

  setEnergyRates({ regen, diffusion }) {
    const changes = {};

    if (regen !== undefined) {
      changes.energyRegenRate = sanitizeNumeric(regen, {
        fallback: this.state.energyRegenRate,
        min: 0,
      });
    }

    if (diffusion !== undefined) {
      changes.energyDiffusionRate = sanitizeNumeric(diffusion, {
        fallback: this.state.energyDiffusionRate,
        min: 0,
      });
    }

    if (Object.keys(changes).length > 0) {
      this.#updateStateAndFlag(changes);
    }
  }

  setLeaderboardInterval(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.state.leaderboardIntervalMs,
      min: 0,
    });

    this.#updateState({ leaderboardIntervalMs: sanitized });
  }

  setOverlayVisibility({ showObstacles, showEnergy, showDensity, showFitness }) {
    const entries = Object.entries({
      showObstacles,
      showEnergy,
      showDensity,
      showFitness,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, Boolean(value)]);

    if (entries.length === 0) return;

    this.#updateState(Object.fromEntries(entries));
  }

  setBrainSnapshotCollector(collector) {
    this.brainSnapshotCollector = collector ?? null;
    this.grid?.setBrainSnapshotCollector(collector);
  }

  setLingerPenalty(value) {
    const sanitized = sanitizeNumeric(value, {
      fallback: this.lingerPenalty,
      min: 0,
    });

    if (sanitized === this.lingerPenalty) return;

    this.lingerPenalty = sanitized;
    this.grid.setLingerPenalty(sanitized);
    this.emit("state", {
      state: this.getStateSnapshot(),
      changes: { lingerPenalty: sanitized },
    });
  }

  setAutoPauseOnBlur(value) {
    const enabled = Boolean(value);

    if (this.autoPauseOnBlur === enabled) return;

    this.autoPauseOnBlur = enabled;

    if (!enabled) {
      this._autoPauseResumePending = false;
    }

    this.#updateState({ autoPauseOnBlur: enabled });
  }

  updateSetting(key, value) {
    switch (key) {
      case "societySimilarity":
        this.setSimilarityThresholds({ societySimilarity: value });
        break;
      case "enemySimilarity":
        this.setSimilarityThresholds({ enemySimilarity: value });
        break;
      case "eventStrengthMultiplier":
        this.setEventStrengthMultiplier(value);
        break;
      case "eventFrequencyMultiplier":
        this.setEventFrequencyMultiplier(value);
        break;
      case "combatEdgeSharpness":
        this.setCombatEdgeSharpness(value);
        break;
      case "updatesPerSecond":
        this.setUpdatesPerSecond(value);
        break;
      case "densityEffectMultiplier":
        this.setDensityEffectMultiplier(value);
        break;
      case "energyRegenRate":
        this.setEnergyRates({ regen: value });
        break;
      case "energyDiffusionRate":
        this.setEnergyRates({ diffusion: value });
        break;
      case "mutationMultiplier":
        this.setMutationMultiplier(value);
        break;
      case "matingDiversityThreshold":
        this.setMatingDiversityThreshold(value);
        break;
      case "lowDiversityReproMultiplier":
        this.setLowDiversityReproMultiplier(value);
        break;
      case "speedMultiplier": {
        const numeric = Number(value);
        const sanitized = Number.isFinite(numeric) ? Math.max(0.5, numeric) : 1;

        this.setUpdatesPerSecond(60 * sanitized);
        break;
      }
      case "leaderboardIntervalMs":
        this.setLeaderboardInterval(value);
        break;
      case "showObstacles":
      case "showEnergy":
      case "showDensity":
      case "showFitness":
        this.setOverlayVisibility({ [key]: value });
        break;
      case "lingerPenalty":
        this.setLingerPenalty(value);
        break;
      case "autoPauseOnBlur":
        this.setAutoPauseOnBlur(value);
        break;
      default:
        break;
    }
  }

  setMatingDiversityThreshold(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return;

    const clamped = Math.min(Math.max(numeric, 0), 1);

    if (this.state.matingDiversityThreshold === clamped) return;

    if (typeof this.stats?.setMatingDiversityThreshold === "function") {
      this.stats.setMatingDiversityThreshold(clamped);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = clamped;
    }

    this.grid.setMatingDiversityOptions?.({
      threshold: clamped,
      lowDiversityMultiplier:
        this.state.lowDiversityReproMultiplier ??
        SIMULATION_DEFAULTS.lowDiversityReproMultiplier ??
        0.1,
    });

    this.#updateState({ matingDiversityThreshold: clamped });
  }

  setLowDiversityReproMultiplier(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return;

    const clamped = Math.min(Math.max(numeric, 0), 1);

    if (this.state.lowDiversityReproMultiplier === clamped) return;

    this.grid.setMatingDiversityOptions?.({
      threshold:
        this.state.matingDiversityThreshold ??
        this.stats?.matingDiversityThreshold ??
        SIMULATION_DEFAULTS.matingDiversityThreshold ??
        0.45,
      lowDiversityMultiplier: clamped,
    });

    this.#updateState({ lowDiversityReproMultiplier: clamped });
  }

  burstRandomCells(options = {}) {
    this.grid.burstRandomCells(options);
  }

  applyObstaclePreset(id, options) {
    this.grid.applyObstaclePreset(id, options);
  }
}

export { ensureCanvasDimensions, resolveCanvas };
