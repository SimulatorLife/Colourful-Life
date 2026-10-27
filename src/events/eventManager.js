import { EVENT_TYPES } from "./eventEffects.js";
import { clamp, randomRange, sanitizePositiveInteger } from "../utils/math.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";
import { defaultIsEventAffecting } from "./eventContext.js";
import {
  DEFAULT_SPAWN_COOLDOWN_RANGE,
  planRandomEvent,
  planSpawnCooldown,
  resolveSpawnCooldownRange,
  sanitizeRandomEventConfig,
} from "./eventGenerationPolicy.js";

export {
  clampEventStart,
  DEFAULT_RANDOM_EVENT_CONFIG,
  DEFAULT_SPAWN_COOLDOWN_RANGE,
  resolveSpawnCooldownRange,
  sampleEventSpan,
  sanitizeRandomEventConfig,
} from "./eventGenerationPolicy.js";

export { defaultIsEventAffecting as isEventAffecting } from "./eventContext.js";

function normalizeEventTypes(candidate) {
  if (!Array.isArray(candidate)) {
    return null;
  }

  const filtered = candidate.filter((value) => typeof value === "string" && value);

  if (filtered.length === 0) {
    return null;
  }

  return Array.from(new Set(filtered));
}

const WARNINGS = Object.freeze({
  resolveEventColor:
    "Custom event color resolver threw; falling back to default palette.",
  pickEventType: "Custom event type picker threw; falling back to default selector.",
});

/**
 * Ensures the manager maintains an array for `activeEvents`, replacing invalid
 * values with an empty array. Returning the internal reference keeps the
 * orchestration layer agnostic to the underlying storage details.
 *
 * @param {EventManager} manager
 * @returns {Array}
 */
function ensureActiveEvents(manager) {
  if (Array.isArray(manager.activeEvents)) {
    return manager.activeEvents;
  }

  manager.activeEvents = [];

  return manager.activeEvents;
}

/**
 * Advances the lifecycle timer for all active events, compacting the list to
 * remove entries that have expired. The in-place rewrite avoids new
 * allocations, mirroring the original behaviour while hiding the bookkeeping
 * from the orchestrator.
 *
 * @param {Array} events
 */
function advanceEventLifecycle(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  let writeIndex = 0;

  for (let readIndex = 0; readIndex < events.length; readIndex += 1) {
    const ev = events[readIndex];

    if (!ev) continue;

    ev.remaining = Math.max(0, ev.remaining - 1);

    if (ev.remaining <= 0) continue;

    events[writeIndex] = ev;
    writeIndex += 1;
  }

  if (writeIndex < events.length) {
    events.length = writeIndex;
  }
}

/**
 * Spawns a new environmental event when the cooldown has elapsed and the pool
 * has capacity. On success the new event is appended to the provided array and
 * the next cooldown duration is returned. The cadence decision itself is
 * delegated to `planSpawnCooldown` so the mechanism stays focused on lifecycle
 * bookkeeping.
 *
 * @param {Object} params
 * @param {Array} params.events
 * @param {number} params.cooldown
 * @param {number} params.frequencyMultiplier
 * @param {number} params.maxConcurrent
 * @param {() => Object|null} params.generateEvent
 * @param {{min:number,max:number}} params.cooldownRange
 * @param {() => number} params.rng
 * @returns {number}
 */
function maybeSpawnEvent({
  events,
  cooldown,
  frequencyMultiplier,
  maxConcurrent,
  generateEvent,
  cooldownRange,
  rng,
}) {
  const canSpawn =
    Array.isArray(events) &&
    events.length < Math.max(0, maxConcurrent) &&
    frequencyMultiplier > 0;

  if (cooldown > 0 || !canSpawn) {
    return cooldown;
  }

  const nextEvent = typeof generateEvent === "function" ? generateEvent() : null;

  if (!nextEvent) {
    return cooldown;
  }

  events.push(nextEvent);

  return planSpawnCooldown({
    rng,
    frequencyMultiplier,
    cooldownRange,
  });
}

/**
 * Generates and tracks environmental events that influence energy regeneration
 * and drain across the grid. Events are spawned with randomized type, strength,
 * duration, and affected area and are exposed via `activeEvents` for overlays
 * and analytics.
 */
export default class EventManager {
  static EVENT_COLORS = {
    flood: "rgba(0, 0, 255, 0.5)",
    drought: "rgba(210, 180, 140, 0.5)",
    heatwave: "rgba(255, 140, 0, 0.5)",
    coldwave: "rgba(135, 206, 235, 0.5)",
  };

  static DEFAULT_EVENT_COLOR = "rgba(0,0,0,0)";
  static DEFAULT_EVENT_TYPES = EVENT_TYPES;

