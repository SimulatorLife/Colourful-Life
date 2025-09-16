import { randomRange } from './utils.js';

export default class EventManager {
  static EVENT_COLORS = {
    flood: 'rgba(0, 0, 255, 0.5)',
    drought: 'rgba(210, 180, 140, 0.5)',
    heatwave: 'rgba(255, 140, 0, 0.5)',
    coldwave: 'rgba(135, 206, 235, 0.5)',
  };

  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.eventCounter = 0;
    this.cooldown = 0;
    this.currentEvent = this.generateRandomEvent();
  }

  getEventColor() {
    return EventManager.EVENT_COLORS[this.currentEvent.eventType];
  }

  generateRandomEvent() {
    const eventTypes = ['flood', 'drought', 'heatwave', 'coldwave'];
    const eventType = eventTypes[Math.floor(randomRange(0, eventTypes.length))];
    // Bias durations so events are visible but not constant
    const duration = Math.floor(randomRange(300, 900)); // frames
    const strength = randomRange(0.25, 1); // 0.25..1
    const affectedArea = {
      x: Math.floor(randomRange(0, this.cols)),
      y: Math.floor(randomRange(0, this.rows)),
      width: Math.max(10, Math.floor(randomRange(6, this.cols / 3))),
      height: Math.max(10, Math.floor(randomRange(6, this.rows / 3))),
    };

    return { eventType, duration, affectedArea, strength };
  }

  updateEvent() {
    if (this.cooldown > 0) {
      this.cooldown--;

      return;
    }
    if (!this.currentEvent) {
      this.currentEvent = this.generateRandomEvent();
      this.eventCounter = 0;
    } else {
      this.eventCounter++;
      if (this.eventCounter >= this.currentEvent.duration) {
        // End event and schedule a cooldown before the next one
        this.currentEvent = null;
        this.eventCounter = 0;
        this.cooldown = Math.floor(randomRange(180, 480));
      }
    }
  }

  applyEventEffects(cell, row, col) {
    const event = this.currentEvent;

    if (
      event &&
      row >= event.affectedArea.y &&
      row < event.affectedArea.y + event.affectedArea.height &&
      col >= event.affectedArea.x &&
      col < event.affectedArea.x + event.affectedArea.width
    ) {
      // Event effects on individual cells are handled in Cell.applyEventEffects
      // This hook is reserved for global side-effects if needed.
    }
  }
}
