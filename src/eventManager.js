import { EVENT_TYPES } from './eventEffects.js';
import { randomRange } from './utils.js';

export function isEventAffecting(event, row, col) {
  if (!event || !event.affectedArea) return false;
  const { x, y, width, height } = event.affectedArea;

  return row >= y && row < y + height && col >= x && col < x + width;
}

export default class EventManager {
  static EVENT_COLORS = {
    flood: 'rgba(0, 0, 255, 0.5)',
    drought: 'rgba(210, 180, 140, 0.5)',
    heatwave: 'rgba(255, 140, 0, 0.5)',
    coldwave: 'rgba(135, 206, 235, 0.5)',
  };

  constructor(rows, cols, rng = Math.random) {
    this.rows = rows;
    this.cols = cols;
    this.rng = rng;
    this.cooldown = 0;
    this.activeEvents = [];
    this.currentEvent = null;
    // start with one event for visibility
    const e = this.generateRandomEvent();

    this.activeEvents.push(e);
    this.currentEvent = e;
  }

  getEventColor() {
    return this.currentEvent
      ? EventManager.EVENT_COLORS[this.currentEvent.eventType]
      : 'rgba(0,0,0,0)';
  }

  getColor(ev) {
    return EventManager.EVENT_COLORS[ev.eventType];
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
