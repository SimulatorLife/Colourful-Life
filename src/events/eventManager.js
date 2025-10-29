import { EVENT_TYPES } from "./eventEffects.js";
import {
  clamp,
  randomRange,
  sanitizeNumber,
  sanitizePositiveInteger,
} from "../utils/math.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";
import { defaultIsEventAffecting } from "./eventContext.js";

export { defaultIsEventAffecting as isEventAffecting };

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

export const DEFAULT_RANDOM_EVENT_CONFIG = Object.freeze({
  durationRange: Object.freeze({ min: 300, max: 900 }),
  strengthRange: Object.freeze({ min: 0.25, max: 1 }),
  span: Object.freeze({ min: 10, ratio: 1 / 3 }),
});

function sanitizeNumericRange(range, fallback, { min: minBound, max: maxBound } = {}) {
  const candidate = range ?? {};
  const rawMin = Number.isFinite(candidate.min)
    ? candidate.min
    : Array.isArray(candidate) && Number.isFinite(candidate[0])
      ? candidate[0]
      : undefined;
  const rawMax = Number.isFinite(candidate.max)
    ? candidate.max
    : Array.isArray(candidate) && Number.isFinite(candidate[1])
      ? candidate[1]
      : undefined;

  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
    return { ...fallback };
  }

  let min = rawMin;
  let max = rawMax;

  if (min > max) {
    [min, max] = [max, min];
  }

  if (Number.isFinite(minBound)) {
    min = Math.max(min, minBound);
  }

  if (Number.isFinite(maxBound)) {
    max = Math.min(max, maxBound);
  }

  if (max < min) {
    return { ...fallback };
  }

  return { min, max };
}

function sanitizeSpanConfig(candidate, fallback) {
  if (!candidate || typeof candidate !== "object") {
    return { ...fallback };
  }

  const ratioCandidate = candidate.ratio ?? candidate.fraction ?? candidate.maxFraction;

  const min = sanitizeNumber(candidate.min, {
    fallback: fallback.min,
    min: 1,
    round: Math.floor,
  });

  const ratio = sanitizeNumber(ratioCandidate, {
    fallback: fallback.ratio,
    min: 0,
    max: 1,
  });

  return { min, ratio };
}

export function sanitizeRandomEventConfig(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return {
      durationRange: { ...DEFAULT_RANDOM_EVENT_CONFIG.durationRange },
      strengthRange: { ...DEFAULT_RANDOM_EVENT_CONFIG.strengthRange },
      span: { ...DEFAULT_RANDOM_EVENT_CONFIG.span },
    };
  }

  const durationRange = sanitizeNumericRange(
    candidate.durationRange,
    DEFAULT_RANDOM_EVENT_CONFIG.durationRange,
    {
      min: 1,
    },
  );
  const strengthRange = sanitizeNumericRange(
    candidate.strengthRange,
    DEFAULT_RANDOM_EVENT_CONFIG.strengthRange,
    { min: 0 },
  );
  const span = sanitizeSpanConfig(candidate.span, DEFAULT_RANDOM_EVENT_CONFIG.span);

  return { durationRange, strengthRange, span };
}

export function sampleEventSpan(
  limit,
  rng,
  spanConfig = DEFAULT_RANDOM_EVENT_CONFIG.span,
) {
  const maxSpan = Math.max(1, Math.floor(limit));
  const minCandidate = Number.isFinite(spanConfig?.min)
    ? Math.max(1, Math.floor(spanConfig.min))
    : DEFAULT_RANDOM_EVENT_CONFIG.span.min;
  const ratio = Number.isFinite(spanConfig?.ratio)
    ? clamp(spanConfig.ratio, 0, 1)
    : DEFAULT_RANDOM_EVENT_CONFIG.span.ratio;
  const minSpan = Math.min(minCandidate, maxSpan);
  const spanCandidate = Math.max(minSpan, Math.floor(maxSpan * ratio));
  const upperExclusive = spanCandidate === minSpan ? minSpan + 1 : spanCandidate + 1;
  const raw = Math.floor(randomRange(minSpan, upperExclusive, rng));

  return clamp(raw, 1, maxSpan);
}

export function clampEventStart(rawStart, span, limit) {
  const maxStart = Math.max(0, Math.floor(limit) - span);

  if (maxStart <= 0) {
    return 0;
  }

  return clamp(rawStart, 0, maxStart);
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
    } = options || {};

    this.randomEventConfig = sanitizeRandomEventConfig(randomEventConfig);
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
    const eventType = this.pickEventType();
    // Bias durations so events are visible but not constant
    const { durationRange, strengthRange, span } = this.randomEventConfig;
    const duration = Math.floor(
      randomRange(durationRange.min, durationRange.max, this.rng),
    );
    const strength = randomRange(strengthRange.min, strengthRange.max, this.rng);
    const rawX = Math.floor(randomRange(0, this.cols, this.rng));
    const rawY = Math.floor(randomRange(0, this.rows, this.rng));
    const width = sampleEventSpan(this.cols, this.rng, span);
    const height = sampleEventSpan(this.rows, this.rng, span);
    const x = clampEventStart(rawX, width, this.cols);
    const y = clampEventStart(rawY, height, this.rows);
    const affectedArea = {
      x,
      y,
      width,
      height,
    };

    return { eventType, duration, affectedArea, strength, remaining: duration };
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
    const events = this.activeEvents;

    if (!Array.isArray(events)) {
      this.activeEvents = [];

      return;
    }

    if (events.length === 0) {
      return;
    }

    // Update existing events in place while compacting finished entries without reallocating.
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

    // Spawn new events when cooldown expires
    if (this.cooldown > 0) this.cooldown--;
    const canSpawn =
      this.activeEvents.length < Math.max(0, maxConcurrent) && frequencyMultiplier > 0;

    if (this.cooldown <= 0 && canSpawn) {
      const ev = this.generateRandomEvent();

      this.activeEvents.push(ev);
      // Next cooldown scales inversely with frequency multiplier
      const base = Math.floor(randomRange(180, 480, this.rng));

      this.cooldown = Math.max(
        0,
        Math.floor(base / Math.max(0.01, frequencyMultiplier)),
      );
    }

    // Maintain compatibility: expose the first active event as currentEvent
    this.currentEvent = this.activeEvents.length > 0 ? this.activeEvents[0] : null;
  }
}
