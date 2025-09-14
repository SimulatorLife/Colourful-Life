import { randomRange } from './utils.js';

export default class EventManager {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.eventCounter = 0;
    this.currentEvent = this.generateRandomEvent();
  }

  generateRandomEvent() {
    const eventTypes = ['flood', 'drought', 'heatwave', 'coldwave'];
    const eventType = eventTypes[Math.floor(randomRange(0, eventTypes.length))];
    const duration = Math.floor(randomRange(0, 501)) + 100; // 100..600 frames
    const strength = randomRange(0, 1); // 0..1
    const affectedArea = {
      x: Math.floor(randomRange(0, this.cols)),
      y: Math.floor(randomRange(0, this.rows)),
      width: Math.max(10, Math.floor(randomRange(0, this.cols / 4)) + 1),
      height: Math.max(10, Math.floor(randomRange(0, this.rows / 4)) + 1),
    };

    return { eventType, duration, affectedArea, strength };
  }

  updateEvent() {
    if (!this.currentEvent || this.eventCounter % this.currentEvent.duration === 0) {
      this.currentEvent = this.generateRandomEvent();
      this.eventCounter = 0;
    }
    this.eventCounter++;
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
      switch (event.eventType) {
        case 'flood':
          // Apply flood effects, e.g., remove certain organisms or reduce their energy
          break;
        case 'drought':
          // Apply drought effects, e.g., reduce available energy
          break;
        case 'heatwave':
          // Apply heatwave effects, e.g., remove certain organisms or drain their energy
          break;
        case 'coldwave':
          // Apply coldwave effects, e.g., reduce energy or movement speed
          break;
      }
    }
  }
}
