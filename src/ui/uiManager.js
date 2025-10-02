import { resolveSimulationDefaults } from "../config.js";
import { UI_SLIDER_CONFIG } from "./sliderConfig.js";
import { clamp, clamp01, warnOnce, toPlainObject } from "../utils.js";
import {
  createControlButtonRow,
  createControlGrid,
  createSectionHeading,
  createSelectRow,
  createSliderRow,
} from "./controlBuilders.js";

/**
 * Constructs and manages the browser-based control surface. The UI manager
 * renders the canvas layout, exposes slider/button controls, and synchronizes
 * user interactions back to the {@link SimulationEngine}. It also forwards
 * slow-updating metrics to dashboards and coordinates selection drawing.
 */
export default class UIManager {
  constructor(
    simulationCallbacks = {},
    mountSelector = "#app",
    actions = {},
    layoutOptions = {},
  ) {
    const normalizedCallbacks = toPlainObject(simulationCallbacks);
    const normalizedActions = toPlainObject(actions);
    const normalizedLayout = toPlainObject(layoutOptions);
    const { obstaclePresets = [], ...actionFns } = normalizedActions;
    const selectionManagerOption = normalizedActions.selectionManager;
    const getCellSizeFn = normalizedActions.getCellSize;

    const defaults = resolveSimulationDefaults();

    this.simulationCallbacks = normalizedCallbacks;
    this.actions = actionFns;
    this.obstaclePresets = Array.isArray(obstaclePresets) ? obstaclePresets : [];
    this.paused = Boolean(defaults.paused);
    this.selectionManager = selectionManagerOption ?? null;
    this.getCellSize =
      typeof getCellSizeFn === "function"
        ? getCellSizeFn.bind(normalizedActions)
        : () => 1;
    this.selectionDrawingEnabled = false;
    this.selectionDragStart = null;
    this.canvasElement = null;
    this.selectionDrawingActive = false;
    this.selectionDragEnd = null;
    this.drawZoneButton = null;
    this.zoneSummaryEl = null;
    this._selectionListenersInstalled = false;
    this.stepButton = null;
    this.clearZonesButton = null;
    this.metricsPlaceholder = null;
    this.lifeEventList = null;
    this.lifeEventsEmptyState = null;

    // Settings with sensible defaults
    this.societySimilarity = defaults.societySimilarity;
    this.enemySimilarity = defaults.enemySimilarity;
    this.eventStrengthMultiplier = defaults.eventStrengthMultiplier;
    this.eventFrequencyMultiplier = defaults.eventFrequencyMultiplier;
    this.maxConcurrentEvents = defaults.maxConcurrentEvents;
    this.speedMultiplier = defaults.speedMultiplier;
    this.densityEffectMultiplier = defaults.densityEffectMultiplier;
    this.mutationMultiplier = defaults.mutationMultiplier;
    this.combatEdgeSharpness = defaults.combatEdgeSharpness;
    this.matingDiversityThreshold = defaults.matingDiversityThreshold;
    this.lowDiversityReproMultiplier = defaults.lowDiversityReproMultiplier;
    this.energyRegenRate = defaults.energyRegenRate; // base logistic regen rate (0..0.2)
    this.energyDiffusionRate = defaults.energyDiffusionRate; // neighbor diffusion rate (0..0.5)
    this.leaderboardIntervalMs = defaults.leaderboardIntervalMs;
    this._lastSlowUiRender = Number.NEGATIVE_INFINITY; // shared throttle for fast-updating UI bits
    this._lastInteractionTotals = { fights: 0, cooperations: 0 };
    this.showDensity = defaults.showDensity;
    this.showEnergy = defaults.showEnergy;
    this.showFitness = defaults.showFitness;
    this.showObstacles = defaults.showObstacles;
    this.showCelebrationAuras = defaults.showCelebrationAuras;
    this.autoPauseOnBlur = defaults.autoPauseOnBlur;
    this.obstaclePreset = this.obstaclePresets[0]?.id ?? "none";
    const initialObstaclePreset = this.#resolveInitialObstaclePreset(actionFns);

    if (initialObstaclePreset) {
      this.obstaclePreset = initialObstaclePreset;
    }
    this.autoPauseCheckbox = null;
    // Build UI
    this.root = document.querySelector(mountSelector) || document.body;

    // Layout container with canvas on the left and sidebar on the right
    this.mainRow = document.createElement("div");
    this.mainRow.className = "main-row";
    this.canvasContainer = document.createElement("div");
    this.canvasContainer.className = "canvas-container";
    this.sidebar = document.createElement("div");
    this.sidebar.className = "sidebar";
    this.dashboardGrid = document.createElement("div");
    this.dashboardGrid.className = "dashboard-grid";
    this.sidebar.appendChild(this.dashboardGrid);
    this.mainRow.appendChild(this.canvasContainer);
    this.mainRow.appendChild(this.sidebar);

    // Allow callers to customize which keys toggle the pause state.
    this.pauseHotkeySet = this.#resolveHotkeySet(normalizedLayout.pauseHotkeys);

    const canvasEl =
      normalizedLayout.canvasElement ||
      this.#resolveNode(normalizedLayout.canvasSelector);
    const anchorNode =
      this.#resolveNode(normalizedLayout.before) ||
      this.#resolveNode(normalizedLayout.insertBefore);

    if (canvasEl) {
      this.attachCanvas(canvasEl, { before: anchorNode });
    } else {
      this.#ensureMainRowMounted(anchorNode);
    }
    this.controlsPanel = this.#buildControlsPanel();
    this.insightsPanel = this.#buildInsightsPanel();
    this.lifeEventsPanel = this.#buildLifeEventsPanel();
    this.dashboardGrid.appendChild(this.controlsPanel);
    this.dashboardGrid.appendChild(this.insightsPanel);
    this.dashboardGrid.appendChild(this.lifeEventsPanel);

    // Keyboard toggle
    document.addEventListener("keydown", (e) => {
      if (!e?.key) return;

      const key = e.key.toLowerCase();

      if (this.pauseHotkeySet.has(key)) {
        this.togglePause();
      }
    });
  }

  #resolveHotkeySet(candidate) {
    const fallback = ["p"];

    const values = Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string" && candidate.length > 0
        ? [candidate]
        : fallback;

