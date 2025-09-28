import {
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  UI_SLIDER_CONFIG,
} from './config.js';

export default class UIManager {
  constructor(updateCallback, mountSelector = '#app', actions = {}, layoutOptions = {}) {
    const actionFns = actions || {};

    this.updateCallback = updateCallback;
    this.actions = actionFns;
    this.paused = false;
    this.selectionManager = actionFns.selectionManager || null;
    this.getCellSize =
      typeof actionFns.getCellSize === 'function' ? actionFns.getCellSize.bind(actionFns) : () => 1;
    this.selectionDrawingEnabled = false;
    this.selectionDragStart = null;
    this.canvasElement = null;
    this.selectionDrawingActive = false;
    this.selectionDragEnd = null;
    this.drawZoneButton = null;
    this.zoneSummaryEl = null;
    this.patternCheckboxes = {};
    this._selectionListenersInstalled = false;

    // Settings with sensible defaults
    this.societySimilarity = UI_SLIDER_CONFIG.societySimilarity.default;
    this.enemySimilarity = UI_SLIDER_CONFIG.enemySimilarity.default;
    this.eventStrengthMultiplier = UI_SLIDER_CONFIG.eventStrengthMultiplier.default;
    this.eventFrequencyMultiplier = UI_SLIDER_CONFIG.eventFrequencyMultiplier.default;
    this.speedMultiplier = UI_SLIDER_CONFIG.speedMultiplier.default;
    this.densityEffectMultiplier = UI_SLIDER_CONFIG.densityEffectMultiplier.default;
    this.mutationMultiplier = UI_SLIDER_CONFIG.mutationMultiplier.default;
    this.energyRegenRate = ENERGY_REGEN_RATE_DEFAULT; // base logistic regen rate (0..0.2)
    this.energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT; // neighbor diffusion rate (0..0.5)
    this.leaderboardIntervalMs = UI_SLIDER_CONFIG.leaderboardIntervalMs.default;
    this._lastSlowUiRender = Number.NEGATIVE_INFINITY; // shared throttle for fast-updating UI bits
    this._lastInteractionTotals = { fights: 0, cooperations: 0 };
    this.showDensity = false;
    this.showEnergy = false;
    this.showFitness = false;
    // Build UI
    this.root = document.querySelector(mountSelector) || document.body;

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
    this.mainRow.appendChild(this.canvasContainer);
    this.mainRow.appendChild(this.sidebar);

    const canvasEl = layoutOptions.canvasElement || this.#resolveNode(layoutOptions.canvasSelector);
    const anchorNode =
      this.#resolveNode(layoutOptions.before) || this.#resolveNode(layoutOptions.insertBefore);

    if (canvasEl) {
      this.attachCanvas(canvasEl, { before: anchorNode });
    } else {
      this.#ensureMainRowMounted(anchorNode);
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

  attachCanvas(canvasElement, options = {}) {
    const targetCanvas = this.#resolveNode(canvasElement);

    if (!(targetCanvas instanceof HTMLElement)) return;
    this.canvasElement = targetCanvas;
    const anchor =
      this.#resolveNode(options.before) || this.#resolveNode(options.insertBefore) || targetCanvas;

    this.#ensureMainRowMounted(anchor);
    this.canvasContainer.appendChild(targetCanvas);
    this.#installRegionDrawing();
  }

  #ensureMainRowMounted(anchor) {
    if (this.mainRow.parentElement) return;

    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(this.mainRow, anchor);
    } else {
      this.root.appendChild(this.mainRow);
    }
  }

  #resolveNode(candidate) {
    if (!candidate) return null;
    if (candidate instanceof Node) return candidate;
    if (typeof candidate === 'string') {
      return this.root.querySelector(candidate) || document.querySelector(candidate);
    }

