export default class UIManager {
  constructor(updateCallback) {
    this.pauseButton = document.getElementById('pauseButton');
    this.paused = false;
    this.updateCallback = updateCallback;

    this.pauseButton.addEventListener('click', () => this.togglePause());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') {
        this.togglePause();
      }
    });
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
    if (!this.paused) {
      requestAnimationFrame(this.updateCallback);
    }
  }

  isPaused() {
    return this.paused;
  }
}
