import EventManager from '../eventManager.js';
import GridManager, { OBSTACLE_PRESETS, OBSTACLE_SCENARIOS } from '../gridManager.js';
import SelectionManager from '../selectionManager.js';
import Stats from '../stats.js';
import {
  ENERGY_DIFFUSION_RATE_DEFAULT,
  ENERGY_REGEN_RATE_DEFAULT,
  UI_SLIDER_CONFIG,
} from '../config.js';

const defaultNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }

  return Date.now();
};

const defaultRequestAnimationFrame = (cb) => setTimeout(() => cb(defaultNow()), 16);
const defaultCancelAnimationFrame = (id) => clearTimeout(id);

function sanitizeNumber(value, fallback, { min = -Infinity, max = Infinity, round = false } = {}) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return fallback;

  const clamped = Math.min(max, Math.max(min, numeric));

  if (!round) return clamped;

  return Math.round(clamped);
}

export default class SimulationRuntime {
  constructor({
    grid,
    gridOptions = {},
    stats,
    eventManager,
    selectionManager,
    rng = Math.random,
    performanceNow: injectedNow,
    requestAnimationFrame: injectedRaf,
    cancelAnimationFrame: injectedCaf,
    renderer = null,
    initialState = {},
    autoStart = true,
  } = {}) {
    if (!grid) {
      const {
        rows,
        cols,
        cellSize = 5,
        ctx = null,
        stats: statsOption,
        selectionManager: selectionOption,
        eventManager: eventManagerOption,
        initialObstaclePreset,
        initialObstaclePresetOptions,
        randomizeInitialObstacles,
        randomObstaclePresetPool,
      } = gridOptions ?? {};

      if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
        throw new Error('SimulationRuntime requires grid dimensions to construct a grid.');
      }

      const resolvedStats = statsOption ?? stats ?? new Stats();
      const resolvedSelection =
        selectionOption ?? selectionManager ?? new SelectionManager(rows, cols);
      const resolvedEventManager =
        eventManagerOption ?? eventManager ?? new EventManager(rows, cols, rng);

      this.stats = resolvedStats;
      this.selectionManager = resolvedSelection;
      this.eventManager = resolvedEventManager;

      this.grid = new GridManager(rows, cols, {
        eventManager: this.eventManager,
        ctx,
        cellSize,
        stats: this.stats,
        selectionManager: this.selectionManager,
        initialObstaclePreset,
        initialObstaclePresetOptions,
        randomizeInitialObstacles,
        randomObstaclePresetPool,
        rng,
      });
    } else {
      this.grid = grid;
      this.stats = stats ?? grid.stats ?? new Stats();
      this.eventManager =
        eventManager ?? grid.eventManager ?? new EventManager(grid.rows, grid.cols, rng);
      this.selectionManager =
        selectionManager ?? grid.selectionManager ?? new SelectionManager(grid.rows, grid.cols);
    }

    this.now = typeof injectedNow === 'function' ? injectedNow : defaultNow;
    this.raf = typeof injectedRaf === 'function' ? injectedRaf : defaultRequestAnimationFrame;
    this.caf = typeof injectedCaf === 'function' ? injectedCaf : defaultCancelAnimationFrame;

    this.renderer = renderer;

