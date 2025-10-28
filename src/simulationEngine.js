import EventManager from "./events/eventManager.js";
import GridManager from "./grid/gridManager.js";
import InteractionSystem from "./interactionSystem.js";
import createSelectionManagerStub from "./grid/selectionManagerStub.js";
import createSimulationRuntimeServices from "./engine/simulationRuntimeServices.js";
import {
  ENERGY_DIFFUSION_RATE_DEFAULT,
  ENERGY_REGEN_RATE_DEFAULT,
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  COMBAT_TERRITORY_EDGE_FACTOR,
  SIMULATION_DEFAULTS,
  resolveSimulationDefaults,
  LEADERBOARD_INTERVAL_MIN_MS,
} from "./config.js";
import { resolveObstaclePresetCatalog } from "./grid/obstaclePresets.js";
import {
  clamp,
  clamp01,
  sanitizeNumber,
  sanitizePositiveInteger,
  sanitizeUnitInterval,
  toFiniteOrNull,
  applyIntervalFloor,
} from "./utils/math.js";
import { coerceBoolean } from "./utils/primitives.js";
import { invokeWithErrorBoundary } from "./utils/error.js";
import {
  ensureCanvasDimensions,
  resolveCanvas,
  resolveTimingProviders,
} from "./engine/environment.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

const MAX_CONCURRENT_EVENTS_FALLBACK = Math.max(
  0,
  Math.floor(SIMULATION_DEFAULTS.maxConcurrentEvents ?? 2),
);

const noop = () => {};

