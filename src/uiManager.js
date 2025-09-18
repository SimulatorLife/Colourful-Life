import { ENERGY_REGEN_RATE_DEFAULT, ENERGY_DIFFUSION_RATE_DEFAULT } from './config.js';

export default class UIManager {
  constructor(updateCallback, mountSelector = '#app', actions = {}) {
    this.updateCallback = updateCallback;
    this.actions = actions || {};
    this.paused = false;

    // Settings with sensible defaults
    this.societySimilarity = 0.7; // >= considered ally
    this.enemySimilarity = 0.4; // <= considered enemy
    this.eventStrengthMultiplier = 1.0; // scales event effects
    this.eventFrequencyMultiplier = 1.0; // how often events spawn
    this.speedMultiplier = 1.0; // simulation speed relative to 60 updates/sec
    this.densityEffectMultiplier = 1.0; // scales density influence (0..2)
    this.energyRegenRate = ENERGY_REGEN_RATE_DEFAULT; // base logistic regen rate (0..0.2)
    this.energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT; // neighbor diffusion rate (0..0.5)
    this.leaderboardIntervalMs = 750; // how often the leaderboard refreshes
    this.showDensity = false;
    this.showEnergy = false;
    this.showFitness = false;
    // Build UI
    this.root = document.querySelector(mountSelector) || document.body;
    const canvasEl = this.root.querySelector('#gameCanvas');

    // Layout container with canvas on the left and sidebar on the right
    this.mainRow = document.createElement('div');
    this.mainRow.className = 'main-row';
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = 'canvas-container';
    this.sidebar = document.createElement('div');
    this.sidebar.className = 'sidebar';
    this.dashboardGrid = document.createElement('div');
    this.dashboardGrid.className = 'dashboard-grid';
    this.sidebar.appendChild(this.dashboardGrid);

    if (canvasEl) {
      this.root.insertBefore(this.mainRow, canvasEl);
      this.canvasContainer.appendChild(canvasEl);
      this.mainRow.appendChild(this.canvasContainer);
      this.mainRow.appendChild(this.sidebar);
    } else {
      this.root.appendChild(this.mainRow);
      this.mainRow.appendChild(this.canvasContainer);
      this.mainRow.appendChild(this.sidebar);
    }
    this.controlsPanel = this.#buildControlsPanel();
    this.insightsPanel = this.#buildInsightsPanel();
    this.dashboardGrid.appendChild(this.controlsPanel);
    this.dashboardGrid.appendChild(this.insightsPanel);

    // Keyboard toggle
    document.addEventListener('keydown', (e) => {
      if (e.key === 'p' || e.key === 'P') this.togglePause();
    });
  }

  // Reusable checkbox row helper
  #addCheckbox(body, label, title, initial, onChange) {
    const row = document.createElement('label');

    row.className = 'control-row';
    row.title = title;
    const line = document.createElement('div');

    line.className = 'control-line';
    const input = document.createElement('input');

    input.type = 'checkbox';
    input.checked = initial;
    input.addEventListener('input', () => onChange(input.checked));
    const name = document.createElement('div');

    name.className = 'control-name';
    name.textContent = label;
    line.appendChild(input);
    line.appendChild(name);
    row.appendChild(line);
    body.appendChild(row);

