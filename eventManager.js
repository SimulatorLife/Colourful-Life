export default class EventManager {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.eventCounter = 0;
    this.currentEvent = this.generateRandomEvent();
  }

  generateRandomEvent() {
    const eventTypes = ['flood', 'drought', 'heatwave', 'coldwave'];
    const eventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    const duration = Math.floor(Math.random() * 501) + 100; // Event duration between 100 and 600 frames
    const strength = Math.random(); // Event strength between 0 and 1
    const affectedArea = {
      x: Math.floor(Math.random() * this.cols),
      y: Math.floor(Math.random() * this.rows),
      width: Math.floor(Math.random() * (this.cols / 4)) + 1,
      height: Math.floor(Math.random() * (this.rows / 4)) + 1,
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
