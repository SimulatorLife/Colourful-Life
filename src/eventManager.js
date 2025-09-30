import { EVENT_TYPES } from './eventEffects.js';
import { randomRange } from './utils.js';

/**
 * Determines whether the supplied event overlaps the provided grid
 * coordinates. Events operate on rectangular regions described by their
 * `affectedArea` bounds.
 *
 * @param {Object} event - Event definition.
 * @param {number} row - Tile row to test.
 * @param {number} col - Tile column to test.
 * @returns {boolean} Whether the tile is affected by the event.
 */
export function isEventAffecting(event, row, col) {
  if (!event || !event.affectedArea) return false;
  const { x, y, width, height } = event.affectedArea;

  return row >= y && row < y + height && col >= x && col < x + width;
}

/**
 * Generates and tracks environmental events that influence energy regeneration
 * and drain across the grid. Events are spawned with randomized type, strength,
 * duration, and affected area and are exposed via `activeEvents` for overlays
 * and analytics.
 */
export default class EventManager {
  static EVENT_COLORS = {
    flood: 'rgba(0, 0, 255, 0.5)',
    drought: 'rgba(210, 180, 140, 0.5)',
    heatwave: 'rgba(255, 140, 0, 0.5)',
    coldwave: 'rgba(135, 206, 235, 0.5)',
  };

  static DEFAULT_EVENT_COLOR = 'rgba(0,0,0,0)';

  constructor(rows, cols, rng = Math.random, options = {}) {
    this.rows = rows;
    this.cols = cols;
    this.rng = rng;
    this.cooldown = 0;
    this.activeEvents = [];
    this.currentEvent = null;
    const { resolveEventColor, eventColors } = options || {};
    // Allow callers to override the event color palette without changing defaults.
    const defaultResolver = (eventType) =>
      EventManager.EVENT_COLORS[eventType] ?? EventManager.DEFAULT_EVENT_COLOR;

    if (typeof resolveEventColor === 'function') {
      this.eventColorResolver = (eventType) => {
        const resolved = resolveEventColor(eventType);

        return typeof resolved === 'string' && resolved.length > 0
          ? resolved
          : defaultResolver(eventType);
      };
    } else {
      const mergedColors = {
        ...EventManager.EVENT_COLORS,
        ...(eventColors && typeof eventColors === 'object' ? eventColors : {}),
      };

      this.eventColorResolver = (eventType) =>
        typeof mergedColors[eventType] === 'string' && mergedColors[eventType].length > 0
          ? mergedColors[eventType]
          : EventManager.DEFAULT_EVENT_COLOR;
    }
    // start with one event for visibility
    const e = this.generateRandomEvent();

    this.activeEvents.push(e);
    this.currentEvent = e;
  }

  getEventColor() {
    return this.currentEvent
      ? this.eventColorResolver(this.currentEvent.eventType)
      : EventManager.DEFAULT_EVENT_COLOR;
  }

  getColor(ev) {
    if (!ev) return EventManager.DEFAULT_EVENT_COLOR;

    return this.eventColorResolver(ev.eventType);
  }

  generateRandomEvent() {
    const eventType = EVENT_TYPES[Math.floor(randomRange(0, EVENT_TYPES.length, this.rng))];
    // Bias durations so events are visible but not constant
    const duration = Math.floor(randomRange(300, 900, this.rng)); // frames
    const strength = randomRange(0.25, 1, this.rng); // 0.25..1
    const affectedArea = {
      x: Math.floor(randomRange(0, this.cols, this.rng)),
      y: Math.floor(randomRange(0, this.rows, this.rng)),
      width: Math.max(10, Math.floor(randomRange(6, this.cols / 3, this.rng))),
      height: Math.max(10, Math.floor(randomRange(6, this.rows / 3, this.rng))),
    };

    return { eventType, duration, affectedArea, strength, remaining: duration };
  }

  updateEvent(frequencyMultiplier = 1, maxConcurrent = 2) {
    // Update existing events and remove finished
    this.activeEvents.forEach((ev) => (ev.remaining = Math.max(0, ev.remaining - 1)));
    this.activeEvents = this.activeEvents.filter((ev) => ev.remaining > 0);

    // Spawn new events when cooldown expires
    if (this.cooldown > 0) this.cooldown--;
    const canSpawn =
      this.activeEvents.length < Math.max(0, maxConcurrent) && frequencyMultiplier > 0;

    if (this.cooldown <= 0 && canSpawn) {
      const ev = this.generateRandomEvent();

      this.activeEvents.push(ev);
      // Next cooldown scales inversely with frequency multiplier
      const base = Math.floor(randomRange(180, 480, this.rng));

      this.cooldown = Math.max(0, Math.floor(base / Math.max(0.01, frequencyMultiplier)));
    }

    // Maintain compatibility: expose the first active event as currentEvent
    this.currentEvent = this.activeEvents.length > 0 ? this.activeEvents[0] : null;
  }

  applyEventEffects(cell, row, col) {
    const event = this.currentEvent;

    if (isEventAffecting(event, row, col)) {
      // Event effects on individual cells are handled in Cell.applyEventEffects
      // This hook is reserved for global side-effects if needed.
    }
  }
}
