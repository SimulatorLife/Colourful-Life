export default class UIManager {
  constructor(updateCallback, mountSelector = '#app') {
    this.updateCallback = updateCallback;
    this.paused = false;

    // Settings with sensible defaults
    this.societySimilarity = 0.85; // >= considered ally
    this.enemySimilarity = 0.5; // <= considered enemy
    this.eventStrengthMultiplier = 1.0; // scales event effects
    this.updatesPerSecond = 50; // simulation speed
    this.densityEffectMultiplier = 1.0; // scales density influence (0..2)

    // Build UI
    this.root = document.querySelector(mountSelector) || document.body;
    this.panel = this.#buildPanel();
    this.root.appendChild(this.panel);

    // Keyboard toggle
    document.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') this.togglePause();
    });
  }

  #buildPanel() {
    const panel = document.createElement('div');

    panel.id = 'controls';
    panel.className = 'controls-panel';

    // Title
    const heading = document.createElement('h3');

    heading.textContent = 'Simulation Controls';
    panel.appendChild(heading);

    // Pause/Resume
    const pauseBtn = document.createElement('button');

    pauseBtn.id = 'pauseButton';
    pauseBtn.textContent = 'Pause';
    pauseBtn.title = 'Pause/resume the simulation (shortcut: P)';
    pauseBtn.addEventListener('click', () => this.togglePause());
    panel.appendChild(pauseBtn);
    this.pauseButton = pauseBtn;

    // Helper to make slider rows
    const addSlider = (opts) => {
      const { label, min, max, step, value, title, onInput, format = (v) => String(v) } = opts;
      const row = document.createElement('label');

      row.className = 'control-row';
      row.title = title;
      const name = document.createElement('div');

      name.className = 'control-name';
      name.textContent = label;
      const valSpan = document.createElement('span');

      valSpan.className = 'control-value';
      valSpan.textContent = format(value);
      const input = document.createElement('input');

      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);

        valSpan.textContent = format(v);
        onInput(v);
      });
      const line = document.createElement('div');

      line.className = 'control-line';
      line.appendChild(input);
      line.appendChild(valSpan);
      row.appendChild(name);
      row.appendChild(line);
      panel.appendChild(row);

      return input;
    };

    // Ally similarity
    addSlider({
      label: 'Ally Similarity ≥',
      min: 0,
      max: 1,
      step: 0.01,
      value: this.societySimilarity,
      title: 'Minimum genetic similarity to consider another cell an ally (0..1)',
      format: (v) => v.toFixed(2),
      onInput: (v) => (this.societySimilarity = v),
    });

    // Enemy threshold
    addSlider({
      label: 'Enemy Similarity ≤',
      min: 0,
      max: 1,
      step: 0.01,
      value: this.enemySimilarity,
      title: 'Maximum genetic similarity to consider another cell an enemy (0..1)',
      format: (v) => v.toFixed(2),
      onInput: (v) => (this.enemySimilarity = v),
    });

    // Event strength multiplier
    addSlider({
      label: 'Event Strength ×',
      min: 0,
      max: 3,
      step: 0.05,
      value: this.eventStrengthMultiplier,
      title: 'Scales the impact of environmental events (0..3)',
      format: (v) => v.toFixed(2),
      onInput: (v) => (this.eventStrengthMultiplier = v),
    });

    // Simulation speed
    addSlider({
      label: 'Speed (updates/sec)',
      min: 1,
      max: 60,
      step: 1,
      value: this.updatesPerSecond,
      title: 'How many updates per second to run (1..60)',
      onInput: (v) => (this.updatesPerSecond = Math.max(1, Math.round(v))),
    });

    // Density effect multiplier
    addSlider({
      label: 'Density Effect ×',
      min: 0,
      max: 2,
      step: 0.05,
      value: this.densityEffectMultiplier,
      title:
        'Scales how strongly population density affects energy, aggression, and breeding (0..2)',
      format: (v) => v.toFixed(2),
      onInput: (v) => (this.densityEffectMultiplier = Math.max(0, v)),
    });

    return panel;
  }

  togglePause() {
    this.paused = !this.paused;
    this.pauseButton.textContent = this.paused ? 'Resume' : 'Pause';
    if (!this.paused) requestAnimationFrame(this.updateCallback);
  }

  isPaused() {
    return this.paused;
  }

  // Getters for simulation
  getSocietySimilarity() {
    return this.societySimilarity;
  }
  getEnemySimilarity() {
    return this.enemySimilarity;
  }
  getEventStrengthMultiplier() {
    return this.eventStrengthMultiplier;
  }
  getUpdatesPerSecond() {
    return this.updatesPerSecond;
  }
  getDensityEffectMultiplier() {
    return this.densityEffectMultiplier;
  }
}