function sanitizeMaxConcurrentEvents(value, fallback = MAX_CONCURRENT_EVENTS_FALLBACK) {
  return sanitizeNumber(value, {
    fallback,
    min: 0,
    round: (candidate) => Math.floor(candidate),
  });
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
 * @param {string} [options.defaultCanvasId="gameCanvas"] - Identifier used when
 *   resolving a fallback canvas from the provided document.
 * @param {Object} [options.config] - Initial configuration (cell size, UI slider defaults, etc.).
 * @param {() => number} [options.rng=Math.random] - PRNG used by the grid and events.
 * @param {(cb: FrameRequestCallback) => number} [options.requestAnimationFrame] - Injected
 *   frame scheduler. Defaults to `window.requestAnimationFrame` or a setTimeout shim.
 * @param {(handle: number) => void} [options.cancelAnimationFrame] - Injected cancellation hook,
 *   mirroring the rAF source.
 * @param {() => number} [options.performanceNow] - High-resolution timer hook, defaults to
 *   `performance.now` with a Date fallback.
 * @param {Function} [options.drawOverlays] - Optional overlay renderer invoked each frame.
 *   Defaults to a no-op when omitted so the engine can operate without UI dependencies.
 * @param {Object} [options.selectionManager] - Optional selection manager to reuse.
 * @param {(rows:number, cols:number) => Object} [options.selectionManagerFactory]
 *   Factory invoked to create a selection manager when one is not supplied.
 * @param {Window} [options.window] - Optional window reference for SSR/test injection.
 * @param {Document} [options.document] - Optional document reference for SSR/test injection.
 * @param {boolean} [options.autoStart=true] - When true the engine immediately starts ticking.
 */
export default class SimulationEngine {
  constructor({
    canvas,
    config = {},
    defaultCanvasId,
    rng = Math.random,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    performanceNow: injectedNow,
    drawOverlays,
    window: injectedWindow,
    document: injectedDocument,
    autoStart = true,
    selectionManager,
    selectionManagerFactory,
  } = {}) {
    const win = injectedWindow ?? (typeof window !== "undefined" ? window : undefined);
    const doc =
      injectedDocument ?? (typeof document !== "undefined" ? document : undefined);
    const resolvedCanvas = resolveCanvas(canvas, doc, {
      fallbackId: defaultCanvasId,
    });

    if (!resolvedCanvas) {
      throw new Error("SimulationEngine requires a canvas element.");
    }

    const getContext =
      typeof resolvedCanvas.getContext === "function"
        ? resolvedCanvas.getContext
        : null;

    if (!getContext) {
      throw new Error("SimulationEngine requires a 2D canvas context.");
    }

    const ctx = getContext.call(resolvedCanvas, "2d");

    if (!ctx) {
      throw new Error("SimulationEngine requires a 2D canvas context.");
    }

    const { width, height } = ensureCanvasDimensions(resolvedCanvas, config);
    const toFinite = toFiniteOrNull;
    const resolvePositiveInt = (value, fallback) => {
      const candidate = [value, fallback]
        .map(toFinite)
        .find((numeric) => numeric != null && numeric > 0);

      return candidate != null ? Math.floor(candidate) : 1;
    };
    const resolvedCellSize = toFinite(config.cellSize);
    const cellSize = resolvedCellSize && resolvedCellSize > 0 ? resolvedCellSize : 5;
    const baseRows = height / cellSize;
    const baseCols = width / cellSize;
    const rows = resolvePositiveInt(config.rows, baseRows);
    const cols = resolvePositiveInt(config.cols, baseCols);

    this.window = win;
    this.document = doc;
    this.canvas = resolvedCanvas;
    this.ctx = ctx;
    this.cellSize = cellSize;
    this.rows = rows;
    this.cols = cols;
    this.canvasPixelRatio = this.#resolveDevicePixelRatio(win);
    this.canvasLogicalWidth = width;
    this.canvasLogicalHeight = height;
    this._pixelRatioCleanup = null;
    this.#applyCanvasResolution(width, height);
    this._obstaclePresets = resolveObstaclePresetCatalog(config.obstaclePresets);
    const { now, raf, caf } = resolveTimingProviders({
      window: win,
      requestAnimationFrame: injectedRaf,
      cancelAnimationFrame: injectedCaf,
      performanceNow: injectedNow,
    });

    this.now = now;
    this.raf = raf;
    this.caf = caf;
    this.rng = rng;
    this.drawOverlays = typeof drawOverlays === "function" ? drawOverlays : noop;

    const defaults = resolveSimulationDefaults(config);
    const maxConcurrentEvents = sanitizeMaxConcurrentEvents(
      defaults.maxConcurrentEvents,
    );

    defaults.maxConcurrentEvents = maxConcurrentEvents;

    const baseUpdatesCandidate =
      Number.isFinite(defaults.speedMultiplier) && defaults.speedMultiplier > 0
        ? defaults.updatesPerSecond / defaults.speedMultiplier
        : SIMULATION_DEFAULTS.updatesPerSecond;
    const normalizedBaseUpdates = Number.isFinite(baseUpdatesCandidate)
      ? baseUpdatesCandidate
      : SIMULATION_DEFAULTS.updatesPerSecond;

    this.baseUpdatesPerSecond = Math.max(1, Math.round(normalizedBaseUpdates));

    const defaultSpeedMultiplier = Number.isFinite(defaults.speedMultiplier)
      ? defaults.speedMultiplier
      : (() => {
          const base =
            this.baseUpdatesPerSecond > 0
              ? this.baseUpdatesPerSecond
              : Math.max(1, Math.round(SIMULATION_DEFAULTS.updatesPerSecond ?? 60));
          const derived = Math.max(1, Math.round(defaults.updatesPerSecond));
          const ratio = derived / base;

          return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
        })();

    this.eventManager = new EventManager(rows, cols, rng, {
      startWithEvent:
        (defaults.eventFrequencyMultiplier ?? 1) > 0 && maxConcurrentEvents > 0,
    });
    const runtimeServices = createSimulationRuntimeServices({
      rng,
      leaderboardSize: defaults.leaderboardSize,
      now: this.now,
    });

    this.stats = runtimeServices.stats;
    this.telemetry = runtimeServices.telemetry;
    runtimeServices.attachTo(this);
    const resolveSelectionManager = () => {
      if (selectionManager && typeof selectionManager === "object") {
        return selectionManager;
      }

      if (typeof selectionManagerFactory === "function") {
        const created = selectionManagerFactory(rows, cols);

        if (created && typeof created === "object") {
          return created;
        }
      }

      return createSelectionManagerStub(rows, cols);
    };

    this.selectionManager = resolveSelectionManager();
    const hasInitialPreset = typeof config.initialObstaclePreset === "string";
    const randomizeInitialObstacles =
      config.randomizeInitialObstacles ??
      (!hasInitialPreset || config.initialObstaclePreset === "random");
    const initialObstaclePreset = hasInitialPreset
      ? config.initialObstaclePreset
      : randomizeInitialObstacles
        ? "random"
        : "none";

    this.grid = new GridManager(rows, cols, {
      eventManager: this.eventManager,
      ctx: this.ctx,
      cellSize: this.cellSize,
      stats: this.stats,
      initialTileEnergyFraction: defaults.initialTileEnergyFraction,
      selectionManager: this.selectionManager,
      interactionSystemFactory: ({ adapter, gridManager }) =>
        new InteractionSystem({
          adapter,
          gridManager,
          combatTerritoryEdgeFactor: GridManager.combatTerritoryEdgeFactor,
        }),
      initialObstaclePreset,
      initialObstaclePresetOptions: config.initialObstaclePresetOptions,
      randomizeInitialObstacles,
      randomObstaclePresetPool: config.randomObstaclePresetPool,
      obstaclePresets: this._obstaclePresets,
      rng,
      performanceNow: this.now,
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
      speedMultiplier: defaultSpeedMultiplier,
      eventFrequencyMultiplier: defaults.eventFrequencyMultiplier,
      mutationMultiplier: defaults.mutationMultiplier,
      densityEffectMultiplier: defaults.densityEffectMultiplier,
      societySimilarity: defaults.societySimilarity,
      enemySimilarity: defaults.enemySimilarity,
      eventStrengthMultiplier: defaults.eventStrengthMultiplier,
      maxConcurrentEvents,
      energyRegenRate: defaults.energyRegenRate,
      energyDiffusionRate: defaults.energyDiffusionRate,
      combatEdgeSharpness: defaults.combatEdgeSharpness,
      combatTerritoryEdgeFactor: defaults.combatTerritoryEdgeFactor,
      showObstacles: defaults.showObstacles,
      showEnergy: defaults.showEnergy,
      showDensity: defaults.showDensity,
      showAge: defaults.showAge,
      showFitness: defaults.showFitness,
      showLifeEventMarkers: defaults.showLifeEventMarkers,
      showAuroraVeil: defaults.showAuroraVeil,
      showGridLines: defaults.showGridLines,
      showReproductiveZones: defaults.showReproductiveZones,
      leaderboardIntervalMs: defaults.leaderboardIntervalMs,
      leaderboardSize: defaults.leaderboardSize,
      matingDiversityThreshold: defaults.matingDiversityThreshold,
      lowDiversityReproMultiplier: defaults.lowDiversityReproMultiplier,
      initialTileEnergyFraction: defaults.initialTileEnergyFraction,
      autoPauseOnBlur: this.autoPauseOnBlur,
      autoPausePending: false,
      gridRows: rows,
      gridCols: cols,
      cellSize,
    };

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
    this.telemetry.setInitialSnapshot(this.grid.getLastSnapshot());
    this.telemetry.clearPending();
    this.telemetry.resetThrottle(Number.NEGATIVE_INFINITY);
    this.lastUpdateTime = 0;
    this.running = false;
    this.frameHandle = null;

    this.listeners = new Map();

    this._autoPauseCleanup = this.#installAutoPauseHandlers(win, doc);
    this._pixelRatioCleanup = this.#installPixelRatioListener(win);

    if (autoStart) {
      this.start();
    }
  }

  get obstaclePresets() {
    return this._obstaclePresets;
  }

  /**
   * Returns the identifier of the obstacle preset currently applied to the
   * grid. UI surfaces rely on this to mirror the active layout selection.
   *
   * @returns {string} Active obstacle preset identifier or "none" when unset.
   */
  getCurrentObstaclePreset() {
    const preset = this.grid?.currentObstaclePreset;

    if (typeof preset === "string" && preset.length > 0) {
      return preset;
    }

    return "none";
  }

  get isRunning() {
    return this.running;
  }

  isPaused() {
    return Boolean(this.state.paused);
  }

  getStateSnapshot() {
    return { ...this.state };
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
      invokeWithErrorBoundary(handler, [payload], {
        message: () =>
          `SimulationEngine listener for "${event}" threw; continuing without interruption.`,
        once: true,
      });
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
        this.telemetry.resetThrottle(Number.NEGATIVE_INFINITY);
      }

      this.emit("state", { state: this.getStateSnapshot(), changes });
    }

    return changed;
  }

  #updateStateAndFlag(partial) {
    const changed = this.#updateState(partial);

    if (changed) {
      this.telemetry.markPending();
    }

    return changed;
  }

  #sanitizeAndSetState(key, value, options, { markPending = true } = {}) {
    const { fallback = this.state[key], ...rest } = options ?? {};
    const sanitized = sanitizeNumber(value, { fallback, ...rest });

    if (markPending) {
      this.#updateStateAndFlag({ [key]: sanitized });
    } else {
      this.#updateState({ [key]: sanitized });
    }

    return sanitized;
  }

  #setAutoPausePending(pending) {
    const normalized = Boolean(pending);

    if (
      this._autoPauseResumePending === normalized &&
      this.state.autoPausePending === normalized
    ) {
      return;
    }

    this._autoPauseResumePending = normalized;
    this.#updateState({ autoPausePending: normalized });
  }

  #handleAutoPauseTrigger() {
    if (!this.autoPauseOnBlur) return;
    if (this._autoPauseResumePending) return;
    if (!this.running) return;
    if (this.isPaused()) return;

    this.pause();

    if (this.isPaused()) {
      this.#setAutoPausePending(true);
    }
  }

  #handleAutoPauseResume() {
    if (!this._autoPauseResumePending) return;

    this.resume();
    this.#setAutoPausePending(false);
  }

  #resolveDevicePixelRatio(win) {
    const ratio = Number(win?.devicePixelRatio);

    if (!Number.isFinite(ratio) || ratio <= 0) {
      return 1;
    }

    return Math.min(ratio, 4);
  }

  #applyCanvasResolution(width, height) {
    const canvas = this.canvas;
    const ctx = this.ctx;

    if (!canvas || !ctx) {
      return;
    }

    const logicalWidth = Math.max(1, Math.round(Number(width) || 0));
    const logicalHeight = Math.max(1, Math.round(Number(height) || 0));

    this.canvasLogicalWidth = logicalWidth;
    this.canvasLogicalHeight = logicalHeight;

    const ratio =
      Number.isFinite(this.canvasPixelRatio) && this.canvasPixelRatio > 0
        ? this.canvasPixelRatio
        : 1;
    const scaledWidth = Math.max(1, Math.round(logicalWidth * ratio));
    const scaledHeight = Math.max(1, Math.round(logicalHeight * ratio));

    if (canvas.width !== scaledWidth) canvas.width = scaledWidth;
    if (canvas.height !== scaledHeight) canvas.height = scaledHeight;

    if (typeof ctx.setTransform === "function") {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    } else {
      if (typeof ctx.resetTransform === "function") {
        ctx.resetTransform();
      }
      if (typeof ctx.scale === "function") {
        ctx.scale(ratio, ratio);
      }
    }

    if (ctx.imageSmoothingEnabled != null) {
      ctx.imageSmoothingEnabled = false;
    }
  }

  #installPixelRatioListener(win) {
    if (!win || typeof win.addEventListener !== "function") {
      return () => {};
    }

    const handleResize = () => {
      const nextRatio = this.#resolveDevicePixelRatio(win);

      if (!Number.isFinite(nextRatio) || nextRatio <= 0) {
        return;
      }

      if (Math.abs(nextRatio - (this.canvasPixelRatio ?? 1)) < 0.001) {
        return;
      }

      this.canvasPixelRatio = nextRatio;
      const width = this.canvasLogicalWidth ?? this.cols * this.cellSize;
      const height = this.canvasLogicalHeight ?? this.rows * this.cellSize;

      this.#applyCanvasResolution(width, height);
    };

    win.addEventListener("resize", handleResize);

    return () => {
      win.removeEventListener("resize", handleResize);
    };
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
      const width = clamp(Math.round(rawWidth), 0, this.cols);
      const height = clamp(Math.round(rawHeight), 0, this.rows);
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
   * - The telemetry controller flags slow UI updates as pending whenever GridManager produces a new
   *   snapshot and Stats ingest fresh metrics. The `leaderboardIntervalMs` throttle guards how
   *   often the expensive leaderboard aggregation runs, ensuring UI work is batched even if
   *   simulation ticks faster.
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
      (force && (!paused || allowPausedTick)) ||
      (!paused && elapsed >= interval) ||
      (allowPausedTick && paused);

    if (shouldAdvance) {
      this.lastUpdateTime = effectiveTimestamp;
      tickOccurred = true;
      this.stats.resetTick();
      this.eventManager.updateEvent?.(
        this.state.eventFrequencyMultiplier ?? 1,
        this.state.maxConcurrentEvents ?? MAX_CONCURRENT_EVENTS_FALLBACK,
      );
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
        combatTerritoryEdgeFactor:
          this.state.combatTerritoryEdgeFactor ?? COMBAT_TERRITORY_EDGE_FACTOR,
      });

      this.stats.logEvent?.(
        this.eventManager.currentEvent,
        this.state.eventStrengthMultiplier ?? 1,
      );
      this.stats.setMutationMultiplier?.(this.state.mutationMultiplier ?? 1);

      const metrics = this.telemetry.ingestSnapshot(snapshot);
      // Defer leaderboard/metrics publication until the throttle window allows another emit.

      this.telemetry.markPending();

      this.emit("tick", {
        snapshot,
        metrics,
        timestamp: effectiveTimestamp,
      });
    }

    const renderSnapshot = this.grid.draw({
      showObstacles: this.state.showObstacles ?? true,
    });

    if (renderSnapshot) {
      this.telemetry.includeRenderStats(renderSnapshot);
    }

    const includeLifeEventMarkers = Boolean(this.state.showLifeEventMarkers);
    const includeAgeOverlay = Boolean(this.state.showAge);
    const totalTicks = Number.isFinite(this.stats?.totals?.ticks)
      ? this.stats.totals.ticks
      : null;
    const recentLifeEvents =
      includeLifeEventMarkers && typeof this.stats?.getRecentLifeEvents === "function"
        ? this.stats.getRecentLifeEvents()
        : null;

    this.drawOverlays(this.grid, this.ctx, this.cellSize, {
      showEnergy: this.state.showEnergy ?? false,
      showDensity: this.state.showDensity ?? false,
      showAge: includeAgeOverlay,
      showFitness: this.state.showFitness ?? false,
      showObstacles: this.state.showObstacles ?? true,
      showLifeEventMarkers: includeLifeEventMarkers,
      showAuroraVeil: this.state.showAuroraVeil ?? false,
      showGridLines: this.state.showGridLines ?? false,
      showReproductiveZones:
        this.state.showReproductiveZones !== undefined
          ? this.state.showReproductiveZones
          : true,
      maxTileEnergy: Number.isFinite(this.grid?.maxTileEnergy)
        ? this.grid.maxTileEnergy
        : GridManager.maxTileEnergy,
      snapshot: this.telemetry.snapshot,
      activeEvents: this.eventManager.activeEvents,
      getEventColor: this.eventManager.getColor?.bind(this.eventManager),
      mutationMultiplier: this.state.mutationMultiplier ?? 1,
      selectionManager: this.selectionManager,
      lifeEvents: recentLifeEvents,
      currentTick: totalTicks,
      lifeEventFadeTicks: this.stats?.lifeEventFadeTicks,
    });

    if (this.telemetry.hasPending()) {
      this.telemetry.publishIfDue({
        timestamp: effectiveTimestamp,
        interval: this.state.leaderboardIntervalMs,
        getEnvironment: () => ({
          activeEvents: this.#summarizeActiveEvents(),
          updatesPerSecond: Math.max(1, Math.round(this.state.updatesPerSecond ?? 60)),
          eventStrengthMultiplier: Number.isFinite(this.state.eventStrengthMultiplier)
            ? this.state.eventStrengthMultiplier
            : 1,
          combatTerritoryEdgeFactor:
            this.state.combatTerritoryEdgeFactor ?? COMBAT_TERRITORY_EDGE_FACTOR,
        }),
        emitMetrics: (payload) => this.emit("metrics", payload),
        emitLeaderboard: (payload) => this.emit("leaderboard", payload),
      });
    }

    if (scheduleNext) {
      const shouldContinue = !paused || this.telemetry.hasPending();

      if (shouldContinue) {
        this.#scheduleNextFrame();
      }
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
    const paused = coerceBoolean(value, this.state.paused);
    const changed = this.#updateState({ paused });

    if (!paused) {
      this.#setAutoPausePending(false);
    }

    if (!paused && this.running) {
      this.#scheduleNextFrame();
    }

    return changed;
  }

  pause() {
    this.setPaused(true);
    this.#setAutoPausePending(false);

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

  setWorldGeometry(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const randomizeObstacles = coerceBoolean(opts.randomizeObstacles, false);
    const obstaclePreset = opts.obstaclePreset;
    const presetOptions = opts.presetOptions;
    const reseed = coerceBoolean(opts.reseed, false);

    const targetCellSize = sanitizePositiveInteger(opts.cellSize, {
      fallback: this.cellSize,
    });
    const targetRows = sanitizePositiveInteger(opts.rows, {
      fallback: this.rows,
    });
    const targetCols = sanitizePositiveInteger(opts.cols, {
      fallback: this.cols,
    });

    const geometryChanged =
      targetCellSize !== this.cellSize ||
      targetRows !== this.rows ||
      targetCols !== this.cols;
    const wantsPresetUpdate =
      randomizeObstacles ||
      (typeof obstaclePreset === "string" && obstaclePreset.trim().length > 0) ||
      typeof presetOptions === "function" ||
      (presetOptions &&
        typeof presetOptions === "object" &&
        Object.keys(presetOptions).length > 0);

    if (!geometryChanged && !wantsPresetUpdate && !reseed) {
      return { cellSize: this.cellSize, rows: this.rows, cols: this.cols };
    }

    const wasRunning = this.running;
    const wasPaused = this.isPaused();

    this.stop();
    this.#setAutoPausePending(false);

    this.cellSize = targetCellSize;
    this.rows = targetRows;
    this.cols = targetCols;

    if (this.canvas) {
      this.#applyCanvasResolution(this.cols * this.cellSize, this.rows * this.cellSize);
    }

    if (this.selectionManager?.setDimensions) {
      this.selectionManager.setDimensions(this.rows, this.cols);
    }

    if (typeof this.eventManager?.setDimensions === "function") {
      this.eventManager.setDimensions(this.rows, this.cols);
    } else if (this.eventManager) {
      this.eventManager.rows = this.rows;
      this.eventManager.cols = this.cols;
    }

    this.grid?.resize?.(this.rows, this.cols, {
      cellSize: this.cellSize,
      randomizeObstacles,
      obstaclePreset,
      presetOptions,
      reseed,
    });

    const shouldStartWithEvent =
      (this.state.eventFrequencyMultiplier ?? 1) > 0 &&
      (this.state.maxConcurrentEvents ?? MAX_CONCURRENT_EVENTS_FALLBACK) > 0;

    if (typeof this.eventManager?.reset === "function") {
      this.eventManager.reset({ startWithEvent: shouldStartWithEvent });
    } else if (this.eventManager) {
      this.eventManager.activeEvents = [];
      this.eventManager.currentEvent = null;
      this.eventManager.cooldown = 0;
    }

    if (typeof this.stats?.resetAll === "function") {
      this.stats.resetAll();
    } else {
      this.stats?.resetTick?.();
    }

    const diversityThreshold =
      this.state.matingDiversityThreshold ??
      SIMULATION_DEFAULTS.matingDiversityThreshold;

    if (typeof this.stats?.setMatingDiversityThreshold === "function") {
      this.stats.setMatingDiversityThreshold(diversityThreshold);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = diversityThreshold;
    }

    this.grid?.setMatingDiversityOptions?.({
      threshold: diversityThreshold,
      lowDiversityMultiplier:
        this.state.lowDiversityReproMultiplier ??
        SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
    });

    if (typeof this.stats?.setMutationMultiplier === "function") {
      this.stats.setMutationMultiplier(this.state.mutationMultiplier ?? 1);
    }

    if (reseed && typeof this.grid?.resetWorld === "function") {
      this.grid.resetWorld({
        randomizeObstacles,
        obstaclePreset,
        presetOptions,
        reseed,
        clearCustomZones: true,
      });
    }

    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.canvas?.width ?? 0, this.canvas?.height ?? 0);
    }

    const snapshot =
      typeof this.grid?.buildSnapshot === "function" ? this.grid.buildSnapshot() : null;

    this.telemetry.ingestSnapshot(snapshot);
    this.telemetry.markPending();
    this.telemetry.resetThrottle(Number.NEGATIVE_INFINITY);
    this.lastUpdateTime = this.now();

    this.#updateState({
      cellSize: this.cellSize,
      gridRows: this.rows,
      gridCols: this.cols,
    });

    if (wasRunning) {
      this.start();
      if (wasPaused) {
        this.pause();
      }
    } else {
      this.setPaused(wasPaused);
    }

    return { cellSize: this.cellSize, rows: this.rows, cols: this.cols };
  }

  resetWorld(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const wasRunning = this.running;
    const wasPaused = this.isPaused();
    const randomizeObstacles = coerceBoolean(opts.randomizeObstacles, false);
    const reseed = coerceBoolean(opts.reseed, false);
    const clearCustomZones = coerceBoolean(opts.clearCustomZones, false);

    this.stop();
    this.#setAutoPausePending(false);

    if (typeof this.stats?.resetAll === "function") {
      this.stats.resetAll();
    } else {
      this.stats?.resetTick?.();
    }

    const shouldStartWithEvent =
      (this.state.eventFrequencyMultiplier ?? 1) > 0 &&
      (this.state.maxConcurrentEvents ?? MAX_CONCURRENT_EVENTS_FALLBACK) > 0;

    if (typeof this.eventManager?.reset === "function") {
      this.eventManager.reset({ startWithEvent: shouldStartWithEvent });
    } else if (this.eventManager) {
      this.eventManager.activeEvents = [];
      this.eventManager.currentEvent = null;
      this.eventManager.cooldown = 0;
    }

    if (typeof this.grid?.resetWorld === "function") {
      this.grid.resetWorld({
        randomizeObstacles,
        obstaclePreset: opts.obstaclePreset,
        presetOptions: opts.presetOptions,
        reseed,
        clearCustomZones,
      });
    }

    const diversityThreshold =
      this.state.matingDiversityThreshold ??
      SIMULATION_DEFAULTS.matingDiversityThreshold;

    if (typeof this.stats?.setMatingDiversityThreshold === "function") {
      this.stats.setMatingDiversityThreshold(diversityThreshold);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = diversityThreshold;
    }

    if (typeof this.grid?.setMatingDiversityOptions === "function") {
      this.grid.setMatingDiversityOptions({
        threshold: this.stats?.matingDiversityThreshold,
        lowDiversityMultiplier:
          this.state.lowDiversityReproMultiplier ??
          SIMULATION_DEFAULTS.lowDiversityReproMultiplier,
      });
    }

    const snapshot =
      typeof this.grid?.buildSnapshot === "function" ? this.grid.buildSnapshot() : null;

    if (typeof this.stats?.setMutationMultiplier === "function") {
      this.stats.setMutationMultiplier(this.state.mutationMultiplier ?? 1);
    }

    this.telemetry.ingestSnapshot(snapshot);
    this.telemetry.publishNow({
      timestamp: this.now(),
      getEnvironment: () => ({
        activeEvents: this.#summarizeActiveEvents(),
        updatesPerSecond: Math.max(1, Math.round(this.state.updatesPerSecond ?? 60)),
        eventStrengthMultiplier: Number.isFinite(this.state.eventStrengthMultiplier)
          ? this.state.eventStrengthMultiplier
          : 1,
        combatTerritoryEdgeFactor:
          this.state.combatTerritoryEdgeFactor ?? COMBAT_TERRITORY_EDGE_FACTOR,
      }),
      emitMetrics: (payload) => this.emit("metrics", payload),
      emitLeaderboard: (payload) => this.emit("leaderboard", payload),
    });

    const showObstacles = this.state.showObstacles ?? true;

    this.grid?.draw?.({ showObstacles });
    const includeLifeEventMarkers = Boolean(this.state.showLifeEventMarkers);
    const includeAgeOverlay = Boolean(this.state.showAge);
    const totalTicks = Number.isFinite(this.stats?.totals?.ticks)
      ? this.stats.totals.ticks
      : null;
    const recentLifeEvents =
      includeLifeEventMarkers && typeof this.stats?.getRecentLifeEvents === "function"
        ? this.stats.getRecentLifeEvents()
        : null;

    this.drawOverlays(this.grid, this.ctx, this.cellSize, {
      showEnergy: this.state.showEnergy ?? false,
      showDensity: this.state.showDensity ?? false,
      showAge: includeAgeOverlay,
      showFitness: this.state.showFitness ?? false,
      showObstacles,
      showLifeEventMarkers: includeLifeEventMarkers,
      showAuroraVeil: this.state.showAuroraVeil ?? false,
      showGridLines: this.state.showGridLines ?? false,
      maxTileEnergy: Number.isFinite(this.grid?.maxTileEnergy)
        ? this.grid.maxTileEnergy
        : GridManager.maxTileEnergy,
      snapshot: this.telemetry.snapshot,
      activeEvents: this.eventManager?.activeEvents,
      getEventColor: this.eventManager?.getColor?.bind(this.eventManager),
      mutationMultiplier: this.state.mutationMultiplier ?? 1,
      selectionManager: this.selectionManager,
      lifeEvents: recentLifeEvents,
      currentTick: totalTicks,
      lifeEventFadeTicks: this.stats?.lifeEventFadeTicks,
    });

    this.telemetry.resetThrottle(this.now());
    this.telemetry.clearPending();

    if (wasRunning) {
      this.start();

      if (wasPaused) {
        this.pause();
      }
    } else {
      this.setPaused(wasPaused);
    }
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

    if (typeof this._pixelRatioCleanup === "function") {
      this._pixelRatioCleanup();
      this._pixelRatioCleanup = null;
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
    const sanitized = sanitizeNumber(value, {
      fallback: this.state.updatesPerSecond,
      min: 1,
      round: true,
    });

    const base = this.baseUpdatesPerSecond > 0 ? this.baseUpdatesPerSecond : sanitized;
    const multiplier = base > 0 ? sanitized / base : this.state.speedMultiplier;

    this.#updateStateAndFlag({
      updatesPerSecond: sanitized,
      speedMultiplier: Number.isFinite(multiplier)
        ? multiplier
        : this.state.speedMultiplier,
    });

    return sanitized;
  }

  setEventFrequencyMultiplier(value) {
    this.#sanitizeAndSetState("eventFrequencyMultiplier", value, {
      min: 0,
    });
  }

  setMaxConcurrentEvents(value) {
    const sanitized = sanitizeMaxConcurrentEvents(
      value,
      this.state.maxConcurrentEvents,
    );

    this.#updateStateAndFlag({ maxConcurrentEvents: sanitized });
  }

  setMutationMultiplier(value) {
    this.#sanitizeAndSetState("mutationMultiplier", value, {
      min: 0,
    });
  }

  setCombatEdgeSharpness(value) {
    this.#sanitizeAndSetState("combatEdgeSharpness", value, {
      min: 0.1,
    });
  }

  setCombatTerritoryEdgeFactor(value) {
    this.#sanitizeAndSetState("combatTerritoryEdgeFactor", value, {
      min: 0,
      max: 1,
    });
  }

  setDensityEffectMultiplier(value) {
    this.#sanitizeAndSetState("densityEffectMultiplier", value, {
      min: 0,
    });
  }

  setSimilarityThresholds({ societySimilarity, enemySimilarity }) {
    const changes = {};

    if (societySimilarity !== undefined) {
      changes.societySimilarity = sanitizeNumber(societySimilarity, {
        fallback: this.state.societySimilarity,
        min: 0,
        max: 1,
      });
    }

    if (enemySimilarity !== undefined) {
      changes.enemySimilarity = sanitizeNumber(enemySimilarity, {
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
    this.#sanitizeAndSetState("eventStrengthMultiplier", value, {
      min: 0,
    });
  }

  setEnergyRates({ regen, diffusion }) {
    const changes = {};

    if (regen !== undefined) {
      changes.energyRegenRate = sanitizeNumber(regen, {
        fallback: this.state.energyRegenRate,
        min: 0,
      });
    }

    if (diffusion !== undefined) {
      changes.energyDiffusionRate = sanitizeNumber(diffusion, {
        fallback: this.state.energyDiffusionRate,
        min: 0,
      });
    }

    if (Object.keys(changes).length > 0) {
      this.#updateStateAndFlag(changes);
    }
  }

  setInitialTileEnergyFraction(value, { refreshEmptyTiles = true } = {}) {
    const sanitized = sanitizeNumber(value, {
      fallback: this.state.initialTileEnergyFraction,
      min: 0,
      max: 1,
    });

    if (!Number.isFinite(sanitized)) {
      return;
    }

    const previous = Number.isFinite(this.state.initialTileEnergyFraction)
      ? this.state.initialTileEnergyFraction
      : SIMULATION_DEFAULTS.initialTileEnergyFraction;
    const changed = Math.abs(previous - sanitized) > 1e-6;

    this.grid?.setInitialTileEnergyFraction?.(sanitized, {
      refreshEmptyTiles,
      forceRefresh: refreshEmptyTiles && !changed,
    });

    this.#updateState({ initialTileEnergyFraction: sanitized });
  }

  setLeaderboardSize(value) {
    const fallback = Number.isFinite(this.state.leaderboardSize)
      ? this.state.leaderboardSize
      : (SIMULATION_DEFAULTS.leaderboardSize ?? 0);
    const sanitized = sanitizeNumber(value, {
      fallback,
      min: 0,
      round: Math.floor,
    });
    const normalized =
      Number.isFinite(sanitized) && sanitized >= 0 ? sanitized : fallback;

    if (normalized === this.state.leaderboardSize) {
      return normalized;
    }

    this.telemetry?.setLeaderboardSize?.(normalized);
    this.telemetry?.markPending?.();
    this.telemetry?.resetThrottle?.(Number.NEGATIVE_INFINITY);
    this.#updateState({ leaderboardSize: normalized });

    return normalized;
  }

  setLeaderboardInterval(value) {
    const fallback = Number.isFinite(this.state.leaderboardIntervalMs)
      ? this.state.leaderboardIntervalMs
      : (SIMULATION_DEFAULTS.leaderboardIntervalMs ?? LEADERBOARD_INTERVAL_MIN_MS);
    const sanitized = sanitizeNumber(value, {
      fallback,
      min: 0,
    });

    if (!Number.isFinite(sanitized)) {
      return this.state.leaderboardIntervalMs;
    }

    const normalized = applyIntervalFloor(sanitized, LEADERBOARD_INTERVAL_MIN_MS);

    this.#updateState({ leaderboardIntervalMs: normalized });

    return normalized;
  }

  setOverlayVisibility({
    showObstacles,
    showEnergy,
    showDensity,
    showAge,
    showFitness,
    showLifeEventMarkers,
    showAuroraVeil,
    showGridLines,
    showReproductiveZones,
  }) {
    const entries = Object.entries({
      showObstacles,
      showEnergy,
      showDensity,
      showAge,
      showFitness,
      showLifeEventMarkers,
      showAuroraVeil,
      showGridLines,
      showReproductiveZones,
    })
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, coerceBoolean(value, Boolean(this.state?.[key]))]);

    if (entries.length === 0) return;

    const changed = this.#updateState(Object.fromEntries(entries));

    if (changed) {
      this.requestFrame();
    }
  }

  setAutoPauseOnBlur(value) {
    const enabled = coerceBoolean(value, this.autoPauseOnBlur);

    if (this.autoPauseOnBlur === enabled) return;

    const wasPendingAutoResume = this._autoPauseResumePending === true;
    const wasPaused = this.isPaused();
    const wasRunning = this.running;

    this.autoPauseOnBlur = enabled;

    if (!enabled) {
      this.#setAutoPausePending(false);

      if (wasPendingAutoResume && wasPaused && wasRunning) {
        this.resume();
      }
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
      case "maxConcurrentEvents":
        this.setMaxConcurrentEvents(value);
        break;
      case "combatEdgeSharpness":
        this.setCombatEdgeSharpness(value);
        break;
      case "combatTerritoryEdgeFactor":
        this.setCombatTerritoryEdgeFactor(value);
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
      case "initialTileEnergyFraction":
        this.setInitialTileEnergyFraction(value);
        break;
      case "mutationMultiplier":
        this.setMutationMultiplier(value);
        break;
      case "leaderboardSize":
        this.setLeaderboardSize(value);
        break;
      case "matingDiversityThreshold":
        this.setMatingDiversityThreshold(value);
        break;
      case "lowDiversityReproMultiplier":
        this.setLowDiversityReproMultiplier(value);
        break;
      case "speedMultiplier": {
        const sanitized = sanitizeNumber(value, {
          fallback: Number.isFinite(this.state.speedMultiplier)
            ? this.state.speedMultiplier
            : 1,
          min: 0.1,
        });

        if (!Number.isFinite(sanitized)) break;

        const baseUpdates =
          this.baseUpdatesPerSecond > 0
            ? this.baseUpdatesPerSecond
            : (SIMULATION_DEFAULTS.updatesPerSecond ?? 60);

        this.setUpdatesPerSecond(baseUpdates * sanitized);
        break;
      }
      case "leaderboardIntervalMs":
        this.setLeaderboardInterval(value);
        break;
      case "showObstacles":
      case "showEnergy":
      case "showDensity":
      case "showAge":
      case "showFitness":
      case "showLifeEventMarkers":
      case "showAuroraVeil":
      case "showGridLines":
      case "showReproductiveZones":
        this.setOverlayVisibility({ [key]: value });
        break;
      case "autoPauseOnBlur":
        this.setAutoPauseOnBlur(value);
        break;
      default:
        break;
    }
  }

  setMatingDiversityThreshold(value) {
    const clamped = sanitizeUnitInterval(value);

    if (clamped === null) return;

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
    const clamped = sanitizeUnitInterval(value);

    if (clamped === null) return;

    if (this.state.lowDiversityReproMultiplier === clamped) return;

    this.grid.setMatingDiversityOptions?.({
      threshold:
        this.state.matingDiversityThreshold ??
        this.stats?.matingDiversityThreshold ??
        SIMULATION_DEFAULTS.matingDiversityThreshold ??
        0.42,
      lowDiversityMultiplier: clamped,
    });

    this.#updateState({ lowDiversityReproMultiplier: clamped });
  }

  burstRandomCells(options = {}) {
    return this.grid.burstRandomCells(options);
  }

  applyObstaclePreset(id, options) {
    this.grid.applyObstaclePreset(id, options);
    this.grid?.draw?.({ showObstacles: this.state.showObstacles ?? true });
    this.requestFrame();
  }
}

export { ensureCanvasDimensions, resolveCanvas };