    return null;
  }

  #scheduleUpdate() {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(this.updateCallback);
    } else if (typeof this.updateCallback === 'function') {
      this.updateCallback();
    }
  }

  #setDrawingEnabled(enabled) {
    this.selectionDrawingEnabled = Boolean(enabled);

    if (this.drawZoneButton) {
      this.drawZoneButton.classList.toggle('active', this.selectionDrawingEnabled);
      this.drawZoneButton.textContent = this.selectionDrawingEnabled
        ? 'Cancel Drawing'
        : 'Draw Custom Zone';
    }

    if (!this.selectionDrawingEnabled) {
      this.selectionDragStart = null;
      this.selectionDragEnd = null;
      this.selectionDrawingActive = false;
    }
  }

  #toggleRegionDrawing(nextState) {
    const state = typeof nextState === 'boolean' ? nextState : !this.selectionDrawingEnabled;

    this.#setDrawingEnabled(state);
  }

  #updateZoneSummary() {
    if (!this.zoneSummaryEl) return;
    const summary = this.selectionManager
      ? this.selectionManager.describeActiveZones()
      : 'All tiles eligible';

    this.zoneSummaryEl.textContent = `Active zones: ${summary}`;
  }

  #canvasToGrid(event) {
    if (!this.canvasElement) return null;

    const rect = this.canvasElement.getBoundingClientRect();
    const cellSize = Math.max(1, this.getCellSize());
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    const maxCols = Math.floor(this.canvasElement.width / cellSize);
    const maxRows = Math.floor(this.canvasElement.height / cellSize);

    if (col < 0 || row < 0 || col >= maxCols || row >= maxRows) return null;

    return { row, col };
  }

  #installRegionDrawing() {
    if (!this.canvasElement || !this.selectionManager || this._selectionListenersInstalled) return;

    this.selectionDrawingActive = false;
    this.selectionDragEnd = null;

    const canvas = this.canvasElement;
    const handlePointerDown = (event) => {
      if (!this.selectionDrawingEnabled) return;
      const start = this.#canvasToGrid(event);

      if (!start) return;

      event.preventDefault();
      this.selectionDrawingActive = true;
      this.selectionDragStart = start;
      this.selectionDragEnd = start;
      if (typeof canvas.setPointerCapture === 'function') canvas.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event) => {
      if (!this.selectionDrawingActive || !this.selectionDrawingEnabled) return;
      const point = this.#canvasToGrid(event);

      if (point) this.selectionDragEnd = point;
    };

    const finalizeDrawing = (event) => {
      if (!this.selectionDrawingActive) return;

      event.preventDefault();
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          // ignore release errors
        }
      }

      const end = this.#canvasToGrid(event) || this.selectionDragEnd;
      const start = this.selectionDragStart;

      if (start && end) {
        const zone = this.selectionManager.addCustomRectangle(
          start.row,
          start.col,
          end.row,
          end.col
        );

        if (zone) {
          this.#updateZoneSummary();
          this.#scheduleUpdate();
        }
      }

      this.selectionDrawingActive = false;
      this.selectionDragStart = null;
      this.selectionDragEnd = null;
      this.#setDrawingEnabled(false);
    };

    const cancelDrawing = (event) => {
      if (!this.selectionDrawingActive) return;
      if (typeof canvas.releasePointerCapture === 'function') {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch (err) {
          // ignore release errors
        }
      }

      this.selectionDrawingActive = false;
      this.selectionDragStart = null;
      this.selectionDragEnd = null;
      this.#setDrawingEnabled(false);
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', finalizeDrawing);
    canvas.addEventListener('pointerleave', finalizeDrawing);
    canvas.addEventListener('pointercancel', cancelDrawing);

    this._selectionListenersInstalled = true;
  }

  // Reusable checkbox row helper
  #addCheckbox(body, label, title, initial, onChange) {
    const row = document.createElement('label');

    row.className = 'control-row';
    row.title = title;
    const line = document.createElement('div');

    line.className = 'control-line control-line--checkbox';
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

      swatch.className = 'control-swatch';
      swatch.style.background = color;
      nameEl.appendChild(swatch);
    }
    const labelEl = document.createElement('span');

    labelEl.textContent = label;
    nameEl.appendChild(labelEl);

    const valueEl = document.createElement('div');

    valueEl.className = 'control-value';

    if (value instanceof Node) {
      valueEl.appendChild(value);
    } else if (value !== undefined && value !== null) {
      valueEl.textContent = value;
    }

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

    header.addEventListener('click', () => {
      toggleCollapsed();
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

    const addSectionHeading = (text) => {
      const heading = document.createElement('h4');

      heading.className = 'control-section-title';
      heading.textContent = text;
      body.appendChild(heading);

      return heading;
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

    const addSelect = (opts, parent = body) => {
      const { label, title, value, options = [], onChange } = opts;
      const row = document.createElement('label');

      row.className = 'control-row';
      if (title) row.title = title;
      const name = document.createElement('div');

      name.className = 'control-name';
      name.textContent = label;
      const line = document.createElement('div');

      line.className = 'control-line';
      const select = document.createElement('select');

      options.forEach((option) => {
        const opt = document.createElement('option');

        opt.value = option.value;
        opt.textContent = option.label;
        if (option.description) opt.title = option.description;
        select.appendChild(opt);
      });
      select.value = value;
      select.addEventListener('input', () => onChange?.(select.value));
      line.appendChild(select);
      row.appendChild(name);
      row.appendChild(line);
      parent.appendChild(row);

      return select;
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

    const sliderConfig = UI_SLIDER_CONFIG || {};

    const withSliderConfig = (key, overrides) => {
      const bounds = sliderConfig[key] || {};
      const min = bounds.min ?? overrides.min ?? 0;
      const max = bounds.max ?? overrides.max ?? 1;
      const step = bounds.step ?? overrides.step ?? 0.01;
      const floor = bounds.floor;

      return {
        label: overrides.label,
        min,
        max,
        step,
        title: overrides.title,
        format: overrides.format ?? ((v) => String(v)),
        getValue: overrides.getValue,
        setValue: (value) => {
          const next = floor === undefined ? value : Math.max(floor, value);

          overrides.setValue(next);
        },
        position: overrides.position,
      };
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
      withSliderConfig('societySimilarity', {
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
      }),
      withSliderConfig('enemySimilarity', {
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
      }),
    ];

    const eventConfigs = [
      withSliderConfig('eventStrengthMultiplier', {
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
      }),
      withSliderConfig('eventFrequencyMultiplier', {
        label: 'Event Frequency ×',
        min: 0,
        max: 3,
        step: 0.1,
        title: 'How often events spawn (0 disables new events)',
        format: (v) => v.toFixed(1),
        getValue: () => this.eventFrequencyMultiplier,
        setValue: (v) => {
          this.eventFrequencyMultiplier = v;
        },
      }),
    ];

    const energyConfigs = [
      withSliderConfig('densityEffectMultiplier', {
        label: 'Density Effect ×',
        min: 0,
        max: 2,
        step: 0.05,
        title:
          'Scales how strongly population density affects energy, aggression, and breeding (0..2)',
        format: (v) => v.toFixed(2),
        getValue: () => this.densityEffectMultiplier,
        setValue: (v) => {
          this.densityEffectMultiplier = v;
        },
      }),
      withSliderConfig('energyRegenRate', {
        label: 'Energy Regen Rate',
        min: 0,
        max: 0.2,
        step: 0.005,
        title: 'Base logistic regeneration rate toward max energy (0..0.2)',
        format: (v) => v.toFixed(3),
        getValue: () => this.energyRegenRate,
        setValue: (v) => {
          this.energyRegenRate = v;
        },
      }),
      withSliderConfig('energyDiffusionRate', {
        label: 'Energy Diffusion Rate',
        min: 0,
        max: 0.5,
        step: 0.01,
        title: 'How quickly energy smooths between tiles (0..0.5)',
        format: (v) => v.toFixed(2),
        getValue: () => this.energyDiffusionRate,
        setValue: (v) => {
          this.energyDiffusionRate = v;
        },
      }),
    ];

    const generalConfigs = [
      withSliderConfig('mutationMultiplier', {
        label: 'Mutation Rate ×',
        min: 0,
        max: 3,
        step: 0.05,
        title:
          'Scales averaged parental mutation chance and range for offspring (0 disables mutation)',
        format: (v) => v.toFixed(2),
        getValue: () => this.mutationMultiplier,
        setValue: (v) => {
          this.mutationMultiplier = v;
        },
        position: 'beforeOverlays',
      }),
      withSliderConfig('speedMultiplier', {
        label: 'Speed ×',
        min: 0.5,
        max: 100,
        step: 0.5,
        title: 'Speed multiplier relative to 60 updates/sec (0.5x..100x)',
        format: (v) => `${v.toFixed(1)}x`,
        getValue: () => this.speedMultiplier,
        setValue: (v) => {
          this.speedMultiplier = v;
        },
        position: 'beforeOverlays',
      }),
      withSliderConfig('leaderboardIntervalMs', {
        label: 'Leaderboard Interval',
        min: 100,
        max: 3000,
        step: 50,
        title: 'Delay between leaderboard refreshes in milliseconds (100..3000)',
        format: (v) => `${Math.round(v)} ms`,
        getValue: () => this.leaderboardIntervalMs,
        setValue: (v) => {
          this.leaderboardIntervalMs = v;
        },
        position: 'afterEnergy',
      }),
    ];

    addSectionHeading('Similarity Thresholds');
    const thresholdsGroup = addGrid();

    thresholdConfigs.forEach((cfg) => renderSlider(cfg, thresholdsGroup));

    addSectionHeading('Environmental Events');
    const eventsGroup = addGrid();

    eventConfigs.forEach((cfg) => renderSlider(cfg, eventsGroup));

    addSectionHeading('General Settings');
    const generalGroup = addGrid();

    generalConfigs
      .filter((cfg) => cfg.position === 'beforeOverlays')
      .forEach((cfg) => renderSlider(cfg, generalGroup));

    // Overlay toggles
    const overlayHeader = document.createElement('h4');

    overlayHeader.textContent = 'Overlays';
    overlayHeader.className = 'overlay-header';
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

    if (this.selectionManager) {
      const zoneHeader = document.createElement('h4');

      zoneHeader.textContent = 'Reproductive Zones';
      zoneHeader.className = 'overlay-header';
      body.appendChild(zoneHeader);

      const zoneGrid = addGrid('control-grid--compact');
      const patterns = this.selectionManager.getPatterns();

      patterns.forEach((pattern) => {
        const checkbox = this.#addCheckbox(
          zoneGrid,
          pattern.name,
          pattern.description || '',
          pattern.active,
          (checked) => {
            this.selectionManager.togglePattern(pattern.id, checked);
            this.#updateZoneSummary();
            this.#scheduleUpdate();
          }
        );

        this.patternCheckboxes[pattern.id] = checkbox;
      });

      const zoneButtons = document.createElement('div');

      zoneButtons.className = 'control-button-row';
      this.drawZoneButton = document.createElement('button');
      this.drawZoneButton.textContent = 'Draw Custom Zone';
      this.drawZoneButton.addEventListener('click', () => {
        this.#toggleRegionDrawing(!this.selectionDrawingEnabled);
      });
      zoneButtons.appendChild(this.drawZoneButton);

      const clearButton = document.createElement('button');

      clearButton.textContent = 'Clear Custom Zones';
      clearButton.addEventListener('click', () => {
        this.selectionManager.clearCustomZones();
        this.#setDrawingEnabled(false);
        this.#updateZoneSummary();
        this.#scheduleUpdate();
      });
      zoneButtons.appendChild(clearButton);
      body.appendChild(zoneButtons);

      this.zoneSummaryEl = document.createElement('div');

      this.zoneSummaryEl.className = 'control-hint';
      body.appendChild(this.zoneSummaryEl);
      this.#updateZoneSummary();
    }

    addSectionHeading('Energy Dynamics');
    const energyGroup = addGrid();

    energyConfigs.forEach((cfg) => renderSlider(cfg, energyGroup));

    generalConfigs
      .filter((cfg) => cfg.position === 'afterEnergy')
      .forEach((cfg) => renderSlider(cfg, generalGroup));

    return panel;
  }

  #buildInsightsPanel() {
    const { panel, body } = this.#createPanel('Evolution Insights');

    this.metricsBox = document.createElement('div');
    this.metricsBox.className = 'metrics-box';
    body.appendChild(this.metricsBox);

    // Sparklines canvases
    const traitDescriptors = [
      { key: 'cooperation', name: 'Cooperation' },
      { key: 'fighting', name: 'Fighting' },
      { key: 'breeding', name: 'Breeding' },
      { key: 'sight', name: 'Sight' },
    ];

    const traitSparkDescriptors = traitDescriptors.flatMap(({ key, name }) => [
      {
        label: `${name} Activity (presence %)`,
        property: `sparkTrait${name}Presence`,
        traitKey: key,
        traitType: 'presence',
        color: '#f39c12',
      },
      {
        label: `${name} Intensity (avg level)`,
        property: `sparkTrait${name}Average`,
        traitKey: key,
        traitType: 'average',
        color: '#3498db',
      },
    ]);

    const sparkDescriptors = [
      { label: 'Population', property: 'sparkPop', color: '#88d' },
      { label: 'Diversity', property: 'sparkDiv2Canvas', color: '#d88' },
      { label: 'Mean Energy', property: 'sparkEnergy', color: '#8d8' },
      { label: 'Growth', property: 'sparkGrowth', color: '#dd8' },
      { label: 'Event Strength', property: 'sparkEvent', color: '#b85' },
      { label: 'Mutation Multiplier', property: 'sparkMutation', color: '#6c5ce7' },
      { label: 'Diverse Pairing Rate', property: 'sparkDiversePairing', color: '#9b59b6' },
      {
        label: 'Mean Diversity Appetite',
        property: 'sparkDiversityAppetite',
        color: '#1abc9c',
      },
      ...traitSparkDescriptors,
    ];

    this.traitSparkDescriptors = traitSparkDescriptors;

    const sparkGrid = document.createElement('div');

    sparkGrid.className = 'sparkline-grid';
    body.appendChild(sparkGrid);

    sparkDescriptors.forEach(({ label, property, color }) => {
      const card = document.createElement('div');
      const caption = document.createElement('div');

      card.className = 'sparkline-card';
      caption.className = 'control-name';
      caption.textContent = label;
      if (color) caption.style.color = color;

      const canvas = document.createElement('canvas');

      canvas.className = 'sparkline';
      canvas.width = 220;
      canvas.height = 40;

      card.appendChild(caption);
      card.appendChild(canvas);
      sparkGrid.appendChild(card);

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
  getMutationMultiplier() {
    return this.mutationMultiplier;
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
  shouldRenderSlowUi(now) {
    const interval = Math.max(0, this.leaderboardIntervalMs);

    if (interval === 0 || now - this._lastSlowUiRender >= interval) {
      this._lastSlowUiRender = now;

      return true;
    }

    return false;
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
    const s = snapshot || {};
    const totals = (stats && stats.totals) || {};
    const lastTotals = this._lastInteractionTotals || { fights: 0, cooperations: 0 };
    const fightDelta = Math.max(0, (totals.fights ?? 0) - (lastTotals.fights ?? 0));
    const coopDelta = Math.max(0, (totals.cooperations ?? 0) - (lastTotals.cooperations ?? 0));
    const interactionTotal = fightDelta + coopDelta;

    this._lastInteractionTotals = {
      fights: totals.fights ?? lastTotals.fights ?? 0,
      cooperations: totals.cooperations ?? lastTotals.cooperations ?? 0,
    };

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
    if (typeof s.mutationMultiplier === 'number') {
      const formatted = s.mutationMultiplier.toFixed(2);
      const suffix = s.mutationMultiplier <= 0 ? '× (off)' : '×';

      this.#appendControlRow(this.metricsBox, {
        label: 'Mutation Multiplier',
        value: `${formatted}${suffix}`,
        title: 'Global multiplier applied to mutation chance and range for offspring',
      });
    }
    this.#appendControlRow(this.metricsBox, {
      label: 'Skirmishes',
      value: String(fightDelta),
      title: 'Skirmishes resolved since the last dashboard update',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Cooperations',
      value: String(coopDelta),
      title: 'Mutual aid events completed since the last dashboard update',
    });

    this.#appendControlRow(this.metricsBox, {
      label: 'Cooperation Share',
      value: interactionTotal ? `${((coopDelta / interactionTotal) * 100).toFixed(0)}%` : '—',
      title: 'Share of cooperative interactions vs total interactions recorded for this update',
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

    const mateChoicesValue = Number.isFinite(s.mateChoices) ? String(s.mateChoices) : '—';
    const successfulMatingsValue = Number.isFinite(s.successfulMatings)
      ? String(s.successfulMatings)
      : '—';
    const diverseChoiceRateValue = Number.isFinite(s.diverseChoiceRate)
      ? `${(s.diverseChoiceRate * 100).toFixed(0)}%`
      : '—';
    const diverseMatingRateValue = Number.isFinite(s.diverseMatingRate)
      ? `${(s.diverseMatingRate * 100).toFixed(0)}%`
      : '—';
    const meanDiversityAppetiteValue = Number.isFinite(s.meanDiversityAppetite)
      ? s.meanDiversityAppetite.toFixed(2)
      : '—';
    const curiositySelectionsValue = Number.isFinite(s.curiositySelections)
      ? String(s.curiositySelections)
      : '—';

    if (typeof s.blockedMatings === 'number') {
      this.#appendControlRow(this.metricsBox, {
        label: 'Blocked Matings',
        value: String(s.blockedMatings),
        title: 'Matings prevented by reproductive zones this tick',
      });
    }

    if (s.lastBlockedReproduction?.reason) {
      this.#appendControlRow(this.metricsBox, {
        label: 'Last Blocked Reason',
        value: s.lastBlockedReproduction.reason,
        title: 'Most recent reason reproduction was denied',
      });
    }

    this.#appendControlRow(this.metricsBox, {
      label: 'Mate Choices',
      value: mateChoicesValue,
      title: 'Potential mates evaluated by the population this tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Successful Matings',
      value: successfulMatingsValue,
      title: 'Pairs that successfully reproduced this tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Diverse Choice Rate',
      value: diverseChoiceRateValue,
      title: 'Share of mate choices favoring genetically diverse partners this tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Diverse Mating Rate',
      value: diverseMatingRateValue,
      title: 'Share of completed matings rated as genetically diverse this tick',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Mean Diversity Appetite',
      value: meanDiversityAppetiteValue,
      title: 'Average preferred genetic difference when selecting a mate',
    });
    this.#appendControlRow(this.metricsBox, {
      label: 'Curiosity Selections',
      value: curiositySelectionsValue,
      title: 'Mate selections driven by curiosity-driven exploration this tick',
    });

    const traitPresence = stats?.traitPresence;

    if (traitPresence) {
      const traitGroup = document.createElement('div');

      traitGroup.className = 'metrics-group';

      const traitHeading = document.createElement('div');

      traitHeading.className = 'metrics-group-title';
      traitHeading.textContent = 'Traits';
      traitGroup.appendChild(traitHeading);

      const traitRows = document.createElement('div');

      traitRows.className = 'metrics-group-rows';
      traitGroup.appendChild(traitRows);

      const hasPopulation = traitPresence.population > 0;
      const traitConfigs = [
        { key: 'cooperation', label: 'Cooperation' },
        { key: 'fighting', label: 'Fighting' },
        { key: 'breeding', label: 'Breeding' },
        { key: 'sight', label: 'Sight' },
      ];

      for (let i = 0; i < traitConfigs.length; i++) {
        const trait = traitConfigs[i];
        const count = traitPresence.counts?.[trait.key] ?? 0;
        const fraction = traitPresence.fractions?.[trait.key] ?? 0;
        const value = hasPopulation ? `${count} (${(fraction * 100).toFixed(0)}%)` : '—';
        const tooltipBase = 'Active cells have a normalized value ≥ 60% for this trait.';

        this.#appendControlRow(traitRows, {
          label: trait.label,
          value,
          title: hasPopulation ? tooltipBase : `${tooltipBase} No living cells in population.`,
        });
      }

      this.metricsBox.appendChild(traitGroup);
    }

    this.drawSpark(this.sparkPop, stats.history.population, '#88d');
    this.drawSpark(this.sparkDiv2Canvas, stats.history.diversity, '#d88');
    this.drawSpark(this.sparkEnergy, stats.history.energy, '#8d8');
    this.drawSpark(this.sparkGrowth, stats.history.growth, '#dd8');
    this.drawSpark(this.sparkEvent, stats.history.eventStrength, '#b85');
    this.drawSpark(this.sparkMutation, stats.history.mutationMultiplier, '#6c5ce7');
    this.drawSpark(this.sparkDiversePairing, stats.history.diversePairingRate, '#9b59b6');
    this.drawSpark(this.sparkDiversityAppetite, stats.history.meanDiversityAppetite, '#1abc9c');

    if (Array.isArray(this.traitSparkDescriptors)) {
      this.traitSparkDescriptors.forEach(({ property, traitKey, traitType, color }) => {
        const canvas = this[property];
        const data = stats?.traitHistory?.[traitType]?.[traitKey];

        this.drawSpark(canvas, Array.isArray(data) ? data : [], color);
      });
    }
  }

  drawSpark(canvas, data, color = '#88d') {
    if (!canvas) return;
    const series = Array.isArray(data) ? data : [];
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    if (series.length < 2) return;
    const min = Math.min(...series);
    const max = Math.max(...series);
    const span = max - min || 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = (i / (series.length - 1)) * (w - 1);
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
    top.forEach((entry, index) => {
      const label = `#${index + 1}`;
      const smoothedFitness = Number.isFinite(entry.smoothedFitness)
        ? entry.smoothedFitness
        : undefined;
      const fitnessValue = Number.isFinite(smoothedFitness) ? smoothedFitness : entry.fitness;
      const brain = entry.brain ?? {};

      const statsContainer = document.createElement('div');

      statsContainer.className = 'leaderboard-stats';

      const formatFloat = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—');
      const formatCount = (value) => (Number.isFinite(value) ? value.toLocaleString() : '—');

      const statRows = [
        { label: 'Fitness', value: formatFloat(fitnessValue) },
        { label: 'Neurons', value: formatCount(brain.neuronCount) },
        { label: 'Brain', value: formatFloat(brain.fitness) },
        { label: 'Connections', value: formatCount(brain.connectionCount) },
      ];

      statRows.forEach(({ label: statLabel, value }) => {
        const statRow = document.createElement('div');

        statRow.className = 'leaderboard-stat';

        const statLabelEl = document.createElement('span');

        statLabelEl.className = 'leaderboard-stat-label';
        statLabelEl.textContent = statLabel;

        const statValueEl = document.createElement('span');

        statValueEl.className = 'leaderboard-stat-value';
        statValueEl.textContent = value;

        statRow.appendChild(statLabelEl);
        statRow.appendChild(statValueEl);
        statsContainer.appendChild(statRow);
      });

      this.#appendControlRow(this.leaderBody, {
        label,
        value: statsContainer,
        title: `Fitness ${statRows[0].value} | Neurons ${statRows[1].value} | Brain ${statRows[2].value} | Connections ${statRows[3].value}`,
        color: entry.color,
      });
    });
  }
}
