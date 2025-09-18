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

    const buttonRow = body.appendChild(document.createElement('div'));

    buttonRow.className = 'control-button-row';

    const addControlButton = ({ id, label, title, onClick }) => {
      const button = document.createElement('button');

      button.id = id;
      button.textContent = label;
      button.title = title;
      button.addEventListener('click', onClick);
      buttonRow.appendChild(button);

      return button;
    };

    this.pauseButton = addControlButton({
      id: 'pauseButton',
      label: 'Pause',
      title: 'Pause/resume the simulation (shortcut: P)',
      onClick: () => this.togglePause(),
    });

    addControlButton({
      id: 'burstButton',
      label: 'Burst New Cells',
      title: 'Spawn a cluster of new cells at a random spot',
      onClick: () => {
        if (typeof this.actions.burst === 'function') this.actions.burst();
        else if (window.grid && typeof window.grid.burstRandomCells === 'function')
          window.grid.burstRandomCells();
      },
    });

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

    const getSliderValue = (cfg) =>
      typeof cfg.getValue === 'function' ? cfg.getValue() : this[cfg.prop];

    const getSliderSetter = (cfg) => {
      if (typeof cfg.setValue === 'function') return cfg.setValue;
      if (cfg.prop)
        return (value) => {
          this[cfg.prop] = value;
        };

      return () => {};
    };

    const renderSlider = (cfg, parent = body) =>
      addSlider(
        {
          label: cfg.label,
          min: cfg.min,
          max: cfg.max,
          step: cfg.step,
          value: getSliderValue(cfg),
          title: cfg.title,
          format: cfg.format,
          onInput: getSliderSetter(cfg),
        },
        parent
      );

    const thresholdConfigs = [
      {
        label: 'Ally Similarity ≥',
        min: 0,
        max: 1,
        step: 0.01,
        title: 'Minimum genetic similarity to consider another cell an ally (0..1)',
        format: (v) => v.toFixed(2),
        getValue: () => this.societySimilarity,
        setValue: (v) => {
          this.societySimilarity = v;
        },
      },
      {
        label: 'Enemy Similarity ≤',
        min: 0,
        max: 1,
        step: 0.01,
        title: 'Maximum genetic similarity to consider another cell an enemy (0..1)',
        format: (v) => v.toFixed(2),
        getValue: () => this.enemySimilarity,
        setValue: (v) => {
          this.enemySimilarity = v;
        },
      },
    ];

    const eventConfigs = [
      {
        label: 'Event Strength ×',
        min: 0,
        max: 3,
        step: 0.05,
        title: 'Scales the impact of environmental events (0..3)',
        format: (v) => v.toFixed(2),
        getValue: () => this.eventStrengthMultiplier,
        setValue: (v) => {
          this.eventStrengthMultiplier = v;
        },
      },
      {
        label: 'Event Frequency ×',
        min: 0,
        max: 3,
        step: 0.1,
        title: 'How often events spawn (0 disables new events)',
        format: (v) => v.toFixed(1),
        getValue: () => this.eventFrequencyMultiplier,
        setValue: (v) => {
          this.eventFrequencyMultiplier = Math.max(0, v);
        },
      },
    ];

    const energyConfigs = [
      {
        label: 'Density Effect ×',
        min: 0,
        max: 2,
        step: 0.05,
        title:
          'Scales how strongly population density affects energy, aggression, and breeding (0..2)',
        format: (v) => v.toFixed(2),
        getValue: () => this.densityEffectMultiplier,
        setValue: (v) => {
          this.densityEffectMultiplier = Math.max(0, v);
        },
      },
      {
        label: 'Energy Regen Rate',
        min: 0,
        max: 0.2,
        step: 0.005,
        title: 'Base logistic regeneration rate toward max energy (0..0.2)',
        format: (v) => v.toFixed(3),
        getValue: () => this.energyRegenRate,
        setValue: (v) => {
          this.energyRegenRate = Math.max(0, v);
        },
      },
      {
        label: 'Energy Diffusion Rate',
        min: 0,
        max: 0.5,
        step: 0.01,
        title: 'How quickly energy smooths between tiles (0..0.5)',
        format: (v) => v.toFixed(2),
        getValue: () => this.energyDiffusionRate,
        setValue: (v) => {
          this.energyDiffusionRate = Math.max(0, v);
        },
      },
    ];

    const generalConfigs = [
      {
        label: 'Speed ×',
        min: 0.5,
        max: 100,
        step: 0.5,
        title: 'Speed multiplier relative to 60 updates/sec (0.5x..100x)',
        format: (v) => `${v.toFixed(1)}x`,
        getValue: () => this.speedMultiplier,
        setValue: (v) => {
          this.speedMultiplier = Math.max(0.1, v);
        },
        position: 'beforeOverlays',
      },
      {
        label: 'Leaderboard Interval',
        min: 100,
        max: 3000,
        step: 50,
        title: 'Delay between leaderboard refreshes in milliseconds (100..3000)',
        format: (v) => `${Math.round(v)} ms`,
        getValue: () => this.leaderboardIntervalMs,
        setValue: (v) => {
          this.leaderboardIntervalMs = Math.max(0, v);
        },
        position: 'afterEnergy',
      },
    ];

    const thresholdsGroup = addGrid();

    thresholdConfigs.forEach((cfg) => renderSlider(cfg, thresholdsGroup));

    const eventsGroup = addGrid();

    eventConfigs.forEach((cfg) => renderSlider(cfg, eventsGroup));

    generalConfigs
      .filter((cfg) => cfg.position === 'beforeOverlays')
      .forEach((cfg) => renderSlider(cfg));

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

    energyConfigs.forEach((cfg) => renderSlider(cfg, energyGroup));

    generalConfigs
      .filter((cfg) => cfg.position === 'afterEnergy')
      .forEach((cfg) => renderSlider(cfg));

    return panel;
  }

  #buildInsightsPanel() {
    const { panel, body } = this.#createPanel('Evolution Insights');

    this.metricsBox = document.createElement('div');
    this.metricsBox.className = 'metrics-box';
    body.appendChild(this.metricsBox);

    // Sparklines canvases
    const sparkDescriptors = [
      { label: 'Population', property: 'sparkPop' },
      { label: 'Diversity', property: 'sparkDiv2Canvas' },
      { label: 'Mean Energy', property: 'sparkEnergy' },
      { label: 'Growth', property: 'sparkGrowth' },
      { label: 'Event Strength', property: 'sparkEvent' },
    ];

    sparkDescriptors.forEach(({ label, property }) => {
      const caption = document.createElement('div');

      caption.className = 'control-name';
      caption.textContent = label;
      body.appendChild(caption);

      const canvas = document.createElement('canvas');

      canvas.className = 'sparkline';
      canvas.width = 260;
      canvas.height = 40;
      body.appendChild(canvas);

      this[property] = canvas;
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