    const normalized = values
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => value.length > 0);

    return new Set(normalized.length > 0 ? normalized : fallback);
  }

  #resolveInitialObstaclePreset(actionFns = {}) {
    let candidate = null;

    const getter = actionFns?.getCurrentObstaclePreset;

    if (typeof getter === "function") {
      try {
        candidate = getter();
      } catch (error) {
        warnOnce("Failed to read current obstacle preset from actions.", error);
      }
    }

    if (
      (!candidate || typeof candidate !== "string" || candidate.length === 0) &&
      typeof window !== "undefined"
    ) {
      const fromWindow = window.grid?.currentObstaclePreset;

      if (typeof fromWindow === "string" && fromWindow.length > 0) {
        candidate = fromWindow;
      }
    }

    if (typeof candidate !== "string" || candidate.length === 0) {
      return null;
    }

    const match = this.obstaclePresets.find((preset) => preset?.id === candidate);

    return match ? match.id : null;
  }

  attachCanvas(canvasElement, options = {}) {
    const targetCanvas = this.#resolveNode(canvasElement);

    if (!(targetCanvas instanceof HTMLElement)) return;
    this.canvasElement = targetCanvas;
    const anchor =
      this.#resolveNode(options.before) ||
      this.#resolveNode(options.insertBefore) ||
      targetCanvas;

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
    if (typeof candidate === "string") {
      return this.root.querySelector(candidate) || document.querySelector(candidate);
    }

    return null;
  }

  #setPointerCapture(target, pointerId) {
    if (!target || typeof target.setPointerCapture !== "function") return;

    try {
      target.setPointerCapture(pointerId);
    } catch (error) {
      warnOnce("Failed to set pointer capture for selection drawing.", error);
    }
  }

  #releasePointerCapture(target, pointerId) {
    if (!target || typeof target.releasePointerCapture !== "function") return;

    try {
      target.releasePointerCapture(pointerId);
    } catch (error) {
      warnOnce("Failed to release pointer capture after selection drawing.", error);
    }
  }

  #scheduleUpdate() {
    if (typeof this.simulationCallbacks?.requestFrame === "function") {
      this.simulationCallbacks.requestFrame();

      return;
    }

    if (
      typeof window !== "undefined" &&
      typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(() => {});
    }
  }

  #notifySettingChange(key, value) {
    if (typeof this.simulationCallbacks?.onSettingChange === "function") {
      this.simulationCallbacks.onSettingChange(key, value);
    }
  }

  #updateSetting(key, value) {
    this[key] = value;
    this.#notifySettingChange(key, value);
  }

  #setDrawingEnabled(enabled) {
    this.selectionDrawingEnabled = Boolean(enabled);
    const isActive = this.selectionDrawingEnabled;

    if (this.drawZoneButton) {
      this.drawZoneButton.classList.toggle("active", isActive);
      this.drawZoneButton.textContent = isActive
        ? "Cancel Drawing"
        : "Draw Custom Zone";
      this.drawZoneButton.setAttribute("aria-pressed", isActive ? "true" : "false");
      this.drawZoneButton.title = isActive
        ? "Cancel drawing mode and keep the current reproductive zones."
        : "Enable drawing mode to sketch a custom reproductive zone on the canvas.";
    }

    if (!isActive) {
      this.selectionDragStart = null;
      this.selectionDragEnd = null;
      this.selectionDrawingActive = false;
    }
  }

  #toggleRegionDrawing(nextState) {
    const state =
      typeof nextState === "boolean" ? nextState : !this.selectionDrawingEnabled;

    this.#setDrawingEnabled(state);
  }

  #updateZoneSummary() {
    if (!this.zoneSummaryEl) return;
    const summary = this.selectionManager
      ? this.selectionManager.describeActiveZones()
      : "All tiles eligible";

    this.zoneSummaryEl.textContent = summary;
    this.#updateCustomZoneButtons();
  }

  #updateCustomZoneButtons() {
    if (!this.clearZonesButton) return;

    const hasZones = Boolean(
      this.selectionManager &&
        typeof this.selectionManager.hasCustomZones === "function" &&
        this.selectionManager.hasCustomZones(),
    );

    this.clearZonesButton.disabled = !hasZones;
    this.clearZonesButton.title = hasZones
      ? "Remove all custom reproductive zones."
      : "No custom reproductive zones to clear.";
  }

  #canvasToGrid(event) {
    if (!this.canvasElement) return null;

    const rect = this.canvasElement.getBoundingClientRect?.();
    const cellSize = Math.max(1, this.getCellSize());
    const offsetX = event.clientX - (rect?.left ?? 0);
    const offsetY = event.clientY - (rect?.top ?? 0);
    const scaleX =
      rect && Number.isFinite(rect.width) && rect.width > 0
        ? this.canvasElement.width / rect.width
        : 1;
    const scaleY =
      rect && Number.isFinite(rect.height) && rect.height > 0
        ? this.canvasElement.height / rect.height
        : 1;
    const canvasX = offsetX * (Number.isFinite(scaleX) && scaleX > 0 ? scaleX : 1);
    const canvasY = offsetY * (Number.isFinite(scaleY) && scaleY > 0 ? scaleY : 1);
    const col = Math.floor(canvasX / cellSize);
    const row = Math.floor(canvasY / cellSize);
    const maxCols = Math.floor(this.canvasElement.width / cellSize);
    const maxRows = Math.floor(this.canvasElement.height / cellSize);

    if (col < 0 || row < 0 || col >= maxCols || row >= maxRows) return null;

    return { row, col };
  }

  #installRegionDrawing() {
    if (
      !this.canvasElement ||
      !this.selectionManager ||
      this._selectionListenersInstalled
    )
      return;

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
      this.#setPointerCapture(canvas, event.pointerId);
    };

    const handlePointerMove = (event) => {
      if (!this.selectionDrawingActive || !this.selectionDrawingEnabled) return;
      const point = this.#canvasToGrid(event);

      if (point) this.selectionDragEnd = point;
    };

    const finalizeDrawing = (event) => {
      if (!this.selectionDrawingActive) return;

      event.preventDefault();
      this.#releasePointerCapture(canvas, event.pointerId);

      const end = this.#canvasToGrid(event) || this.selectionDragEnd;
      const start = this.selectionDragStart;

      if (start && end) {
        const zone = this.selectionManager.addCustomRectangle(
          start.row,
          start.col,
          end.row,
          end.col,
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
      this.#releasePointerCapture(canvas, event.pointerId);

      this.selectionDrawingActive = false;
      this.selectionDragStart = null;
      this.selectionDragEnd = null;
      this.#setDrawingEnabled(false);
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", finalizeDrawing);
    canvas.addEventListener("pointerleave", finalizeDrawing);
    canvas.addEventListener("pointercancel", cancelDrawing);

    this._selectionListenersInstalled = true;
  }

  // Reusable checkbox row helper
  #addCheckbox(body, label, title, initial, onChange) {
    const row = document.createElement("label");

    row.className = "control-row";
    if (title) row.title = title;
    const line = document.createElement("div");

    line.className = "control-line control-line--checkbox";
    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = Boolean(initial);
    if (typeof onChange === "function") {
      input.addEventListener("input", () => onChange(input.checked));
    }
    const name = document.createElement("div");

    name.className = "control-name";
    name.textContent = label ?? "";
    line.appendChild(input);
    line.appendChild(name);
    row.appendChild(line);
    body.appendChild(row);

    return input;
  }

  #appendControlRow(container, { label, value, title, color, valueClass }) {
    const row = document.createElement("div");

    row.className = "control-line";
    if (title) row.title = title;

    const nameEl = document.createElement("div");

    nameEl.className = "control-name";
    if (color) {
      const swatch = document.createElement("span");

      swatch.className = "control-swatch";
      swatch.style.background = color;
      nameEl.appendChild(swatch);
    }
    const labelEl = document.createElement("span");

    labelEl.textContent = label;
    nameEl.appendChild(labelEl);

    const valueEl = document.createElement("div");

    valueEl.className = valueClass ? `control-value ${valueClass}` : "control-value";

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

  #formatLifeEventCause(event) {
    const raw =
      typeof event?.cause === "string" ? event.cause.trim().toLowerCase() : "";
    const type = event?.type === "birth" ? "Birth" : "Death";
    const map = {
      seed: "Seeded",
      reproduction: "Reproduction",
      senescence: "Lifespan Reached",
      starvation: "Starvation",
      "energy-collapse": "Energy Collapse",
      combat: "Combat",
      obstacle: "Obstacle",
    };

    if (raw && map[raw]) {
      return map[raw];
    }

    if (!raw) {
      return type;
    }

    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }

  #formatEventTypeLabel(type) {
    if (typeof type !== "string" || type.length === 0) {
      return "Event";
    }

    const normalized = type.replace(/[_-]+/g, " ").trim();

    if (normalized.length === 0) {
      return "Event";
    }

    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  #describeEventSummary(event, multiplier) {
    if (!event) return "Environmental event modifier";

    const typeLabel = this.#formatEventTypeLabel(event.type);
    const pieces = [];
    const coverage = Number.isFinite(event.coverageRatio)
      ? `${Math.round(clamp(event.coverageRatio, 0, 1) * 100)}% of the grid`
      : null;
    const remaining = Number.isFinite(event.remainingTicks)
      ? `${event.remainingTicks} ticks remaining`
      : null;
    const duration = Number.isFinite(event.durationTicks)
      ? `${event.durationTicks} ticks total`
      : null;
    const baseIntensity = Number.isFinite(event.strength)
      ? `base intensity ${event.strength.toFixed(2)}×`
      : null;
    const effectiveIntensity = Number.isFinite(event.effectiveStrength)
      ? `effective intensity ${event.effectiveStrength.toFixed(2)}×`
      : null;

    if (coverage) pieces.push(coverage);
    if (remaining) pieces.push(remaining);
    if (duration && duration !== remaining) pieces.push(duration);

    const summary = pieces.length > 0 ? pieces.join(", ") : "influence over the grid";
    const strengthParts = [baseIntensity, effectiveIntensity]
      .filter(Boolean)
      .join(" → ");
    const multiplierPart = Number.isFinite(multiplier)
      ? `Global strength multiplier ${multiplier.toFixed(2)}×.`
      : "";

    return [`${typeLabel} affects ${summary}.`, strengthParts, multiplierPart]
      .map((part) => part && part.trim())
      .filter(Boolean)
      .join(" ");
  }

  #appendLifeEventDetail(container, { label, value, colors }) {
    if (!(container instanceof HTMLElement)) return null;

    const term = document.createElement("dt");

    term.className = "life-event-detail-label";
    term.textContent = label ?? "";
    container.appendChild(term);

    const valueEl = document.createElement("dd");

    valueEl.className = "life-event-detail-value";
    let hasContent = false;
    let hasTextContent = false;

    if (Array.isArray(colors) && colors.length > 0) {
      const chipGroup = document.createElement("span");

      chipGroup.className = "life-event-color-group";
      chipGroup.setAttribute("aria-hidden", "true");
      colors.forEach((color) => {
        if (typeof color !== "string" || color.length === 0) return;

        const chip = document.createElement("span");

        chip.className = "life-event-color-chip";
        chip.style.background = color;
        chip.title = color;
        chipGroup.appendChild(chip);
      });

      if (chipGroup.childElementCount > 0) {
        valueEl.appendChild(chipGroup);
        hasContent = true;
      }
    }

    if (value instanceof Node) {
      valueEl.appendChild(value);
      hasContent = true;
      hasTextContent = true;
    } else if (value != null) {
      const text = document.createElement("span");

      text.textContent = String(value);
      valueEl.appendChild(text);
      hasContent = true;
      hasTextContent = true;
    }

    if (!hasTextContent && hasContent) {
      const srText = document.createElement("span");

      srText.className = "visually-hidden";
      srText.textContent = `${label ?? "Value"} color indicator`;
      valueEl.appendChild(srText);
    }

    if (!hasContent) {
      valueEl.textContent = "—";
    }

    container.appendChild(valueEl);

    return valueEl;
  }

  #renderLifeEvents(stats) {
    if (!this.lifeEventList) return;

    const events =
      typeof stats?.getRecentLifeEvents === "function"
        ? stats.getRecentLifeEvents(12)
        : [];

    this.lifeEventList.innerHTML = "";

    if (!events || events.length === 0) {
      this.lifeEventList.hidden = true;
      if (this.lifeEventsEmptyState) {
        this.lifeEventsEmptyState.hidden = false;
      }

      return;
    }

    this.lifeEventList.hidden = false;
    if (this.lifeEventsEmptyState) {
      this.lifeEventsEmptyState.hidden = true;
    }

    events.forEach((event) => {
      const item = document.createElement("li");

      item.className = `life-event life-event--${event.type || "unknown"}`;
      const typeLabel = event.type === "birth" ? "Birth" : "Death";
      const summary = this.#formatLifeEventCause(event);
      const tickValue =
        Number.isFinite(event.tick) && event.tick >= 0 ? event.tick : "—";

      item.setAttribute(
        "aria-label",
        `${typeLabel} at tick ${tickValue} caused by ${summary}`,
      );
      item.tabIndex = 0;

      const header = document.createElement("div");

      header.className = "life-event-header";
      const dot = document.createElement("span");

      dot.className = "life-event-dot";
      if (event.color) {
        dot.style.background = event.color;
      }
      dot.setAttribute("aria-hidden", "true");
      header.appendChild(dot);

      const typeBadge = document.createElement("span");

      typeBadge.className = `life-event-type life-event-type--${event.type || "unknown"}`;
      typeBadge.textContent = typeLabel;
      typeBadge.setAttribute("aria-hidden", "true");
      header.appendChild(typeBadge);

      const title = document.createElement("span");

      title.className = "life-event-title";
      title.textContent = summary;
      header.appendChild(title);

      const tick = document.createElement("span");

      tick.className = "life-event-meta";
      tick.textContent = `Tick ${tickValue}`;
      header.appendChild(tick);
      item.appendChild(header);

      const details = document.createElement("dl");

      details.className = "life-event-details";
      const hasRow = Number.isFinite(event.row);
      const hasCol = Number.isFinite(event.col);

      if (hasRow || hasCol) {
        const locationValue =
          hasRow && hasCol
            ? `${event.row}, ${event.col}`
            : hasRow
              ? `${event.row}, —`
              : `—, ${event.col}`;

        this.#appendLifeEventDetail(details, { label: "Tile", value: locationValue });
      }

      if (Number.isFinite(event.energy)) {
        this.#appendLifeEventDetail(details, {
          label: "Energy",
          value: event.energy.toFixed(1),
        });
      }

      if (event.highlight) {
        const dominance = Math.round(clamp01(event.highlight.ratio ?? 0) * 100);

        this.#appendLifeEventDetail(details, {
          label: event.highlight.label,
          value: `${dominance}% dominance`,
        });
      }

      if (event.type === "birth" && Number.isFinite(event.mutationMultiplier)) {
        this.#appendLifeEventDetail(details, {
          label: "Mutation",
          value: `${event.mutationMultiplier.toFixed(2)}×`,
        });
      }

      if (Array.isArray(event.parents) && event.parents.length > 0) {
        const parentLabel = event.parents.length > 1 ? "Parents" : "Parent";
        const parentText = `${event.parents.length}`;

        this.#appendLifeEventDetail(details, {
          label: parentLabel,
          value: parentText,
          colors: event.parents,
        });
      }

      if (event.cause === "combat") {
        if (Number.isFinite(event.winChance)) {
          this.#appendLifeEventDetail(details, {
            label: "Victor odds",
            value: `${Math.round(event.winChance * 100)}%`,
          });
        }

        if (Number.isFinite(event.intensity)) {
          this.#appendLifeEventDetail(details, {
            label: "Intensity",
            value: event.intensity.toFixed(2),
          });
        }

        if (event.opponentColor) {
          this.#appendLifeEventDetail(details, {
            label: "Opponent",
            colors: [event.opponentColor],
          });
        }
      }

      if (event.note) {
        this.#appendLifeEventDetail(details, {
          label: "Note",
          value: event.note,
        });
      }

      if (!details.hasChildNodes()) {
        this.#appendLifeEventDetail(details, {
          label: "Details",
          value: "No additional context yet.",
        });
      }

      item.appendChild(details);
      this.lifeEventList.appendChild(item);
    });
  }

  // Utility to create a collapsible panel with a header
  #createPanel(title, options = {}) {
    const { collapsed = false } = options;

    this._panelIdSequence = (this._panelIdSequence ?? 0) + 1;
    const headingId = `panel-${this._panelIdSequence}-title`;
    const bodyId = `panel-${this._panelIdSequence}-body`;
    const panel = document.createElement("div");

    panel.className = "panel";
    const header = document.createElement("div");

    header.className = "panel-header";
    const heading = document.createElement("h3");

    heading.id = headingId;
    heading.textContent = title;
    const toggle = document.createElement("button");

    toggle.type = "button";
    toggle.textContent = "–";
    toggle.className = "panel-toggle";
    toggle.setAttribute("aria-label", `Toggle ${title} panel`);
    toggle.setAttribute("aria-controls", bodyId);
    header.appendChild(heading);
    header.appendChild(toggle);
    panel.appendChild(header);
    const body = document.createElement("div");

    body.className = "panel-body";
    body.id = bodyId;
    body.setAttribute("role", "region");
    body.setAttribute("aria-labelledby", headingId);
    panel.appendChild(body);

    const setCollapsed = (shouldCollapse) => {
      panel.classList.toggle("collapsed", shouldCollapse);
      panel.classList.toggle("expanded", !shouldCollapse);
      toggle.textContent = shouldCollapse ? "+" : "–";
      toggle.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
    };

    const toggleCollapsed = () => {
      setCollapsed(!panel.classList.contains("collapsed"));
    };

    header.addEventListener("click", () => {
      toggleCollapsed();
    });
    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCollapsed();
    });

    setCollapsed(Boolean(collapsed));

    return { panel, header, heading, toggle, body };
  }

  #buildControlsPanel() {
    const { panel, body } = this.#createPanel("Simulation Controls", {
      collapsed: true,
    });

    panel.id = "controls";
    panel.classList.add("controls-panel");

    this.#buildControlButtons(body);

    const sliderContext = this.#buildSliderGroups(body);

    this.sliderContext = sliderContext;

    this.#buildOverlayToggles(body);

    this.#buildObstacleControls(body, sliderContext);

    this.#buildReproductiveZoneTools(body);

    this.#buildEnergyAndGeneralTail(body, sliderContext);

    return panel;
  }

  #buildControlButtons(body) {
    const buttonRow = createControlButtonRow(body);

    const addControlButton = ({ id, label, title, onClick }) => {
      const button = document.createElement("button");

      button.id = id;
      button.textContent = label;
      button.title = title;
      button.addEventListener("click", onClick);
      buttonRow.appendChild(button);

      return button;
    };

    this.pauseButton = addControlButton({
      id: "pauseButton",
      label: "Pause",
      title: "Pause/resume the simulation (shortcut: P)",
      onClick: () => this.togglePause(),
    });

    this.stepButton = addControlButton({
      id: "stepButton",
      label: "Step",
      title: "Advance one tick while paused to inspect changes frame-by-frame.",
      onClick: () => {
        if (typeof this.simulationCallbacks?.step === "function") {
          this.simulationCallbacks.step();
        }
      },
    });

    addControlButton({
      id: "burstButton",
      label: "Burst New Cells",
      title: "Spawn a cluster of new cells at a random spot",
      onClick: () => {
        if (typeof this.actions.burst === "function") this.actions.burst();
        else if (window.grid && typeof window.grid.burstRandomCells === "function")
          window.grid.burstRandomCells();
      },
    });

    this.autoPauseCheckbox = this.#addCheckbox(
      body,
      "Pause When Hidden",
      "Automatically pause when the tab or window loses focus, resuming on return.",
      this.autoPauseOnBlur,
      (checked) => {
        this.setAutoPauseOnBlur(checked);
        this.#updateSetting("autoPauseOnBlur", checked);
      },
    );
  }

  #buildSliderGroups(body) {
    const sliderConfig = UI_SLIDER_CONFIG || {};

    const getSliderValue = (cfg) =>
      typeof cfg.getValue === "function" ? cfg.getValue() : this[cfg.prop];

    const getSliderSetter = (cfg) => {
      if (typeof cfg.setValue === "function") return cfg.setValue;
      if (cfg.prop)
        return (value) => {
          this[cfg.prop] = value;
        };

      return () => {};
    };

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
      createSliderRow(parent, {
        label: cfg.label,
        min: cfg.min,
        max: cfg.max,
        step: cfg.step,
        value: getSliderValue(cfg),
        title: cfg.title,
        format: cfg.format,
        onInput: getSliderSetter(cfg),
      });

    const thresholdConfigs = [
      withSliderConfig("societySimilarity", {
        label: "Ally Similarity ≥",
        min: 0,
        max: 1,
        step: 0.01,
        title: "Minimum genetic similarity to consider another cell an ally (0..1)",
        format: (v) => v.toFixed(2),
        getValue: () => this.societySimilarity,
        setValue: (v) => this.#updateSetting("societySimilarity", v),
      }),
      withSliderConfig("enemySimilarity", {
        label: "Enemy Similarity ≤",
        min: 0,
        max: 1,
        step: 0.01,
        title: "Maximum genetic similarity to consider another cell an enemy (0..1)",
        format: (v) => v.toFixed(2),
        getValue: () => this.enemySimilarity,
        setValue: (v) => this.#updateSetting("enemySimilarity", v),
      }),
      withSliderConfig("matingDiversityThreshold", {
        label: "Min Diversity ≥",
        min: 0,
        max: 1,
        step: 0.01,
        title: "Required genetic diversity before mating avoids penalties (0..1)",
        format: (v) => v.toFixed(2),
        getValue: () => this.matingDiversityThreshold,
        setValue: (v) => this.#updateSetting("matingDiversityThreshold", v),
      }),
    ];

    const eventConfigs = [
      withSliderConfig("eventStrengthMultiplier", {
        label: "Event Strength ×",
        min: 0,
        max: 3,
        step: 0.05,
        title: "Scales the impact of environmental events (0..3)",
        format: (v) => v.toFixed(2),
        getValue: () => this.eventStrengthMultiplier,
        setValue: (v) => this.#updateSetting("eventStrengthMultiplier", v),
      }),
      withSliderConfig("eventFrequencyMultiplier", {
        label: "Event Frequency ×",
        min: 0,
        max: 3,
        step: 0.1,
        title: "How often events spawn (0 disables new events)",
        format: (v) => v.toFixed(1),
        getValue: () => this.eventFrequencyMultiplier,
        setValue: (v) => this.#updateSetting("eventFrequencyMultiplier", v),
      }),
    ];

    const energyConfigs = [
      withSliderConfig("densityEffectMultiplier", {
        label: "Density Effect ×",
        min: 0,
        max: 2,
        step: 0.05,
        title:
          "Scales how strongly population density affects energy, aggression, and breeding (0..2)",
        format: (v) => v.toFixed(2),
        getValue: () => this.densityEffectMultiplier,
        setValue: (v) => this.#updateSetting("densityEffectMultiplier", v),
      }),
      withSliderConfig("energyRegenRate", {
        label: "Energy Regen Rate",
        min: 0,
        max: 0.2,
        step: 0.005,
        title: "Base logistic regeneration rate toward max energy (0..0.2)",
        format: (v) => v.toFixed(3),
        getValue: () => this.energyRegenRate,
        setValue: (v) => this.#updateSetting("energyRegenRate", v),
      }),
      withSliderConfig("energyDiffusionRate", {
        label: "Energy Diffusion Rate",
        min: 0,
        max: 0.5,
        step: 0.01,
        title: "How quickly energy smooths between tiles (0..0.5)",
        format: (v) => v.toFixed(2),
        getValue: () => this.energyDiffusionRate,
        setValue: (v) => this.#updateSetting("energyDiffusionRate", v),
      }),
    ];

    const generalConfigs = [
      withSliderConfig("mutationMultiplier", {
        label: "Mutation Rate ×",
        min: 0,
        max: 3,
        step: 0.05,
        title:
          "Scales averaged parental mutation chance and range for offspring (0 disables mutation)",
        format: (v) => v.toFixed(2),
        getValue: () => this.mutationMultiplier,
        setValue: (v) => this.#updateSetting("mutationMultiplier", v),
        position: "beforeOverlays",
      }),
      withSliderConfig("combatEdgeSharpness", {
        label: "Combat Edge Sharpness",
        min: 0.5,
        max: 6,
        step: 0.1,
        title:
          "Controls how sharply combat power differences translate into win odds (0.5..6)",
        format: (v) => v.toFixed(2),
        getValue: () => this.combatEdgeSharpness,
        setValue: (v) => this.#updateSetting("combatEdgeSharpness", v),
        position: "beforeOverlays",
      }),
      withSliderConfig("lowDiversityReproMultiplier", {
        label: "Low Diversity Penalty ×",
        min: 0,
        max: 1,
        step: 0.05,
        title:
          "Multiplier applied to reproduction chance when diversity is below the threshold (0 disables births)",
        format: (v) => v.toFixed(2),
        getValue: () => this.lowDiversityReproMultiplier,
        setValue: (v) => this.#updateSetting("lowDiversityReproMultiplier", v),
        position: "beforeOverlays",
      }),
      withSliderConfig("speedMultiplier", {
        label: "Speed ×",
        min: 0.5,
        max: 100,
        step: 0.5,
        title: "Speed multiplier relative to 60 updates/sec (0.5x..100x)",
        format: (v) => `${v.toFixed(1)}x`,
        getValue: () => this.speedMultiplier,
        setValue: (v) => this.#updateSetting("speedMultiplier", v),
        position: "beforeOverlays",
      }),
    ];

    const insightConfigs = [
      withSliderConfig("leaderboardIntervalMs", {
        label: "Insights Refresh Interval",
        min: 100,
        max: 3000,
        step: 50,
        title:
          "Delay between updating evolution insights and leaderboard summaries in milliseconds (100..3000)",
        format: (v) => `${Math.round(v)} ms`,
        getValue: () => this.leaderboardIntervalMs,
        setValue: (v) => this.#updateSetting("leaderboardIntervalMs", v),
      }),
    ];

    createSectionHeading(body, "Similarity Thresholds");
    const thresholdsGroup = createControlGrid(body);

    thresholdConfigs.forEach((cfg) => renderSlider(cfg, thresholdsGroup));

    createSectionHeading(body, "Environmental Events");
    const eventsGroup = createControlGrid(body);

    eventConfigs.forEach((cfg) => renderSlider(cfg, eventsGroup));

    createSectionHeading(body, "General Settings");
    const generalGroup = createControlGrid(body);

    generalConfigs
      .filter((cfg) => cfg.position === "beforeOverlays")
      .forEach((cfg) => renderSlider(cfg, generalGroup));

    return {
      renderSlider,
      withSliderConfig,
      energyConfigs,
      generalConfigs,
      generalGroup,
      insightConfigs,
    };
  }

  #buildOverlayToggles(body) {
    createSectionHeading(body, "Overlays", { className: "overlay-header" });

    const overlayGrid = createControlGrid(body, "control-grid--compact");

    const overlayConfigs = [
      {
        key: "showObstacles",
        label: "Show Obstacles",
        title: "Highlight impassable tiles such as walls and barriers",
        initial: this.showObstacles,
      },
      {
        key: "showDensity",
        label: "Show Density Heatmap",
        title: "Overlay local population density as a heatmap",
        initial: this.showDensity,
      },
      {
        key: "showEnergy",
        label: "Show Energy Heatmap",
        title: "Overlay tile energy levels as a heatmap",
        initial: this.showEnergy,
      },
      {
        key: "showFitness",
        label: "Show Fitness Heatmap",
        title: "Overlay cell fitness as a heatmap",
        initial: this.showFitness,
      },
      {
        key: "showCelebrationAuras",
        label: "Celebration Glow",
        title:
          "Add a gentle aurora around the top-performing cells as a whimsical overlay",
        initial: this.showCelebrationAuras,
      },
    ];

    overlayConfigs.forEach(({ key, label, title, initial }) => {
      this.#addCheckbox(overlayGrid, label, title, initial, (checked) => {
        this.#updateSetting(key, checked);
      });
    });
  }

  #buildObstacleControls(body, sliderContext) {
    createSectionHeading(body, "Obstacles", { className: "overlay-header" });

    const obstacleGrid = createControlGrid(body, "control-grid--compact");

    if (this.obstaclePresets.length > 0) {
      const presetSelect = createSelectRow(obstacleGrid, {
        label: "Layout Preset",
        title: "Choose a static obstacle layout to apply immediately.",
        value: this.obstaclePreset,
        options: this.obstaclePresets.map((preset) => ({
          value: preset.id,
          label: preset.label,
          description: preset.description,
        })),
        onChange: (value) => {
          this.obstaclePreset = value;
        },
      });

      if (presetSelect?.options) {
        Array.from(presetSelect.options).forEach((opt) => {
          if (!opt.title && opt.textContent) opt.title = opt.textContent;
        });
      }

      const presetButtons = document.createElement("div");

      presetButtons.className = "control-line";
      const applyLayoutButton = document.createElement("button");

      applyLayoutButton.textContent = "Apply Layout";
      applyLayoutButton.title =
        "Replace the current obstacle mask with the selected preset.";
      applyLayoutButton.addEventListener("click", () => {
        const args = [this.obstaclePreset, { clearExisting: true }];

        if (typeof this.actions.applyObstaclePreset === "function")
          this.actions.applyObstaclePreset(...args);
        else if (window.grid?.applyObstaclePreset)
          window.grid.applyObstaclePreset(...args);
      });
      const clearButton = document.createElement("button");

      clearButton.textContent = "Clear Obstacles";
      clearButton.title = "Remove all obstacles from the grid.";
      clearButton.addEventListener("click", () => {
        const args = ["none", { clearExisting: true }];

        if (typeof this.actions.applyObstaclePreset === "function")
          this.actions.applyObstaclePreset(...args);
        else if (window.grid?.applyObstaclePreset)
          window.grid.applyObstaclePreset(...args);
      });
      presetButtons.appendChild(applyLayoutButton);
      presetButtons.appendChild(clearButton);
      obstacleGrid.appendChild(presetButtons);
    }
  }

  #buildReproductiveZoneTools(body) {
    if (!this.selectionManager) return;

    createSectionHeading(body, "Reproductive Zones", { className: "overlay-header" });

    const zoneGrid = createControlGrid(body, "control-grid--compact");
    const patterns = this.selectionManager.getPatterns();

    patterns.forEach((pattern) => {
      this.#addCheckbox(
        zoneGrid,
        pattern.name,
        pattern.description || "",
        pattern.active,
        (checked) => {
          this.selectionManager.togglePattern(pattern.id, checked);
          this.#updateZoneSummary();
          this.#scheduleUpdate();
        },
      );
    });

    const zoneButtons = createControlButtonRow(body);

    zoneButtons.setAttribute("role", "group");
    zoneButtons.setAttribute("aria-label", "Custom reproductive zone controls");

    this.drawZoneButton = document.createElement("button");
    this.drawZoneButton.textContent = "Draw Custom Zone";
    this.drawZoneButton.type = "button";
    this.drawZoneButton.title =
      "Enable drawing mode to sketch a custom reproductive zone on the canvas.";
    this.drawZoneButton.setAttribute("aria-pressed", "false");
    this.drawZoneButton.addEventListener("click", () => {
      this.#toggleRegionDrawing(!this.selectionDrawingEnabled);
    });
    zoneButtons.appendChild(this.drawZoneButton);

    const clearButton = document.createElement("button");

    clearButton.textContent = "Clear Custom Zones";
    clearButton.type = "button";
    clearButton.title = "No custom reproductive zones to clear.";
    clearButton.addEventListener("click", () => {
      this.selectionManager.clearCustomZones();
      this.#setDrawingEnabled(false);
      this.#updateZoneSummary();
      this.#scheduleUpdate();
      this.#updateCustomZoneButtons();
    });
    zoneButtons.appendChild(clearButton);
    this.clearZonesButton = clearButton;

    const summaryRow = this.#appendControlRow(body, {
      label: "Active Zones",
      value: this.selectionManager.describeActiveZones(),
      valueClass: "control-value--left control-hint",
    });

    this.zoneSummaryEl = summaryRow.querySelector(".control-value");
    if (this.zoneSummaryEl) {
      this.zoneSummaryEl.id = "zone-summary";
      this.zoneSummaryEl.setAttribute("role", "status");
      this.zoneSummaryEl.setAttribute("aria-live", "polite");
    }
    if (this.zoneSummaryEl) {
      zoneButtons.setAttribute("aria-describedby", "zone-summary");
      if (this.drawZoneButton) {
        this.drawZoneButton.setAttribute("aria-controls", "zone-summary");
      }
      clearButton.setAttribute("aria-controls", "zone-summary");
    }

    this.#updateZoneSummary();
  }

  #buildEnergyAndGeneralTail(body, sliderContext) {
    createSectionHeading(body, "Energy Dynamics");
    const energyGroup = createControlGrid(body);

    sliderContext.energyConfigs.forEach((cfg) =>
      sliderContext.renderSlider(cfg, energyGroup),
    );

    sliderContext.generalConfigs
      .filter((cfg) => cfg.position === "afterEnergy")
      .forEach((cfg) => sliderContext.renderSlider(cfg, sliderContext.generalGroup));
  }

  #buildInsightsPanel() {
    const { panel, body } = this.#createPanel("Evolution Insights", {
      collapsed: true,
    });

    const intro = document.createElement("p");

    intro.className = "metrics-intro";
    intro.textContent =
      "Track population health, energy, and behavioral trends as the simulation unfolds.";
    body.appendChild(intro);

    const sliderContext = this.sliderContext;

    if (sliderContext?.insightConfigs?.length) {
      const cadenceSection = document.createElement("section");

      cadenceSection.className = "metrics-section insight-cadence";
      const cadenceTitle = document.createElement("h4");

      cadenceTitle.className = "metrics-section-title";
      cadenceTitle.textContent = "Update Cadence";
      cadenceSection.appendChild(cadenceTitle);

      const cadenceBody = document.createElement("div");

      cadenceBody.className = "metrics-section-body";
      const cadenceGrid = createControlGrid(cadenceBody, "control-grid--compact");

      sliderContext.insightConfigs.forEach((cfg) => {
        sliderContext.renderSlider(cfg, cadenceGrid);
      });

      cadenceSection.appendChild(cadenceBody);
      body.appendChild(cadenceSection);
    }

    this.metricsBox = document.createElement("div");
    this.metricsBox.className = "metrics-box";
    this.metricsBox.setAttribute("role", "status");
    this.metricsBox.setAttribute("aria-live", "polite");
    this.#showMetricsPlaceholder("Run the simulation to populate these metrics.");
    body.appendChild(this.metricsBox);

    const sparkGrid = document.createElement("div");

    sparkGrid.className = "sparkline-grid";
    sparkGrid.setAttribute("role", "group");
    sparkGrid.setAttribute("aria-label", "Historical trend sparklines");
    body.appendChild(sparkGrid);

    // Sparklines canvases
    const traitDescriptors = [
      { key: "cooperation", name: "Cooperation" },
      { key: "fighting", name: "Fighting" },
      { key: "breeding", name: "Breeding" },
      { key: "sight", name: "Sight" },
    ];

    const traitSparkDescriptors = traitDescriptors.flatMap(({ key, name }) => [
      {
        label: `${name} Activity (presence %)`,
        property: `sparkTrait${name}Presence`,
        traitKey: key,
        traitType: "presence",
        color: "#f39c12",
      },
      {
        label: `${name} Intensity (avg level)`,
        property: `sparkTrait${name}Average`,
        traitKey: key,
        traitType: "average",
        color: "#3498db",
      },
    ]);

    const sparkDescriptors = [
      { label: "Population", property: "sparkPop", color: "#88d" },
      { label: "Diversity", property: "sparkDiv2Canvas", color: "#d88" },
      { label: "Mean Energy", property: "sparkEnergy", color: "#8d8" },
      { label: "Growth", property: "sparkGrowth", color: "#dd8" },
      { label: "Event Strength", property: "sparkEvent", color: "#b85" },
      { label: "Mutation Multiplier", property: "sparkMutation", color: "#6c5ce7" },
      {
        label: "Diverse Pairing Rate",
        property: "sparkDiversePairing",
        color: "#9b59b6",
      },
      {
        label: "Mean Diversity Appetite",
        property: "sparkDiversityAppetite",
        color: "#1abc9c",
      },
      ...traitSparkDescriptors,
    ];

    this.traitSparkDescriptors = traitSparkDescriptors;

    sparkDescriptors.forEach(({ label, property, color }) => {
      const card = document.createElement("div");
      const caption = document.createElement("div");
      const colorDot = document.createElement("span");
      const captionText = document.createElement("span");

      card.className = "sparkline-card";
      caption.className = "sparkline-caption";
      colorDot.className = "sparkline-color-dot";
      if (color) colorDot.style.background = color;
      captionText.className = "sparkline-caption-text";
      captionText.textContent = label;
      caption.appendChild(colorDot);
      caption.appendChild(captionText);

      const canvas = document.createElement("canvas");

      canvas.className = "sparkline";
      canvas.width = 220;
      canvas.height = 40;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `${label} trend over time`);

      card.appendChild(caption);
      card.appendChild(canvas);
      sparkGrid.appendChild(card);

      this[property] = canvas;
    });

    return panel;
  }

  #buildLifeEventsPanel() {
    const { panel, body } = this.#createPanel("Life Event Log", {
      collapsed: true,
    });

    const lifeEventsSection = document.createElement("section");

    lifeEventsSection.className = "metrics-section life-events";

    const lifeHeading = document.createElement("h4");

    lifeHeading.className = "metrics-section-title";
    lifeHeading.textContent = "Recent Activity";
    lifeEventsSection.appendChild(lifeHeading);

    const lifeBody = document.createElement("div");

    lifeBody.className = "metrics-section-body life-events-body";

    this.lifeEventsEmptyState = document.createElement("div");
    this.lifeEventsEmptyState.className = "life-event-empty";
    this.lifeEventsEmptyState.textContent =
      "Recent births and deaths will appear once the simulation runs.";
    lifeBody.appendChild(this.lifeEventsEmptyState);

    this.lifeEventList = document.createElement("ul");
    this.lifeEventList.className = "life-event-list";
    this.lifeEventList.setAttribute("role", "log");
    this.lifeEventList.setAttribute("aria-live", "polite");
    this.lifeEventList.setAttribute("aria-relevant", "additions");
    this.lifeEventList.hidden = true;
    lifeBody.appendChild(this.lifeEventList);

    lifeEventsSection.appendChild(lifeBody);
    body.appendChild(lifeEventsSection);

    return panel;
  }

  togglePause() {
    const toggler = this.simulationCallbacks?.togglePause;
    const nextPaused = typeof toggler === "function" ? toggler() : !this.paused;

    this.setPauseState(nextPaused);
    if (!nextPaused) this.#scheduleUpdate();
  }

  isPaused() {
    return this.paused;
  }

  setPauseState(paused) {
    this.paused = Boolean(paused);
    if (this.pauseButton) {
      this.pauseButton.textContent = this.paused ? "Resume" : "Pause";
    }
    if (this.stepButton) {
      this.stepButton.disabled = !this.paused;
      this.stepButton.title = this.paused
        ? "Advance one tick while paused to inspect changes frame-by-frame."
        : "Pause the simulation to enable single-step playback.";
    }
  }

  setAutoPauseOnBlur(enabled) {
    this.autoPauseOnBlur = Boolean(enabled);
    if (this.autoPauseCheckbox) {
      this.autoPauseCheckbox.checked = this.autoPauseOnBlur;
    }
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
  getShowCelebrationAuras() {
    return this.showCelebrationAuras;
  }
  getShowObstacles() {
    return this.showObstacles;
  }

  #showMetricsPlaceholder(message) {
    if (!this.metricsBox) return;
    if (!this.metricsPlaceholder) {
      this.metricsPlaceholder = document.createElement("div");
      this.metricsPlaceholder.className = "metrics-empty-state";
    }
    if (typeof message === "string" && message.length > 0) {
      this.metricsPlaceholder.textContent = message;
    }

    this.metricsBox.innerHTML = "";
    this.metricsBox.appendChild(this.metricsPlaceholder);
  }

  #hideMetricsPlaceholder() {
    if (this.metricsPlaceholder?.parentElement === this.metricsBox) {
      this.metricsPlaceholder.remove();
    }
  }

  renderMetrics(stats, snapshot, environment = {}) {
    if (!this.metricsBox) return;
    const hasSnapshotData =
      snapshot &&
      typeof snapshot === "object" &&
      Object.keys(snapshot).some((key) => snapshot[key] !== undefined);

    if (!hasSnapshotData) {
      this.#showMetricsPlaceholder("Run the simulation to populate these metrics.");

      return;
    }

    this.#hideMetricsPlaceholder();
    this.metricsBox.innerHTML = "";
    const s = snapshot || {};
    const totals = (stats && stats.totals) || {};
    const lastTotals = this._lastInteractionTotals || { fights: 0, cooperations: 0 };
    const fightDelta = Math.max(0, (totals.fights ?? 0) - (lastTotals.fights ?? 0));
    const coopDelta = Math.max(
      0,
      (totals.cooperations ?? 0) - (lastTotals.cooperations ?? 0),
    );
    const interactionTotal = fightDelta + coopDelta;

    const appendMetricRow = (container, { label, value, title, valueClass }) => {
      this.#appendControlRow(container, { label, value, title, valueClass });
    };

    const createSection = (title, options = {}) => {
      const { wide = false } = options;
      const section = document.createElement("section");

      section.className = "metrics-section";
      if (wide) section.classList.add("metrics-section--wide");
      const heading = document.createElement("h4");

      heading.className = "metrics-section-title";
      heading.textContent = title;
      section.appendChild(heading);
      const body = document.createElement("div");

      body.className = "metrics-section-body";
      section.appendChild(body);
      this.metricsBox.appendChild(section);

      return body;
    };

    const finiteOrDash = (value, formatter = String) =>
      Number.isFinite(value) ? formatter(value) : "—";
    const percentOrDash = (value) =>
      finiteOrDash(value, (v) => `${(v * 100).toFixed(0)}%`);
    const countOrDash = (value) => finiteOrDash(value);
    const fixedOrDash = (value, digits) =>
      finiteOrDash(value, (v) => v.toFixed(digits));
    const coverageOrNull = (ratio) => {
      if (!Number.isFinite(ratio)) return null;

      const clamped = clamp(ratio, 0, 1);

      return `${Math.round(clamped * 100)}% area`;
    };
    const secondsOrNull = (seconds) => {
      if (!Number.isFinite(seconds)) return null;

      const rounded = seconds >= 10 ? Math.round(seconds) : seconds.toFixed(1);

      return `${rounded}s left`;
    };
    const intensityOrNull = (value) => {
      if (!Number.isFinite(value)) return null;

      return `${value.toFixed(2)}× intensity`;
    };

    const eventMultiplier = Number.isFinite(environment?.eventStrengthMultiplier)
      ? environment.eventStrengthMultiplier
      : null;
    const activeEvents = Array.isArray(environment?.activeEvents)
      ? environment.activeEvents
      : [];

    this._lastInteractionTotals = {
      fights: totals.fights ?? lastTotals.fights ?? 0,
      cooperations: totals.cooperations ?? lastTotals.cooperations ?? 0,
    };

    const populationSection = createSection("Population Snapshot");

    appendMetricRow(populationSection, {
      label: "Population",
      value: countOrDash(s.population),
      title: "Total living cells",
    });
    appendMetricRow(populationSection, {
      label: "Births",
      value: countOrDash(s.births),
      title: "Births in the last tick",
    });
    appendMetricRow(populationSection, {
      label: "Deaths",
      value: countOrDash(s.deaths),
      title: "Deaths in the last tick",
    });
    appendMetricRow(populationSection, {
      label: "Growth",
      value: countOrDash(s.growth),
      title: "Births - Deaths",
    });
    if (typeof s.mutationMultiplier === "number") {
      const formatted = s.mutationMultiplier.toFixed(2);
      const suffix = s.mutationMultiplier <= 0 ? "× (off)" : "×";

      appendMetricRow(populationSection, {
        label: "Mutation Multiplier",
        value: `${formatted}${suffix}`,
        title: "Global multiplier applied to mutation chance and range for offspring",
      });
    }
    const interactionSection = createSection("Interaction Pulse");

    appendMetricRow(interactionSection, {
      label: "Skirmishes",
      value: countOrDash(fightDelta),
      title: "Skirmishes resolved since the last dashboard update",
    });
    appendMetricRow(interactionSection, {
      label: "Cooperations",
      value: countOrDash(coopDelta),
      title: "Mutual aid events completed since the last dashboard update",
    });
    appendMetricRow(interactionSection, {
      label: "Cooperation Share",
      value: interactionTotal ? percentOrDash(coopDelta / interactionTotal) : "—",
      title:
        "Share of cooperative interactions vs total interactions recorded for this update",
    });

    const vitalitySection = createSection("Vitality Signals");

    appendMetricRow(vitalitySection, {
      label: "Mean Energy",
      value: fixedOrDash(s.meanEnergy, 2),
      title: "Average energy per cell",
    });
    appendMetricRow(vitalitySection, {
      label: "Mean Age (ticks)",
      value: fixedOrDash(s.meanAge, 1),
      title: "Average age of living cells measured in simulation ticks.",
    });
    appendMetricRow(vitalitySection, {
      label: "Diversity",
      value: fixedOrDash(s.diversity, 3),
      title: "Estimated mean pairwise genetic distance",
    });

    const environmentSection = createSection("Environmental Events");

    appendMetricRow(environmentSection, {
      label: "Global Strength Multiplier",
      value:
        eventMultiplier == null
          ? "—"
          : `${eventMultiplier.toFixed(2)}×${eventMultiplier <= 0 ? " (off)" : ""}`,
      title: "Scales the impact of every active environmental event.",
    });

    if (activeEvents.length === 0) {
      appendMetricRow(environmentSection, {
        label: "Active Events",
        value: "Calm skies",
        title: "No environmental modifiers are currently affecting the grid.",
      });
    } else {
      activeEvents.forEach((event, index) => {
        const labelSuffix = activeEvents.length > 1 ? ` #${index + 1}` : "";
        const label = `${this.#formatEventTypeLabel(event?.type)}${labelSuffix}`;
        const details = [
          coverageOrNull(event?.coverageRatio),
          secondsOrNull(event?.remainingSeconds),
          intensityOrNull(event?.effectiveStrength ?? event?.strength),
        ].filter(Boolean);

        appendMetricRow(environmentSection, {
          label,
          value: details.length > 0 ? details.join(" · ") : "—",
          title: this.#describeEventSummary(event, eventMultiplier),
          valueClass: "control-value--left",
        });
      });
    }

    const reproductionSection = createSection("Reproduction Trends");

    if (typeof s.blockedMatings === "number") {
      appendMetricRow(reproductionSection, {
        label: "Blocked Matings",
        value: countOrDash(s.blockedMatings),
        title: "Matings prevented by reproductive zones this tick",
      });
    }

    if (s.lastBlockedReproduction?.reason) {
      appendMetricRow(reproductionSection, {
        label: "Last Blocked Reason",
        value: s.lastBlockedReproduction.reason,
        title: "Most recent reason reproduction was denied",
        valueClass: "control-value--left",
      });
    }

    const reproductionMetrics = [
      {
        label: "Mate Choices",
        value: countOrDash(s.mateChoices),
        title: "Potential mates evaluated by the population this tick",
      },
      {
        label: "Successful Matings",
        value: countOrDash(s.successfulMatings),
        title: "Pairs that successfully reproduced this tick",
      },
      {
        label: "Diverse Choice Rate",
        value: percentOrDash(s.diverseChoiceRate),
        title: "Share of mate choices favoring genetically diverse partners this tick",
      },
      {
        label: "Diverse Mating Rate",
        value: percentOrDash(s.diverseMatingRate),
        title: "Share of completed matings rated as genetically diverse this tick",
      },
      {
        label: "Mean Diversity Appetite",
        value: fixedOrDash(s.meanDiversityAppetite, 2),
        title: "Average preferred genetic difference when selecting a mate",
      },
      {
        label: "Curiosity Selections",
        value: countOrDash(s.curiositySelections),
        title: "Mate selections driven by curiosity-driven exploration this tick",
      },
    ];

    reproductionMetrics.forEach(({ label, value, title }) =>
      appendMetricRow(reproductionSection, { label, value, title }),
    );

    const traitPresence = stats?.traitPresence;
    const behaviorEvenness = Number.isFinite(s.behaviorEvenness)
      ? clamp01(s.behaviorEvenness)
      : null;

    if (traitPresence) {
      const traitSection = createSection("Trait Presence", { wide: true });
      const traitGroup = document.createElement("div");

      traitGroup.className = "metrics-group trait-metrics";

      const traitHeading = document.createElement("div");

      traitHeading.className = "metrics-group-title";
      traitHeading.textContent = "Traits";
      traitGroup.appendChild(traitHeading);

      const traitBody = document.createElement("div");

      traitBody.className = "trait-metrics-body";
      traitGroup.appendChild(traitBody);

      const hasPopulation = traitPresence.population > 0;
      const describeEvenness = (value) => {
        if (!Number.isFinite(value)) {
          return {
            label: "Unknown",
            description:
              "Run the simulation to measure how evenly traits are expressed.",
            color: "rgba(255,255,255,0.25)",
          };
        }

        if (value >= 0.8) {
          return {
            label: "Balanced",
            description: "Traits are evenly expressed across the population this tick.",
            color: "#2ecc71",
          };
        }

        if (value >= 0.55) {
          return {
            label: "Mixed",
            description:
              "Multiple strategies are active with a slight behavioral tilt.",
            color: "#f1c40f",
          };
        }

        return {
          label: "Dominant",
          description: "One or two strategies dominate the population this tick.",
          color: "#e74c3c",
        };
      };

      if (behaviorEvenness != null || hasPopulation) {
        const evennessValue =
          hasPopulation && behaviorEvenness != null ? behaviorEvenness : 0;
        const evennessMeta = describeEvenness(
          hasPopulation ? behaviorEvenness : Number.NaN,
        );
        const balanceCard = document.createElement("div");

        balanceCard.className = "trait-balance";
        if (!hasPopulation) {
          balanceCard.classList.add("trait-balance--empty");
        }
        balanceCard.title = `${evennessMeta.description} Normalized evenness ${(evennessValue * 100).toFixed(0)}%.`;

        const balanceHeader = document.createElement("div");

        balanceHeader.className = "trait-balance-header";
        const balanceLabel = document.createElement("span");

        balanceLabel.className = "trait-balance-label";
        balanceLabel.textContent = "Behavior Balance";
        balanceHeader.appendChild(balanceLabel);

        const balanceValue = document.createElement("span");

        balanceValue.className = "trait-balance-value";
        balanceValue.textContent = hasPopulation
          ? `${(evennessValue * 100).toFixed(0)}% ${evennessMeta.label}`
          : "No living cells";
        balanceHeader.appendChild(balanceValue);
        balanceCard.appendChild(balanceHeader);

        const balanceMeter = document.createElement("div");

        balanceMeter.className = "trait-balance-meter";
        balanceMeter.setAttribute("role", "meter");
        balanceMeter.setAttribute("aria-label", "Behavior balance across traits");
        balanceMeter.setAttribute("aria-valuemin", "0");
        balanceMeter.setAttribute("aria-valuemax", "1");
        balanceMeter.setAttribute(
          "aria-valuenow",
          hasPopulation ? evennessValue.toFixed(2) : "0",
        );
        balanceMeter.setAttribute(
          "aria-valuetext",
          hasPopulation
            ? `${(evennessValue * 100).toFixed(0)}% of behaviors are evenly distributed`
            : "No living cells to sample",
        );
        const balanceFill = document.createElement("div");

        balanceFill.className = "trait-balance-fill";
        balanceFill.style.width = `${(evennessValue * 100).toFixed(0)}%`;
        balanceFill.style.background = hasPopulation
          ? evennessMeta.color
          : "rgba(255,255,255,0.25)";
        balanceMeter.appendChild(balanceFill);
        balanceCard.appendChild(balanceMeter);

        const balanceSummary = document.createElement("p");

        balanceSummary.className = "trait-balance-summary";
        balanceSummary.textContent = hasPopulation
          ? evennessMeta.description
          : "Run the simulation to measure how evenly traits are expressed.";
        balanceCard.appendChild(balanceSummary);

        traitBody.appendChild(balanceCard);
      }

      if (hasPopulation) {
        const traitPalette = {
          cooperation: "#74b9ff",
          fighting: "#ff7675",
          breeding: "#f39c12",
          sight: "#55efc4",
        };
        const traitConfigs = [
          { key: "cooperation", label: "Cooperation" },
          { key: "fighting", label: "Fighting" },
          { key: "breeding", label: "Breeding" },
          { key: "sight", label: "Sight" },
        ];
        const traitList = document.createElement("ul");

        traitList.className = "trait-bar-list";
        traitList.setAttribute("role", "list");

        for (let i = 0; i < traitConfigs.length; i++) {
          const trait = traitConfigs[i];
          const countRaw = traitPresence.counts?.[trait.key] ?? 0;
          const fractionRaw = traitPresence.fractions?.[trait.key] ?? 0;
          const count = Number.isFinite(countRaw) ? countRaw : 0;
          const fraction = clamp01(Number.isFinite(fractionRaw) ? fractionRaw : 0);
          const percentText = `${(fraction * 100).toFixed(0)}%`;
          const countText = count.toLocaleString();
          const tooltipBase =
            "Active cells have a normalized value ≥ 60% for this trait.";
          const item = document.createElement("li");

          item.className = "trait-bar-item";

          const header = document.createElement("div");

          header.className = "trait-bar-header";
          const labelEl = document.createElement("span");

          labelEl.className = "trait-bar-label";
          labelEl.textContent = trait.label;
          header.appendChild(labelEl);

          const valueEl = document.createElement("span");

          valueEl.className = "trait-bar-value";
          valueEl.textContent = `${countText} cells (${percentText})`;
          header.appendChild(valueEl);

          item.appendChild(header);

          const meter = document.createElement("div");

          meter.className = "trait-bar-meter";
          meter.setAttribute("role", "meter");
          meter.setAttribute("aria-label", `${trait.label} presence`);
          meter.setAttribute("aria-valuemin", "0");
          meter.setAttribute("aria-valuemax", "1");
          meter.setAttribute("aria-valuenow", fraction.toFixed(2));
          meter.setAttribute(
            "aria-valuetext",
            `${percentText} of living cells show high ${trait.label.toLowerCase()}`,
          );
          meter.title = `${tooltipBase} ${percentText} of the population exceeds the threshold.`;

          const fill = document.createElement("div");

          fill.className = "trait-bar-fill";
          fill.style.width = `${(fraction * 100).toFixed(0)}%`;
          fill.style.background = traitPalette[trait.key] || "#74b9ff";
          meter.appendChild(fill);

          item.appendChild(meter);
          traitList.appendChild(item);
        }

        traitBody.appendChild(traitList);
      } else {
        const emptyState = document.createElement("p");

        emptyState.className = "trait-empty-state";
        emptyState.textContent = "No living cells to sample for trait presence yet.";
        traitBody.appendChild(emptyState);
      }

      traitSection.appendChild(traitGroup);
    }

    this.#renderLifeEvents(stats);

    this.drawSpark(this.sparkPop, stats.history.population, "#88d");
    this.drawSpark(this.sparkDiv2Canvas, stats.history.diversity, "#d88");
    this.drawSpark(this.sparkEnergy, stats.history.energy, "#8d8");
    this.drawSpark(this.sparkGrowth, stats.history.growth, "#dd8");
    this.drawSpark(this.sparkEvent, stats.history.eventStrength, "#b85");
    this.drawSpark(this.sparkMutation, stats.history.mutationMultiplier, "#6c5ce7");
    this.drawSpark(
      this.sparkDiversePairing,
      stats.history.diversePairingRate,
      "#9b59b6",
    );
    this.drawSpark(
      this.sparkDiversityAppetite,
      stats.history.meanDiversityAppetite,
      "#1abc9c",
    );

    if (Array.isArray(this.traitSparkDescriptors)) {
      this.traitSparkDescriptors.forEach(({ property, traitKey, traitType, color }) => {
        const canvas = this[property];
        const data = stats?.traitHistory?.[traitType]?.[traitKey];

        this.drawSpark(canvas, Array.isArray(data) ? data : [], color);
      });
    }
  }

  drawSpark(canvas, data, color = "#88d") {
    if (!canvas) return;
    const series = Array.isArray(data) ? data : [];
    const ctx = canvas.getContext("2d");
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
      const { panel, body } = this.#createPanel("Leaderboard", { collapsed: true });

      panel.classList.add("leaderboard-panel");
      this.dashboardGrid?.appendChild(panel);
      this.leaderPanel = panel;
      this.leaderBody = body;
    }

    const entries = Array.isArray(top) ? top.filter(Boolean) : [];

    this.leaderBody.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");

      empty.className = "leaderboard-empty-state";
      empty.textContent = "Run the simulation to populate the leaderboard.";
      this.leaderBody.appendChild(empty);

      return;
    }

    const formatFloat = (value) => (Number.isFinite(value) ? value.toFixed(2) : "—");
    const formatCount = (value) =>
      Number.isFinite(value) ? value.toLocaleString() : "—";

    entries.forEach((entry, index) => {
      const summaryFitness = Number.isFinite(entry.fitness)
        ? entry.fitness
        : Number.NaN;
      const brain = entry.brain ?? {};
      const card = document.createElement("article");

      card.className = "leaderboard-entry";
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `Rank ${index + 1} organism performance`);

      const swatchColor =
        typeof entry.color === "string" && entry.color.trim().length > 0
          ? entry.color
          : null;

      if (swatchColor) {
        card.style.setProperty("--leaderboard-entry-color", swatchColor);
      }

      const header = document.createElement("div");

      header.className = "leaderboard-entry-header";

      const rank = document.createElement("span");

      rank.className = "leaderboard-rank";
      rank.textContent = `#${index + 1}`;
      header.appendChild(rank);

      if (swatchColor) {
        const colorDot = document.createElement("span");

        colorDot.className = "leaderboard-color";
        colorDot.style.background = swatchColor;
        colorDot.setAttribute("aria-hidden", "true");
        header.appendChild(colorDot);
      }

      const summary = document.createElement("div");

      summary.className = "leaderboard-summary";

      const summaryLabel = document.createElement("span");

      summaryLabel.className = "leaderboard-summary-label";
      summaryLabel.textContent = "Fitness";
      summary.appendChild(summaryLabel);

      const summaryValue = document.createElement("span");

      summaryValue.className = "leaderboard-summary-value";
      summaryValue.textContent = formatFloat(summaryFitness);
      summary.appendChild(summaryValue);

      header.appendChild(summary);
      card.appendChild(header);

      const statsContainer = document.createElement("div");

      statsContainer.className = "leaderboard-stats";

      const detailRows = [];

      detailRows.push(
        { label: "Brain Fitness", value: formatFloat(brain.fitness) },
        { label: "Neurons", value: formatCount(brain.neuronCount) },
        { label: "Connections", value: formatCount(brain.connectionCount) },
        { label: "Offspring", value: formatCount(entry.offspring) },
        { label: "Fights Won", value: formatCount(entry.fightsWon) },
        { label: "Age (ticks)", value: formatCount(entry.age) },
      );

      detailRows.forEach(({ label, value }) => {
        const statRow = document.createElement("div");

        statRow.className = "leaderboard-stat";

        const statLabelEl = document.createElement("span");

        statLabelEl.className = "leaderboard-stat-label";
        statLabelEl.textContent = label;

        const statValueEl = document.createElement("span");

        statValueEl.className = "leaderboard-stat-value";
        statValueEl.textContent = value;

        statRow.appendChild(statLabelEl);
        statRow.appendChild(statValueEl);
        statsContainer.appendChild(statRow);
      });

      const tooltipParts = [
        `${summaryLabel.textContent} ${formatFloat(summaryFitness)}`,
        `Brain ${formatFloat(brain.fitness)}`,
        `Neurons ${formatCount(brain.neuronCount)}`,
        `Connections ${formatCount(brain.connectionCount)}`,
        `Offspring ${formatCount(entry.offspring)}`,
        `Fights ${formatCount(entry.fightsWon)}`,
        `Age ${formatCount(entry.age)} ticks`,
      ];

      card.title = tooltipParts.join(" | ");
      card.appendChild(statsContainer);
      this.leaderBody.appendChild(card);
    });
  }
}