    return input;
  }

  #appendControlRow(container, { label, value, title, color }) {
    const row = document.createElement('div');

    row.className = 'control-line';
    if (title) row.title = title;

    const nameEl = document.createElement('div');

    nameEl.className = 'control-name';
    if (color) {
      const swatch = document.createElement('span');

      swatch.style.display = 'inline-block';
      swatch.style.width = '10px';
      swatch.style.height = '10px';
      swatch.style.marginRight = '6px';
      swatch.style.background = color;
      nameEl.appendChild(swatch);
    }
    const labelEl = document.createElement('span');

    labelEl.textContent = label;
    nameEl.appendChild(labelEl);

    const valueEl = document.createElement('div');

    valueEl.className = 'control-value';
    valueEl.textContent = value;

    row.appendChild(nameEl);
    row.appendChild(valueEl);
    container.appendChild(row);

    return row;
  }

  // Utility to create a collapsible panel with a header
  #createPanel(title) {
    const panel = document.createElement('div');

    panel.className = 'panel';
    const header = document.createElement('div');

    header.className = 'panel-header';
    const heading = document.createElement('h3');

    heading.textContent = title;
    const toggle = document.createElement('button');

    toggle.textContent = '–';
    toggle.className = 'panel-toggle';
    header.appendChild(heading);
    header.appendChild(toggle);
    panel.appendChild(header);
    const body = document.createElement('div');

    body.className = 'panel-body';
    panel.appendChild(body);

    const toggleCollapsed = () => {
      panel.classList.toggle('collapsed');
      toggle.textContent = panel.classList.contains('collapsed') ? '+' : '–';
    };

    header.addEventListener('click', (e) => {
      if (e.target === toggle || e.target === heading) toggleCollapsed();
    });
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCollapsed();
    });

    return { panel, header, heading, toggle, body };
  }

  #buildControlsPanel() {
    const { panel, body } = this.#createPanel('Simulation Controls');

    panel.id = 'controls';
    panel.classList.add('controls-panel');

    const addGrid = (className = '') => {
      const grid = document.createElement('div');

      grid.className = `control-grid${className ? ` ${className}` : ''}`;
      body.appendChild(grid);

      return grid;
    };

    const buttonRow = document.createElement('div');

    buttonRow.className = 'control-button-row';
    body.appendChild(buttonRow);

    // Pause/Resume
    const pauseBtn = document.createElement('button');

    pauseBtn.id = 'pauseButton';
    pauseBtn.textContent = 'Pause';
    pauseBtn.title = 'Pause/resume the simulation (shortcut: P)';
    pauseBtn.addEventListener('click', () => this.togglePause());
    buttonRow.appendChild(pauseBtn);
    this.pauseButton = pauseBtn;

    // Burst new cells
    const burstBtn = document.createElement('button');

    burstBtn.id = 'burstButton';
    burstBtn.textContent = 'Burst New Cells';
    burstBtn.title = 'Spawn a cluster of new cells at a random spot';
    burstBtn.addEventListener('click', () => {
      if (typeof this.actions.burst === 'function') this.actions.burst();
      else if (window.grid && typeof window.grid.burstRandomCells === 'function')
        window.grid.burstRandomCells();
    });
    buttonRow.appendChild(burstBtn);

    // Helper to make slider rows
    const addSlider = (opts, parent = body) => {
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
      parent.appendChild(row);

      return input;
    };

    const thresholdsGroup = addGrid();

    // Ally similarity
    addSlider(
      {
        label: 'Ally Similarity ≥',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.societySimilarity,
        title: 'Minimum genetic similarity to consider another cell an ally (0..1)',
        format: (v) => v.toFixed(2),
        onInput: (v) => (this.societySimilarity = v),
      },
      thresholdsGroup
    );

    // Enemy threshold
    addSlider(
      {
        label: 'Enemy Similarity ≤',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.enemySimilarity,
        title: 'Maximum genetic similarity to consider another cell an enemy (0..1)',
        format: (v) => v.toFixed(2),
        onInput: (v) => (this.enemySimilarity = v),
      },
      thresholdsGroup
    );

    const eventsGroup = addGrid();

    // Event strength multiplier
    addSlider(
      {
        label: 'Event Strength ×',
        min: 0,
        max: 3,
        step: 0.05,
        value: this.eventStrengthMultiplier,
        title: 'Scales the impact of environmental events (0..3)',
        format: (v) => v.toFixed(2),
        onInput: (v) => (this.eventStrengthMultiplier = v),
      },
      eventsGroup
    );

    // Event frequency multiplier
    addSlider(
      {
        label: 'Event Frequency ×',
        min: 0,
        max: 3,
        step: 0.1,
        value: this.eventFrequencyMultiplier,
        title: 'How often events spawn (0 disables new events)',
        format: (v) => v.toFixed(1),
        onInput: (v) => (this.eventFrequencyMultiplier = Math.max(0, v)),
      },
      eventsGroup
    );

    // Simulation speed multiplier (baseline 60 updates/sec)
    addSlider({
      label: 'Speed ×',
      min: 0.5,
      max: 100,
      step: 0.5,
      value: this.speedMultiplier,
      title: 'Speed multiplier relative to 60 updates/sec (0.5x..100x)',
      format: (v) => `${v.toFixed(1)}x`,
      onInput: (v) => (this.speedMultiplier = Math.max(0.1, v)),
    });

    // Overlay toggles
    const overlayHeader = document.createElement('h4');

    overlayHeader.textContent = 'Overlays';
    overlayHeader.style.margin = '12px 0 6px';
    body.appendChild(overlayHeader);

    const overlayGrid = addGrid('control-grid--compact');

    const addToggle = (label, title, initial, onChange) =>
      this.#addCheckbox(overlayGrid, label, title, initial, onChange);

    addToggle(
      'Show Density Heatmap',
      'Overlay local population density as a heatmap',
      this.showDensity,
      (v) => (this.showDensity = v)
    );
    addToggle(
      'Show Energy Heatmap',
      'Overlay tile energy levels as a heatmap',
      this.showEnergy,
      (v) => (this.showEnergy = v)
    );
    addToggle(
      'Show Fitness Heatmap',
      'Overlay cell fitness as a heatmap',
      this.showFitness,
      (v) => (this.showFitness = v)
    );

    const energyGroup = addGrid();

    // Density effect multiplier
    addSlider(
      {
        label: 'Density Effect ×',
        min: 0,
        max: 2,
        step: 0.05,
        value: this.densityEffectMultiplier,
        title:
          'Scales how strongly population density affects energy, aggression, and breeding (0..2)',
        format: (v) => v.toFixed(2),
        onInput: (v) => (this.densityEffectMultiplier = Math.max(0, v)),
      },
      energyGroup
    );

    // Energy regen base rate
    addSlider(
      {
        label: 'Energy Regen Rate',
        min: 0,
        max: 0.2,
        step: 0.005,
        value: this.energyRegenRate,
        title: 'Base logistic regeneration rate toward max energy (0..0.2)',
        format: (v) => v.toFixed(3),
        onInput: (v) => (this.energyRegenRate = Math.max(0, v)),
      },
      energyGroup
    );

    // Energy diffusion rate
    addSlider(
      {
        label: 'Energy Diffusion Rate',
        min: 0,
        max: 0.5,
        step: 0.01,
        value: this.energyDiffusionRate,
        title: 'How quickly energy smooths between tiles (0..0.5)',
        format: (v) => v.toFixed(2),
        onInput: (v) => (this.energyDiffusionRate = Math.max(0, v)),
      },
      energyGroup
    );

    addSlider({
      label: 'Leaderboard Interval',
      min: 100,
      max: 3000,
      step: 50,
      value: this.leaderboardIntervalMs,
      title: 'Delay between leaderboard refreshes in milliseconds (100..3000)',
      format: (v) => `${Math.round(v)} ms`,
      onInput: (v) => (this.leaderboardIntervalMs = Math.max(0, v)),
    });

    return panel;
  }

  #buildInsightsPanel() {
    const { panel, body } = this.#createPanel('Evolution Insights');

    this.metricsBox = document.createElement('div');
    this.metricsBox.className = 'metrics-box';
    body.appendChild(this.metricsBox);

    // Sparklines canvases
    const cap1 = document.createElement('div');

    cap1.className = 'control-name';
    cap1.textContent = 'Population';
    body.appendChild(cap1);
    this.sparkPop = document.createElement('canvas');
    this.sparkPop.className = 'sparkline';
    this.sparkPop.width = 260;
    this.sparkPop.height = 40;
    body.appendChild(this.sparkPop);

    const cap2 = document.createElement('div');

    cap2.className = 'control-name';
    cap2.textContent = 'Diversity';
    body.appendChild(cap2);
    this.sparkDiv2Canvas = document.createElement('canvas');
    this.sparkDiv2Canvas.className = 'sparkline';
    this.sparkDiv2Canvas.width = 260;
    this.sparkDiv2Canvas.height = 40;
    body.appendChild(this.sparkDiv2Canvas);

    const cap3 = document.createElement('div');

    cap3.className = 'control-name';
    cap3.textContent = 'Mean Energy';
    body.appendChild(cap3);
    this.sparkEnergy = document.createElement('canvas');
    this.sparkEnergy.className = 'sparkline';
    this.sparkEnergy.width = 260;
    this.sparkEnergy.height = 40;
    body.appendChild(this.sparkEnergy);

    const cap4 = document.createElement('div');

    cap4.className = 'control-name';
    cap4.textContent = 'Growth';
    body.appendChild(cap4);
    this.sparkGrowth = document.createElement('canvas');
    this.sparkGrowth.className = 'sparkline';
    this.sparkGrowth.width = 260;
    this.sparkGrowth.height = 40;
    body.appendChild(this.sparkGrowth);

    const cap5 = document.createElement('div');

    cap5.className = 'control-name';
    cap5.textContent = 'Event Strength';
    body.appendChild(cap5);
    this.sparkEvent = document.createElement('canvas');
    this.sparkEvent.className = 'sparkline';
    this.sparkEvent.width = 260;
    this.sparkEvent.height = 40;
    body.appendChild(this.sparkEvent);

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
  // Returns effective updates/sec derived from 60 * speedMultiplier
  getUpdatesPerSecond() {
    return Math.max(1, Math.round(60 * this.speedMultiplier));
  }
  getDensityEffectMultiplier() {
    return this.densityEffectMultiplier;
  }
  getEventFrequencyMultiplier() {
    return this.eventFrequencyMultiplier;
  }
  getEnergyRegenRate() {
    return this.energyRegenRate;
  }
  getEnergyDiffusionRate() {
    return this.energyDiffusionRate;
  }
  getLeaderboardIntervalMs() {
    return this.leaderboardIntervalMs;
  }
  getShowDensity() {
    return this.showDensity;
  }
  getShowEnergy() {
    return this.showEnergy;
  }
  getShowFitness() {
    return this.showFitness;
  }

  renderMetrics(stats, snapshot) {
    if (!this.metricsBox) return;
    this.metricsBox.innerHTML = '';
    const s = snapshot;

    this.#appendControlRow(this.metricsBox, {
      label: 'Population',
      value: String(s.population),
      title: 'Total living cells',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Births',
      value: String(s.births),
      title: 'Births in the last tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Deaths',
      value: String(s.deaths),
      title: 'Deaths in the last tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Growth',
      value: String(s.growth),
      title: 'Births - Deaths',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Mean Energy',
      value: s.meanEnergy.toFixed(2),
      title: 'Average energy per cell',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Mean Age',
      value: s.meanAge.toFixed(1),
      title: 'Average age of living cells',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Diversity',
      value: s.diversity.toFixed(3),
      title: 'Estimated mean pairwise genetic distance',
    });

    this.drawSpark(this.sparkPop, stats.history.population, '#88d');
    this.drawSpark(this.sparkDiv2Canvas, stats.history.diversity, '#d88');
    this.drawSpark(this.sparkEnergy, stats.history.energy, '#8d8');
    this.drawSpark(this.sparkGrowth, stats.history.growth, '#dd8');
    this.drawSpark(this.sparkEvent, stats.history.eventStrength, '#b85');
  }

  drawSpark(canvas, data, color = '#88d') {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (data.length < 2) return;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (w - 1);
      const y = h - ((v - min) / span) * (h - 1) - 1;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  renderLeaderboard(top) {
    if (!this.leaderPanel) {
      const { panel, body } = this.#createPanel('Leaderboard');

      panel.classList.add('leaderboard-panel');
      this.dashboardGrid?.appendChild(panel);
      this.leaderPanel = panel;
      this.leaderBody = body;
    }
    this.leaderBody.innerHTML = '';
    top.forEach((e, i) => {
      const label = `#${i + 1}`;
      const smoothed = Number.isFinite(e.smoothedFitness) ? e.smoothedFitness : e.fitness;
      const value =
        `avg ${smoothed.toFixed(2)}` +
        ` | inst ${e.fitness.toFixed(2)}` +
        ` | off ${e.offspring}` +
        ` | win ${e.fightsWon}` +
        ` | age ${e.age}`;

      this.#appendControlRow(this.leaderBody, {
        label,
        value,
        color: e.color,
      });
    });
  }
}