  /**
   * @param {number} rows
   * @param {number} cols
   * @param {() => number} [rng=Math.random]
   * @param {Object} [options]
   * @param {(eventType: string) => string} [options.resolveEventColor]
   * @param {Record<string, string>} [options.eventColors]
   * @param {boolean} [options.startWithEvent=false]
   * @param {string[]} [options.eventTypes] Custom pool used when picking random events.
   * @param {(context: {rng: () => number, eventTypes: string[], defaultPick: () => string}) => string} [options.pickEventType]
   * @param {{
   *   durationRange?: {min:number,max:number}|number[],
   *   strengthRange?: {min:number,max:number}|number[],
   *   span?: {min:number,ratio?:number,fraction?:number,maxFraction?:number},
   * }} [options.randomEventConfig] Tunable ranges used when generating random events.
   * @param {{min?:number,max?:number}|number[]} [options.spawnCooldownRange]
   *   - Optional override for the cooldown window applied between spawns.
   *   Falls back to {@link DEFAULT_SPAWN_COOLDOWN_RANGE}.
   */
  constructor(rows, cols, rng = Math.random, options = {}) {
    this.rows = rows;
    this.cols = cols;
    this.rng = rng;
    this.cooldown = 0;
    this.activeEvents = [];
    this.currentEvent = null;
    const {
      resolveEventColor,
      eventColors,
      startWithEvent = false,
      eventTypes: injectedEventTypes,
      pickEventType,
      randomEventConfig,
      spawnCooldownRange,
    } = options || {};

    this.randomEventConfig = sanitizeRandomEventConfig(randomEventConfig);
    this.spawnCooldownRange = resolveSpawnCooldownRange(spawnCooldownRange);
    // Allow callers to override the event color palette without changing defaults.
    const defaultResolver = (eventType) =>
      EventManager.EVENT_COLORS[eventType] ?? EventManager.DEFAULT_EVENT_COLOR;

    if (typeof resolveEventColor === "function") {
      this.eventColorResolver = (eventType) => {
        const resolved = invokeWithErrorBoundary(resolveEventColor, [eventType], {
          message: WARNINGS.resolveEventColor,
          reporter: warnOnce,
          once: true,
        });

        return typeof resolved === "string" && resolved.length > 0
          ? resolved
          : defaultResolver(eventType);
      };
    } else {
      const mergedColors = {
        ...EventManager.EVENT_COLORS,
        ...(eventColors && typeof eventColors === "object" ? eventColors : {}),
      };

      this.eventColorResolver = (eventType) =>
        typeof mergedColors[eventType] === "string" &&
        mergedColors[eventType].length > 0
          ? mergedColors[eventType]
          : EventManager.DEFAULT_EVENT_COLOR;
    }

    const normalizedTypes = normalizeEventTypes(injectedEventTypes);
    const pool = normalizedTypes?.length
      ? normalizedTypes
      : EventManager.DEFAULT_EVENT_TYPES;
    const fallbackPool = pool.length ? pool : EventManager.DEFAULT_EVENT_TYPES;
    const defaultPicker = () => {
      const index = Math.floor(randomRange(0, fallbackPool.length, this.rng));

      return fallbackPool[index];
    };

    if (typeof pickEventType === "function") {
      this.pickEventType = () => {
        const candidate = invokeWithErrorBoundary(
          pickEventType,
          [
            {
              rng: this.rng,
              eventTypes: [...fallbackPool],
              defaultPick: defaultPicker,
            },
          ],
          {
            message: WARNINGS.pickEventType,
            reporter: warnOnce,
            once: true,
          },
        );

        return typeof candidate === "string" && candidate ? candidate : defaultPicker();
      };
    } else {
      this.pickEventType = defaultPicker;
    }
    if (startWithEvent) {
      const initialEvent = this.generateRandomEvent();

      if (initialEvent) {
        this.activeEvents.push(initialEvent);
        this.currentEvent = initialEvent;
      }
    }
  }

  setDimensions(rows, cols) {
    const nextRows = sanitizePositiveInteger(rows, {
      fallback: this.rows,
    });
    const nextCols = sanitizePositiveInteger(cols, {
      fallback: this.cols,
    });

    if (nextRows === this.rows && nextCols === this.cols) {
      return { rows: this.rows, cols: this.cols };
    }

    this.rows = nextRows;
    this.cols = nextCols;

    const clampArea = (event) => {
      if (!event || !event.affectedArea) return;

      const area = event.affectedArea;
      const width = clamp(
        Math.max(1, Math.floor(Number(area.width) || this.cols)),
        1,
        this.cols,
      );
      const height = clamp(
        Math.max(1, Math.floor(Number(area.height) || this.rows)),
        1,
        this.rows,
      );
      const maxX = Math.max(0, this.cols - width);
      const maxY = Math.max(0, this.rows - height);
      const x = clamp(Math.floor(Number(area.x) || 0), 0, maxX);
      const y = clamp(Math.floor(Number(area.y) || 0), 0, maxY);

      area.x = x;
      area.y = y;
      area.width = width;
      area.height = height;
    };

    if (Array.isArray(this.activeEvents)) {
      this.activeEvents.forEach(clampArea);
    }

    if (this.currentEvent) {
      clampArea(this.currentEvent);
    }

    return { rows: this.rows, cols: this.cols };
  }

  getColor(ev) {
    if (!ev) return EventManager.DEFAULT_EVENT_COLOR;

    return this.eventColorResolver(ev.eventType);
  }

  generateRandomEvent() {
    const plan = planRandomEvent({
      pickEventType: this.pickEventType,
      randomEventConfig: this.randomEventConfig,
      rows: this.rows,
      cols: this.cols,
      rng: this.rng,
    });

    return { ...plan, remaining: plan.duration };
  }

  reset({ startWithEvent = false } = {}) {
    this.activeEvents = [];
    this.currentEvent = null;
    this.cooldown = 0;

    if (startWithEvent) {
      const event = this.generateRandomEvent();

      if (event) {
        this.activeEvents.push(event);
        this.currentEvent = event;
      }
    }
  }

  updateEvent(frequencyMultiplier = 1, maxConcurrent = 2) {
    const events = ensureActiveEvents(this);

    advanceEventLifecycle(events);

    this.cooldown = Math.max(0, this.cooldown - 1);

    this.cooldown = maybeSpawnEvent({
      events,
      cooldown: this.cooldown,
      frequencyMultiplier,
      maxConcurrent,
      generateEvent: () => this.generateRandomEvent(),
      cooldownRange: this.spawnCooldownRange,
      rng: this.rng,
    });

    // Maintain compatibility: expose the first active event as currentEvent
    this.currentEvent = events.length > 0 ? events[0] : null;
  }
}