    const stateDefaults = {
      paused: Boolean(initialState.paused ?? false),
      updatesPerSecond: Math.max(1, Math.round(initialState.updatesPerSecond ?? 60)),
      eventFrequencyMultiplier:
        initialState.eventFrequencyMultiplier ?? UI_SLIDER_CONFIG.eventFrequencyMultiplier.default,
      mutationMultiplier:
        initialState.mutationMultiplier ?? UI_SLIDER_CONFIG.mutationMultiplier.default,
      densityEffectMultiplier:
        initialState.densityEffectMultiplier ?? UI_SLIDER_CONFIG.densityEffectMultiplier.default,
      societySimilarity:
        initialState.societySimilarity ?? UI_SLIDER_CONFIG.societySimilarity.default,
      enemySimilarity: initialState.enemySimilarity ?? UI_SLIDER_CONFIG.enemySimilarity.default,
      eventStrengthMultiplier:
        initialState.eventStrengthMultiplier ?? UI_SLIDER_CONFIG.eventStrengthMultiplier.default,
      energyRegenRate: initialState.energyRegenRate ?? ENERGY_REGEN_RATE_DEFAULT,
      energyDiffusionRate: initialState.energyDiffusionRate ?? ENERGY_DIFFUSION_RATE_DEFAULT,
      showObstacles: initialState.showObstacles ?? true,
      showEnergy: initialState.showEnergy ?? false,
      showDensity: initialState.showDensity ?? false,
      showFitness: initialState.showFitness ?? false,
      leaderboardIntervalMs:
        initialState.leaderboardIntervalMs ?? UI_SLIDER_CONFIG.leaderboardIntervalMs.default,
      matingDiversityThreshold:
        initialState.matingDiversityThreshold ??
        UI_SLIDER_CONFIG.matingDiversityThreshold?.default ??
        0.45,
      lowDiversityReproMultiplier:
        initialState.lowDiversityReproMultiplier ??
        UI_SLIDER_CONFIG.lowDiversityReproMultiplier?.default ??
        0.1,
    };

    this.state = stateDefaults;
    this.lingerPenalty = initialState.lingerPenalty ?? 0;

    this.grid.setLingerPenalty?.(this.lingerPenalty);

    const initialThreshold = this.state.matingDiversityThreshold;

    if (typeof this.stats?.setMatingDiversityThreshold === 'function') {
      this.stats.setMatingDiversityThreshold(initialThreshold);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = initialThreshold;
    }

    this.grid.setMatingDiversityOptions?.({
      threshold: this.stats?.matingDiversityThreshold,
      lowDiversityMultiplier: this.state.lowDiversityReproMultiplier,
    });

    this.running = false;
    this.frameHandle = null;
    this.lastUpdateTime = 0;
    this.lastSnapshot = this.grid.getLastSnapshot?.() ?? null;
    this.lastMetrics = null;

    this.listeners = new Map();

    if (autoStart) {
      this.start();
    }
  }

  get obstaclePresets() {
    return OBSTACLE_PRESETS;
  }

  get obstacleScenarios() {
    return OBSTACLE_SCENARIOS;
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

  setRenderer(renderer) {
    this.renderer = renderer;
    if (this.renderer) {
      this.requestFrame();
    }
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};

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
        setTimeout(() => {
          throw error;
        }, 0);
      }
    });
  }

  #updateState(partial) {
    if (!partial || typeof partial !== 'object') return false;

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
      this.emit('state', { state: this.getStateSnapshot(), changes });
      this.requestFrame();
    }

    return changed;
  }

  #scheduleNextFrame() {
    if (!this.running || this.frameHandle != null) return;

    this.frameHandle = this.raf((timestamp) => {
      this.frameHandle = null;
      const ts = typeof timestamp === 'number' ? timestamp : this.now();

      this.#frame(ts, { scheduleNext: true });
    });
  }

  requestFrame() {
    if (!this.running) return;
    this.#scheduleNextFrame();
  }

  #frame(timestamp, { scheduleNext = false, force = false } = {}) {
    if (!this.running && !force) return false;

    const effectiveTimestamp = typeof timestamp === 'number' ? timestamp : this.now();
    let tickOccurred = false;

    if (!this.state.paused) {
      const interval = 1000 / Math.max(1, this.state.updatesPerSecond);

      if (effectiveTimestamp - this.lastUpdateTime >= interval) {
        this.lastUpdateTime = effectiveTimestamp;
        tickOccurred = true;
        this.stats.resetTick?.();
        this.eventManager.updateEvent?.(this.state.eventFrequencyMultiplier ?? 1, 2);
        const snapshot = this.grid.update({
          densityEffectMultiplier: this.state.densityEffectMultiplier ?? 1,
          societySimilarity:
            this.state.societySimilarity ?? UI_SLIDER_CONFIG.societySimilarity.default,
          enemySimilarity: this.state.enemySimilarity ?? UI_SLIDER_CONFIG.enemySimilarity.default,
          eventStrengthMultiplier: this.state.eventStrengthMultiplier ?? 1,
          energyRegenRate: this.state.energyRegenRate ?? ENERGY_REGEN_RATE_DEFAULT,
          energyDiffusionRate: this.state.energyDiffusionRate ?? ENERGY_DIFFUSION_RATE_DEFAULT,
          mutationMultiplier: this.state.mutationMultiplier ?? 1,
          matingDiversityThreshold:
            this.state.matingDiversityThreshold ??
            UI_SLIDER_CONFIG.matingDiversityThreshold?.default,
          lowDiversityReproMultiplier:
            this.state.lowDiversityReproMultiplier ??
            UI_SLIDER_CONFIG.lowDiversityReproMultiplier?.default ??
            0.1,
        });

        this.lastSnapshot = snapshot;
        this.stats.logEvent?.(
          this.eventManager.currentEvent,
          this.state.eventStrengthMultiplier ?? 1
        );
        this.stats.setMutationMultiplier?.(this.state.mutationMultiplier ?? 1);
        this.lastMetrics = this.stats.updateFromSnapshot?.(snapshot) ?? null;

        this.emit('tick', {
          snapshot,
          metrics: this.lastMetrics,
          stats: this.stats,
          timestamp: effectiveTimestamp,
          state: this.getStateSnapshot(),
        });
      }
    }

    if (this.renderer) {
      this.renderer.renderFrame?.({
        snapshot: this.lastSnapshot,
        state: this.getStateSnapshot(),
        timestamp: effectiveTimestamp,
      });
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

  tick(timestamp = this.now()) {
    return this.#frame(timestamp, { scheduleNext: false, force: true });
  }

  setUpdatesPerSecond(value) {
    const sanitized = sanitizeNumber(value, this.state.updatesPerSecond, {
      min: 1,
      round: true,
    });
    const changed = this.#updateState({ updatesPerSecond: sanitized });

    return changed ? sanitized : this.state.updatesPerSecond;
  }

  setEventFrequencyMultiplier(value) {
    const sanitized = sanitizeNumber(value, this.state.eventFrequencyMultiplier, { min: 0 });

    this.#updateState({ eventFrequencyMultiplier: sanitized });
  }

  setMutationMultiplier(value) {
    const sanitized = sanitizeNumber(value, this.state.mutationMultiplier, { min: 0 });

    this.#updateState({ mutationMultiplier: sanitized });
  }

  setDensityEffectMultiplier(value) {
    const sanitized = sanitizeNumber(value, this.state.densityEffectMultiplier, { min: 0 });

    this.#updateState({ densityEffectMultiplier: sanitized });
  }

  setSimilarityThresholds({ societySimilarity, enemySimilarity }) {
    const changes = {};

    if (societySimilarity !== undefined) {
      changes.societySimilarity = sanitizeNumber(societySimilarity, this.state.societySimilarity, {
        min: 0,
        max: 1,
      });
    }

    if (enemySimilarity !== undefined) {
      changes.enemySimilarity = sanitizeNumber(enemySimilarity, this.state.enemySimilarity, {
        min: 0,
        max: 1,
      });
    }

    this.#updateState(changes);
  }

  setEventStrengthMultiplier(value) {
    const sanitized = sanitizeNumber(value, this.state.eventStrengthMultiplier, { min: 0 });

    this.#updateState({ eventStrengthMultiplier: sanitized });
  }

  setEnergyRates({ regen, diffusion }) {
    const changes = {};

    if (regen !== undefined) {
      changes.energyRegenRate = sanitizeNumber(regen, this.state.energyRegenRate, { min: 0 });
    }

    if (diffusion !== undefined) {
      changes.energyDiffusionRate = sanitizeNumber(diffusion, this.state.energyDiffusionRate, {
        min: 0,
      });
    }

    this.#updateState(changes);
  }

  setLeaderboardInterval(value) {
    const sanitized = sanitizeNumber(value, this.state.leaderboardIntervalMs, { min: 0 });

    this.#updateState({ leaderboardIntervalMs: sanitized });
  }

  setOverlayVisibility({ showObstacles, showEnergy, showDensity, showFitness }) {
    const changes = {};

    if (showObstacles !== undefined) changes.showObstacles = Boolean(showObstacles);
    if (showEnergy !== undefined) changes.showEnergy = Boolean(showEnergy);
    if (showDensity !== undefined) changes.showDensity = Boolean(showDensity);
    if (showFitness !== undefined) changes.showFitness = Boolean(showFitness);

    this.#updateState(changes);
  }

  setLingerPenalty(value) {
    const sanitized = sanitizeNumber(value, this.lingerPenalty, { min: 0 });

    if (sanitized === this.lingerPenalty) return;

    this.lingerPenalty = sanitized;
    this.grid.setLingerPenalty?.(sanitized);
    this.emit('state', {
      state: this.getStateSnapshot(),
      changes: { lingerPenalty: sanitized },
    });
  }

  updateSetting(key, value) {
    switch (key) {
      case 'societySimilarity':
        this.setSimilarityThresholds({ societySimilarity: value });
        break;
      case 'enemySimilarity':
        this.setSimilarityThresholds({ enemySimilarity: value });
        break;
      case 'eventStrengthMultiplier':
        this.setEventStrengthMultiplier(value);
        break;
      case 'eventFrequencyMultiplier':
        this.setEventFrequencyMultiplier(value);
        break;
      case 'densityEffectMultiplier':
        this.setDensityEffectMultiplier(value);
        break;
      case 'energyRegenRate':
        this.setEnergyRates({ regen: value });
        break;
      case 'energyDiffusionRate':
        this.setEnergyRates({ diffusion: value });
        break;
      case 'mutationMultiplier':
        this.setMutationMultiplier(value);
        break;
      case 'matingDiversityThreshold':
        this.setMatingDiversityThreshold(value);
        break;
      case 'lowDiversityReproMultiplier':
        this.setLowDiversityReproMultiplier(value);
        break;
      case 'speedMultiplier': {
        const sanitized = sanitizeNumber(value, 1, { min: 0.5 });

        this.setUpdatesPerSecond(60 * sanitized);
        break;
      }
      case 'leaderboardIntervalMs':
        this.setLeaderboardInterval(value);
        break;
      case 'showObstacles':
      case 'showEnergy':
      case 'showDensity':
      case 'showFitness':
        this.setOverlayVisibility({ [key]: value });
        break;
      case 'lingerPenalty':
        this.setLingerPenalty(value);
        break;
      default:
        break;
    }
  }

  setMatingDiversityThreshold(value) {
    const clamped = sanitizeNumber(value, this.state.matingDiversityThreshold, {
      min: 0,
      max: 1,
    });

    if (this.state.matingDiversityThreshold === clamped) return;

    if (typeof this.stats?.setMatingDiversityThreshold === 'function') {
      this.stats.setMatingDiversityThreshold(clamped);
    } else if (this.stats) {
      this.stats.matingDiversityThreshold = clamped;
    }

    this.grid.setMatingDiversityOptions?.({
      threshold: clamped,
      lowDiversityMultiplier:
        this.state.lowDiversityReproMultiplier ??
        UI_SLIDER_CONFIG.lowDiversityReproMultiplier?.default ??
        0.1,
    });

    this.#updateState({ matingDiversityThreshold: clamped });
  }

  setLowDiversityReproMultiplier(value) {
    const clamped = sanitizeNumber(value, this.state.lowDiversityReproMultiplier, {
      min: 0,
      max: 1,
    });

    if (this.state.lowDiversityReproMultiplier === clamped) return;

    this.grid.setMatingDiversityOptions?.({
      threshold:
        this.state.matingDiversityThreshold ??
        this.stats?.matingDiversityThreshold ??
        UI_SLIDER_CONFIG.matingDiversityThreshold?.default ??
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

  runObstacleScenario(id) {
    this.grid.runObstacleScenario(id);
  }
}

export { defaultNow };
