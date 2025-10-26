import { resolveSimulationDefaults, SIMULATION_DEFAULTS } from "../config.js";
import { UI_SLIDER_CONFIG } from "./sliderConfig.js";
import {
  createControlButtonRow,
  createControlGrid,
  createNumberInputRow,
  createSectionHeading,
  createSelectRow,
  createSliderRow,
} from "./controlBuilders.js";
import {
  clamp,
  clamp01,
  pickFirstFinitePositive,
  sanitizeNumber,
} from "../utils/math.js";
import { coerceBoolean } from "../utils/primitives.js";
import { toPlainObject } from "../utils/object.js";
import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

const AUTO_PAUSE_DESCRIPTION =
  "Automatically pause the simulation when the tab or window loses focus, resuming when you return.";

const LIFE_EVENT_MARKER_OVERLAY_DESCRIPTION =
  "Pinpoint recent births and deaths directly on the grid with fading markers.";

const GRID_GEOMETRY_BOUNDS = Object.freeze({
  cellSize: Object.freeze({ min: 2, max: 20, step: 1 }),
  rows: Object.freeze({ min: 40, max: 240, step: 1 }),
  cols: Object.freeze({ min: 40, max: 240, step: 1 }),
});

const DEATH_CAUSE_COLOR_MAP = Object.freeze({
  starvation: "#f6c344",
  combat: "#ff6b6b",
  senescence: "#a0aec0",
  reproduction: "#ff9f43",
  obstacle: "#74b9ff",
  seed: "#a29bfe",
  "energy-collapse": "#45aaf2",
  unknown: "#e74c3c",
});

// Default number of death causes surfaced before collapsing the remainder into
// an "Other" bucket. Consumers can override via `ui.layout.deathBreakdownMaxEntries`.
const DEFAULT_DEATH_BREAKDOWN_MAX_ENTRIES = 4;
const DEATH_BREAKDOWN_OTHER_COLOR = "rgba(255, 255, 255, 0.28)";

const LIFE_EVENT_TIMELINE_DEFAULT_WINDOW = 120;
const LIFE_EVENT_TIMELINE_TARGET_BUCKETS = 12;
const LIFE_EVENT_TIMELINE_MIN_BUCKET_SIZE = 4;
const LIFE_EVENT_TIMELINE_CANVAS = Object.freeze({
  width: 320,
  height: 96,
});
const LIFE_EVENT_TIMELINE_EMPTY_MESSAGE =
  "Run the simulation to chart birth and death cadence.";

const DEFAULT_BURST_OPTIONS = Object.freeze({
  primary: Object.freeze({
    count: 200,
    radius: 6,
  }),
  shift: Object.freeze({
    count: 400,
    radius: 9,
    hint: "Hold Shift for a stronger burst.",
    shortcutHint:
      "Hold Shift for a stronger burst, whether clicking or using the shortcut.",
  }),
});

const DEFAULT_TRAIT_DISPLAY_CONFIG = Object.freeze({
  cooperation: Object.freeze({
    name: "Cooperation",
    colors: Object.freeze({
      presence: Object.freeze({
        colorVar: "--color-trait-cooperation-presence",
        fallbackColor: "#74b9ff",
      }),
      intensity: Object.freeze({
        colorVar: "--color-trait-cooperation-intensity",
        fallbackColor: "#a0c4ff",
      }),
    }),
  }),
  fighting: Object.freeze({
    name: "Fighting",
    colors: Object.freeze({
      presence: Object.freeze({
        colorVar: "--color-trait-fighting-presence",
        fallbackColor: "#ff7675",
      }),
      intensity: Object.freeze({
        colorVar: "--color-trait-fighting-intensity",
        fallbackColor: "#ff9aa2",
      }),
    }),
  }),
  breeding: Object.freeze({
    name: "Breeding",
    colors: Object.freeze({
      presence: Object.freeze({
        colorVar: "--color-trait-breeding-presence",
        fallbackColor: "#f6c177",
      }),
      intensity: Object.freeze({
        colorVar: "--color-trait-breeding-intensity",
        fallbackColor: "#fcd29f",
      }),
    }),
  }),
  sight: Object.freeze({
    name: "Sight",
    colors: Object.freeze({
      presence: Object.freeze({
        colorVar: "--color-trait-sight-presence",
        fallbackColor: "#55efc4",
      }),
      intensity: Object.freeze({
        colorVar: "--color-trait-sight-intensity",
        fallbackColor: "#81f4d0",
      }),
    }),
  }),
});

function toPascalCase(value) {
  if (typeof value !== "string" || value.length === 0) return "";

  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function formatTraitLabel(key) {
  if (typeof key !== "string" || key.length === 0) {
    return "Trait";
  }

  const cleaned = key.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();

  if (cleaned.length === 0) {
    return "Trait";
  }

  return cleaned.replace(/\b(\w)/g, (match) => match.toUpperCase());
}

function normalizeBurstOptions(candidate) {
  const { primary: rawPrimary, shift: rawShift } = toPlainObject(candidate);
  const primarySource = toPlainObject(rawPrimary);
  const shiftSource = toPlainObject(rawShift);
  const fallbackPrimary = DEFAULT_BURST_OPTIONS.primary;
  const fallbackShift = DEFAULT_BURST_OPTIONS.shift;

  const parseCount = (value, fallback) => {
    const candidate = pickFirstFinitePositive([value]);

    if (candidate == null) {
      return fallback;
    }

    return Math.round(candidate);
  };

  const parseRadius = (value, fallback) => {
    return pickFirstFinitePositive([value], fallback) ?? fallback;
  };

  const resolveHint = (value, fallback) => {
    if (typeof value !== "string") {
      return fallback;
    }

    const trimmed = value.trim();

    return trimmed.length > 0 ? trimmed : fallback;
  };

  return {
    primary: {
      count: parseCount(primarySource.count, fallbackPrimary.count),
      radius: parseRadius(primarySource.radius, fallbackPrimary.radius),
    },
    shift: {
      count: parseCount(shiftSource.count, fallbackShift.count),
      radius: parseRadius(shiftSource.radius, fallbackShift.radius),
      hint: resolveHint(shiftSource.hint, fallbackShift.hint),
      shortcutHint: resolveHint(shiftSource.shortcutHint, fallbackShift.shortcutHint),
    },
  };
}

function generateTraitColors(key) {
  if (typeof key !== "string" || key.length === 0) {
    return {
      presence: "#7f8cff",
      intensity: "#a3aefc",
    };
  }

  let hash = 0;

  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }

  const hue = Math.abs(hash) % 360;

  return {
    presence: `hsl(${hue}, 65%, 62%)`,
    intensity: `hsl(${(hue + 18) % 360}, 65%, 74%)`,
  };
}

function resolveTraitDisplayConfigs(stats) {
  const definitions = Array.isArray(stats?.traitDefinitions)
    ? stats.traitDefinitions
    : null;
  const defaultKeys = Object.keys(DEFAULT_TRAIT_DISPLAY_CONFIG);
  const sourceDefinitions =
    definitions && definitions.length > 0
      ? definitions
      : defaultKeys.map((key) => ({ key }));
  const seen = new Set();

  return sourceDefinitions
    .map((definition) =>
      typeof definition?.key === "string" ? definition.key.trim() : "",
    )
    .filter((key) => {
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);

      return true;
    })
    .map((key) => {
      const base = DEFAULT_TRAIT_DISPLAY_CONFIG[key];

      if (base) {
        return {
          key,
          label: base.name,
          colors: base.colors,
        };
      }

      const generated = generateTraitColors(key);

      return {
        key,
        label: formatTraitLabel(key),
        colors: {
          presence: { colorVar: null, fallbackColor: generated.presence },
          intensity: { colorVar: null, fallbackColor: generated.intensity },
        },
      };
    });
}

/**
 * Formats numeric values that may occasionally be non-finite. When the value
 * fails the finite check the provided fallback is returned instead.
 *
 * @param {number} value - Candidate number to format.
 * @param {(value:number) => any} formatter - Function applied to valid inputs.
 * @param {any} [fallback=null] - Value to return for non-finite input.
 * @returns {any} Either the formatted value or the fallback.
 */
function formatIfFinite(value, formatter, fallback = null) {
  if (!Number.isFinite(value)) return fallback;

  const safeFormatter = typeof formatter === "function" ? formatter : (v) => v;

  return safeFormatter(value);
}

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
    const { initialSettings: initialSettingsOverrides, ...layoutConfig } =
      normalizedLayout;
    const initialSettings = toPlainObject(initialSettingsOverrides);
    const { obstaclePresets = [], ...actionFns } = normalizedActions;
    const selectionManagerOption = normalizedActions.selectionManager;
    const getCellSizeFn = normalizedActions.getCellSize;
    const getDimensionsFn = normalizedActions.getGridDimensions;
    const setGeometryFn = normalizedActions.setWorldGeometry;

    const defaults = resolveSimulationDefaults(initialSettings);

    this._defaultSettings = Object.freeze({ ...defaults });

    this.simulationCallbacks = normalizedCallbacks;
    this.actions = actionFns;
    this.obstaclePresets = Array.isArray(obstaclePresets) ? obstaclePresets : [];
    this.paused = Boolean(defaults.paused);
    this.selectionManager = selectionManagerOption ?? null;
    this.getCellSize =
      typeof getCellSizeFn === "function"
        ? getCellSizeFn.bind(normalizedActions)
        : () => 1;
    this.getGridDimensions =
      typeof getDimensionsFn === "function"
        ? getDimensionsFn.bind(normalizedActions)
        : null;
    this.setWorldGeometry =
      typeof setGeometryFn === "function"
        ? setGeometryFn.bind(normalizedActions)
        : null;
    this.canvasElement = null;
    this.zoneSummaryEl = null;
    this.zoneSummaryTextEl = null;
    this.zoneSummaryList = null;
    this._checkboxIdSequence = 0;
    this.stepButton = null;
    this.burstButton = null;
    this.resetWorldButton = null;
    this.resetWorldBusy = false;
    this.resetWorldButtonDefaults = null;
    this._documentKeydownListener = null;
    this.metricsPlaceholder = null;
    this._sliderInputs = new Map();
    this.lifeEventList = null;
    this.lifeEventsEmptyState = null;
    this.lifeEventsSummary = null;
    this.lifeEventsSummaryBirthItem = null;
    this.lifeEventsSummaryDeathItem = null;
    this.lifeEventsSummaryBirthCount = null;
    this.lifeEventsSummaryDeathCount = null;
    this.lifeEventMarkersToggle = null;
    this.lifeEventsSummaryTrend = null;
    this.lifeEventsSummaryNet = null;
    this.lifeEventsSummaryDirection = null;
    this.lifeEventsSummaryRate = null;
    this.lifeEventsTimelineCard = null;
    this.lifeEventsTimelineCanvas = null;
    this.lifeEventsTimelineSummary = null;
    this.lifeEventsTimelineSummaryMessage = null;
    this.lifeEventsTimelineStats = null;
    this.lifeEventsTimelineWindowStat = null;
    this.lifeEventsTimelineBirthStat = null;
    this.lifeEventsTimelineDeathStat = null;
    this.lifeEventsTimelineEmptyState = null;
    this._pendingMetrics = null;
    this._pendingLeaderboardEntries = null;
    this._pendingLifeEventsStats = null;
    this.deathBreakdownList = null;
    this.deathBreakdownEmptyState = null;
    this.sparkMetricDescriptors = [];
    this.traitSparkDescriptors = [];
    this._traitSparkKeys = null;
    this.traitSparkGrid = null;
    this.playbackSpeedSlider = null;
    this.speedPresetButtons = [];
    this.dashboardSettingsPanel = null;
    this.dashboardCadenceSlider = null;
    this.leaderboardCadenceConfig = null;
    this.pauseOverlay = null;
    this.pauseOverlayTitle = null;
    this.pauseOverlayHint = null;
    this.pauseOverlayAutopause = null;
    this.leaderBody = null;
    this.leaderEntriesContainer = null;
    this.stepHotkeySet = new Set();
    this.geometryControls = null;
    this.deathBreakdownMaxEntries = this.#resolveDeathBreakdownLimit(
      layoutConfig.deathBreakdownMaxEntries,
    );
    this.burstConfig = normalizeBurstOptions(layoutConfig.burstOptions);

    const initialDimensions = this.#readGridDimensions();

    this.gridRows = initialDimensions.rows;
    this.gridCols = initialDimensions.cols;
    this.currentCellSize = Math.max(1, this.getCellSize());

    // Settings with sensible defaults
    this.societySimilarity = defaults.societySimilarity;
    this.enemySimilarity = defaults.enemySimilarity;
    this.eventStrengthMultiplier = defaults.eventStrengthMultiplier;
    this.eventFrequencyMultiplier = defaults.eventFrequencyMultiplier;
    this.speedMultiplier = defaults.speedMultiplier;
    const baseUpdatesCandidate =
      Number.isFinite(this.speedMultiplier) && this.speedMultiplier > 0
        ? defaults.updatesPerSecond / this.speedMultiplier
        : defaults.updatesPerSecond;
    const fallbackBase =
      Number.isFinite(defaults.updatesPerSecond) && defaults.updatesPerSecond > 0
        ? defaults.updatesPerSecond
        : SIMULATION_DEFAULTS.updatesPerSecond;
    const resolvedBase =
      Number.isFinite(baseUpdatesCandidate) && baseUpdatesCandidate > 0
        ? baseUpdatesCandidate
        : fallbackBase;

    this.baseUpdatesPerSecond = resolvedBase;
    this.densityEffectMultiplier = defaults.densityEffectMultiplier;
    this.mutationMultiplier = defaults.mutationMultiplier;
    this.combatEdgeSharpness = defaults.combatEdgeSharpness;
    this.combatTerritoryEdgeFactor = defaults.combatTerritoryEdgeFactor;
    this.matingDiversityThreshold = defaults.matingDiversityThreshold;
    this.lowDiversityReproMultiplier = defaults.lowDiversityReproMultiplier;
    this.lowDiversitySlider = null;
    this.initialTileEnergyFraction = defaults.initialTileEnergyFraction;
    this.initialTileEnergySlider = null;
    this.energyRegenRate = defaults.energyRegenRate; // base logistic regen rate (0..0.2)
    this.energyDiffusionRate = defaults.energyDiffusionRate; // neighbor diffusion rate (0..0.5)
    this.leaderboardIntervalMs = defaults.leaderboardIntervalMs;
    this._lastSlowUiRender = Number.NEGATIVE_INFINITY; // shared throttle for fast-updating UI bits
    this._lastInteractionTotals = { fights: 0, cooperations: 0 };
    this.simulationClock = {
      ticks: 0,
      elapsedSeconds: 0,
      lastUpdatesPerSecond: this.getUpdatesPerSecond(),
    };
    this.showDensity = defaults.showDensity;
    this.showEnergy = defaults.showEnergy;
    this.showFitness = defaults.showFitness;
    this.showObstacles = defaults.showObstacles;
    this.showLifeEventMarkers = defaults.showLifeEventMarkers;
    this.showAuroraVeil = defaults.showAuroraVeil;
    this.showReproductiveZones =
      defaults.showReproductiveZones !== undefined
        ? defaults.showReproductiveZones
        : true;
    this.autoPauseOnBlur = defaults.autoPauseOnBlur;
    this.autoPausePending = false;
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
    this.#installPauseIndicator();
    this.mainRow.appendChild(this.sidebar);

    // Allow callers to customize which keys toggle the pause state or step once.
    this.pauseHotkeySet = this.#resolveHotkeySet(layoutConfig.pauseHotkeys, ["p", " "]);
    this.stepHotkeySet = this.#resolveHotkeySet(layoutConfig.stepHotkeys, ["s"]);
    this.speedIncreaseHotkeySet = this.#resolveHotkeySet(
      layoutConfig.speedIncreaseHotkeys,
      ["]", "="],
    );
    this.speedDecreaseHotkeySet = this.#resolveHotkeySet(
      layoutConfig.speedDecreaseHotkeys,
      ["[", "-"],
    );
    this.speedResetHotkeySet = this.#resolveHotkeySet(layoutConfig.speedResetHotkeys, [
      "0",
    ]);
    this.burstHotkeySet = this.#resolveHotkeySet(layoutConfig.burstHotkeys, ["b"]);

    const canvasEl =
      layoutConfig.canvasElement || this.#resolveNode(layoutConfig.canvasSelector);
    const anchorNode =
      this.#resolveNode(layoutConfig.before) ||
      this.#resolveNode(layoutConfig.insertBefore);

    if (canvasEl) {
      this.attachCanvas(canvasEl, { before: anchorNode });
    } else {
      this.#ensureMainRowMounted(anchorNode);
    }
    this.controlsPanel = this.#buildControlsPanel();
    this.dashboardSettingsPanel = this.#buildDashboardSettingsPanel();
    this.insightsPanel = this.#buildInsightsPanel();
    this.lifeEventsPanel = this.#buildLifeEventsPanel();
    this.dashboardGrid.appendChild(this.controlsPanel);
    if (this.dashboardSettingsPanel) {
      this.dashboardGrid.appendChild(this.dashboardSettingsPanel);
    }
    this.dashboardGrid.appendChild(this.insightsPanel);
    this.dashboardGrid.appendChild(this.lifeEventsPanel);

    // Keyboard toggle
    if (document?.addEventListener) {
      this._documentKeydownListener = (event) => {
        this.#handleDocumentKeydown(event);
      };
      document.addEventListener("keydown", this._documentKeydownListener);
    }
  }

  #normalizeHotkeyValue(value) {
    if (typeof value !== "string") return "";
    if (value === " ") return " ";

    const trimmed = value.trim().toLowerCase();

    if (!trimmed) return "";

    switch (trimmed) {
      case "space":
      case "spacebar":
        return " ";
      default:
        break;
    }

    const aliasMap = {
      "{": "[",
      "}": "]",
      "+": "=",
      _: "-",
      ")": "0",
    };
    const normalized = aliasMap[trimmed] ?? trimmed;

    if (normalized.length === 1) {
      return normalized;
    }

    return normalized.replace(/[-_\s]+/g, "");
  }

  #handleDocumentKeydown(event) {
    if (!event?.key) return;
    if (this.#shouldIgnoreHotkey(event)) return;

    const key = this.#normalizeHotkeyValue(event.key);

    if (!key) return;

    if (this.pauseHotkeySet.has(key)) {
      event.preventDefault();
      this.togglePause();

      return;
    }

    if (this.stepHotkeySet.has(key)) {
      event.preventDefault();

      if (this.paused) {
        this.#executeStep();
      } else {
        const nowPaused = this.togglePause();

        if (nowPaused) {
          this.#executeStep();
        }
      }

      return;
    }

    if (this.burstHotkeySet?.has(key)) {
      event.preventDefault();
      this.#triggerBurst({ shiftKey: event.shiftKey });

      return;
    }

    if (this.speedIncreaseHotkeySet.has(key)) {
      event.preventDefault();
      const steps = event.shiftKey ? 5 : 1;

      this.#bumpSpeedMultiplier(steps);

      return;
    }

    if (this.speedDecreaseHotkeySet.has(key)) {
      event.preventDefault();
      const steps = event.shiftKey ? 5 : 1;

      this.#bumpSpeedMultiplier(-steps);

      return;
    }

    if (this.speedResetHotkeySet.has(key)) {
      event.preventDefault();
      this.#resetSpeedMultiplier();
    }
  }

  #triggerBurst(options = {}) {
    const shiftKey = Boolean(options?.shiftKey);
    const burstPreset = shiftKey ? this.burstConfig.shift : this.burstConfig.primary;
    const burstOptions = {
      count: burstPreset.count,
      radius: burstPreset.radius,
    };

    if (typeof this.actions.burst === "function") {
      try {
        this.actions.burst(burstOptions);
      } catch (error) {
        warnOnce("Burst action handler threw.", error);
      }

      return;
    }

    if (typeof window === "undefined") return;

    try {
      if (window.grid?.burstRandomCells) {
        window.grid.burstRandomCells(burstOptions);
      }
    } catch (error) {
      warnOnce("Global burst handler threw.", error);
    }
  }

  #resolveHotkeySet(candidate, fallbackKeys = ["p"]) {
    const fallbackList = Array.isArray(fallbackKeys)
      ? fallbackKeys
      : typeof fallbackKeys === "string" && fallbackKeys.length > 0
        ? [fallbackKeys]
        : ["p"];

    const normalizedFallback = fallbackList
      .map((value) => this.#normalizeHotkeyValue(value))
      .filter((value) => value.length > 0);

    if (normalizedFallback.length === 0) {
      normalizedFallback.push("p");
    }

    const values = Array.isArray(candidate)
      ? candidate
      : typeof candidate === "string" && candidate.length > 0
        ? [candidate]
        : fallbackList;

    const normalized = values
      .map((value) => this.#normalizeHotkeyValue(value))
      .filter((value) => value.length > 0);

    return new Set(normalized.length > 0 ? normalized : normalizedFallback);
  }

  #resolveBurstHint({ includeShortcut = false } = {}) {
    const shiftConfig = this.burstConfig?.shift ?? DEFAULT_BURST_OPTIONS.shift;
    const fallback = includeShortcut
      ? DEFAULT_BURST_OPTIONS.shift.shortcutHint
      : DEFAULT_BURST_OPTIONS.shift.hint;
    const hint = includeShortcut ? shiftConfig.shortcutHint : shiftConfig.hint;

    if (typeof hint === "string" && hint.length > 0) {
      return hint;
    }

    return fallback;
  }

  #resolveDeathBreakdownLimit(candidate) {
    const numeric = Number(candidate);

    if (!Number.isFinite(numeric)) {
      return DEFAULT_DEATH_BREAKDOWN_MAX_ENTRIES;
    }

    const floored = Math.floor(numeric);

    return floored > 0 ? floored : DEFAULT_DEATH_BREAKDOWN_MAX_ENTRIES;
  }

  #resolveCssColor(variableName, fallbackColor) {
    if (typeof variableName !== "string" || variableName.length === 0) {
      return fallbackColor;
    }

    try {
      const root = document?.documentElement;

      if (!root) return fallbackColor;

      const value = getComputedStyle(root).getPropertyValue(variableName).trim();

      return value || fallbackColor;
    } catch (error) {
      warnOnce("Failed to resolve CSS variable color", error);

      return fallbackColor;
    }
  }

  #shouldIgnoreHotkey(event) {
    if (!event || event.defaultPrevented) return true;
    if (event.ctrlKey || event.metaKey || event.altKey) return true;

    const target = event.target;

    if (!target) return false;
    if (target.isContentEditable) return true;

    const tagName =
      typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";

    return (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      tagName === "button"
    );
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

  #pickRandomObstaclePresetId() {
    if (!Array.isArray(this.obstaclePresets) || this.obstaclePresets.length === 0) {
      return null;
    }

    const validPresets = this.obstaclePresets.filter((preset) => preset?.id);

    if (validPresets.length === 0) return null;

    const obstacleCandidates = validPresets.filter((preset) => preset.id !== "none");
    const pool = obstacleCandidates.length > 0 ? obstacleCandidates : validPresets;

    if (pool.length === 0) return null;

    const index = Math.floor(Math.random() * pool.length);

    return pool[index]?.id ?? null;
  }

  #readGridDimensions() {
    const fallback = { rows: 120, cols: 120, cellSize: this.getCellSize?.() ?? 5 };
    let dimensions = null;

    if (typeof this.getGridDimensions === "function") {
      try {
        const raw = toPlainObject(this.getGridDimensions());

        dimensions = {
          rows: Number(raw?.rows),
          cols: Number(raw?.cols),
          cellSize: Number(raw?.cellSize ?? fallback.cellSize),
        };
      } catch (error) {
        warnOnce("Failed to read grid dimensions from actions.", error);
      }
    }

    if (
      !dimensions ||
      !Number.isFinite(dimensions.rows) ||
      !Number.isFinite(dimensions.cols)
    ) {
      const globalRef = typeof window !== "undefined" ? window : globalThis;
      const grid = globalRef?.grid;
      const engine = globalRef?.simulationEngine;
      const rows = Number.isFinite(grid?.rows)
        ? grid.rows
        : Number.isFinite(engine?.rows)
          ? engine.rows
          : fallback.rows;
      const cols = Number.isFinite(grid?.cols)
        ? grid.cols
        : Number.isFinite(engine?.cols)
          ? engine.cols
          : fallback.cols;

      dimensions = { rows, cols, cellSize: fallback.cellSize };
    }

    return this.#normalizeGeometryValues(dimensions, fallback, {
      clampToBounds: false,
    });
  }

  #normalizeGeometryValues(candidate = {}, fallback = {}, options = {}) {
    const { clampToBounds = true } = options ?? {};
    const bounds = GRID_GEOMETRY_BOUNDS;
    const baseCellSize = Number.isFinite(candidate.cellSize)
      ? candidate.cellSize
      : Number.isFinite(fallback.cellSize)
        ? fallback.cellSize
        : Number.isFinite(this.currentCellSize)
          ? this.currentCellSize
          : 5;
    const baseRows = Number.isFinite(candidate.rows)
      ? candidate.rows
      : Number.isFinite(fallback.rows)
        ? fallback.rows
        : Number.isFinite(this.gridRows)
          ? this.gridRows
          : 120;
    const baseCols = Number.isFinite(candidate.cols)
      ? candidate.cols
      : Number.isFinite(fallback.cols)
        ? fallback.cols
        : Number.isFinite(this.gridCols)
          ? this.gridCols
          : 120;

    const roundToPositive = (value) =>
      Math.max(1, Math.round(Number.isFinite(value) ? value : 0));
    const applyBounds = (value, bound) => {
      if (!clampToBounds) {
        return roundToPositive(value);
      }

      const min = Number.isFinite(bound?.min) ? bound.min : roundToPositive(value);
      const max = Number.isFinite(bound?.max) ? bound.max : roundToPositive(value);

      return clamp(roundToPositive(value), min, max);
    };

    const cellSize = applyBounds(baseCellSize, bounds.cellSize);
    const rows = applyBounds(baseRows, bounds.rows);
    const cols = applyBounds(baseCols, bounds.cols);

    return { cellSize, rows, cols };
  }

  #updateGeometryInputs({ cellSize, rows, cols }) {
    const controls = this.geometryControls || {};

    if (controls.cellSizeInput?.updateDisplay) {
      controls.cellSizeInput.updateDisplay(cellSize);
    } else if (controls.cellSizeInput) {
      controls.cellSizeInput.value = String(cellSize);
    }

    if (controls.rowsInput?.updateDisplay) {
      controls.rowsInput.updateDisplay(rows);
    } else if (controls.rowsInput) {
      controls.rowsInput.value = String(rows);
    }

    if (controls.colsInput?.updateDisplay) {
      controls.colsInput.updateDisplay(cols);
    } else if (controls.colsInput) {
      controls.colsInput.value = String(cols);
    }

    this.currentCellSize = cellSize;
    this.gridRows = rows;
    this.gridCols = cols;

    this.#updateGeometrySummary(
      { cellSize, rows, cols },
      { raw: { cellSize, rows, cols }, source: "sync" },
    );
  }

  #updateGeometrySummary(values = {}, options = {}) {
    const fallback = options.fallback ?? {
      cellSize: this.currentCellSize,
      rows: this.gridRows,
      cols: this.gridCols,
    };
    const normalized = this.#normalizeGeometryValues(values, fallback);
    const controls = this.geometryControls;

    if (!controls?.summaryEl) return normalized;

    const isBusy = Boolean(controls.geometryBusy);
    const rawValues = options.raw ?? values ?? {};
    const hasEmpty = Boolean(options.hasEmpty);
    const hasInvalid = Boolean(options.hasInvalid);
    const source = options.source || "user";
    const isIncomplete = hasEmpty || hasInvalid;
    const formatNumber = (value) =>
      Number.isFinite(value) ? value.toLocaleString() : "—";

    const widthPx =
      Number.isFinite(normalized.cols) && Number.isFinite(normalized.cellSize)
        ? Math.round(normalized.cols * normalized.cellSize)
        : Number.NaN;
    const heightPx =
      Number.isFinite(normalized.rows) && Number.isFinite(normalized.cellSize)
        ? Math.round(normalized.rows * normalized.cellSize)
        : Number.NaN;

    if (controls.previewCellsEl) {
      controls.previewCellsEl.textContent = isIncomplete
        ? "—"
        : `${formatNumber(normalized.cols)} × ${formatNumber(normalized.rows)}`;
    }

    if (controls.previewPixelsEl) {
      controls.previewPixelsEl.textContent = isIncomplete
        ? "—"
        : `${formatNumber(widthPx)} × ${formatNumber(heightPx)}`;
    }

    if (isBusy) {
      controls.summaryEl.setAttribute("data-state", "busy");
      controls.summaryEl.setAttribute("aria-busy", "true");
      if (controls.summaryStatusEl) {
        controls.summaryStatusEl.textContent = "Applying…";
      }
      if (controls.applyButton) {
        controls.applyButton.disabled = true;
        controls.applyButton.setAttribute("aria-disabled", "true");
      }

      return normalized;
    }

    const differsFromCurrent =
      source !== "sync" &&
      !isIncomplete &&
      (normalized.cellSize !== this.currentCellSize ||
        normalized.rows !== this.gridRows ||
        normalized.cols !== this.gridCols);

    const state = isIncomplete
      ? "incomplete"
      : differsFromCurrent
        ? "pending"
        : "current";

    controls.summaryEl.setAttribute("data-state", state);
    controls.summaryEl.setAttribute("aria-busy", "false");

    if (controls.summaryStatusEl) {
      let statusText = "Current";

      if (state === "pending") statusText = "Pending Apply";
      else if (state === "incomplete")
        statusText = hasInvalid ? "Enter Valid Numbers" : "Enter All Values";

      controls.summaryStatusEl.textContent = statusText;
    }

    if (controls.summaryNoteEl) {
      const noteEl = controls.summaryNoteEl;
      const defaultNote = controls.summaryDefaultNote;

      noteEl.classList.remove("geometry-summary__note--warning");
      noteEl.classList.remove("geometry-summary__note--success");

      if (isIncomplete) {
        noteEl.textContent = hasInvalid
          ? "Enter valid numbers to preview the new grid."
          : "Enter values for every field to preview the new grid.";
        noteEl.classList.add("geometry-summary__note--warning");
      } else {
        const adjustments = this.#describeGeometryAdjustments(rawValues, normalized);

        if (adjustments.length > 0) {
          noteEl.textContent = `Adjusted to stay within limits: ${this.#formatReadableList(
            adjustments,
          )}.`;
          noteEl.classList.add("geometry-summary__note--warning");
        } else {
          noteEl.textContent =
            defaultNote || "Preview updates as you edit. Apply to confirm changes.";
        }
      }
    }

    if (controls.applyButton) {
      const disabled = isIncomplete || !differsFromCurrent;

      controls.applyButton.disabled = disabled;
      controls.applyButton.setAttribute("aria-disabled", disabled ? "true" : "false");
    }

    return normalized;
  }

  #describeGeometryAdjustments(raw = {}, normalized = {}) {
    const bounds = GRID_GEOMETRY_BOUNDS;
    const descriptors = [
      { key: "cellSize", label: "Cell size", unit: "px", bounds: bounds.cellSize },
      { key: "rows", label: "Rows", unit: "tiles", bounds: bounds.rows },
      { key: "cols", label: "Columns", unit: "tiles", bounds: bounds.cols },
    ];
    const adjustments = [];

    const formatValue = (value, unit) => {
      if (!Number.isFinite(value)) return null;

      const formatted = value.toLocaleString();

      return unit ? `${formatted} ${unit}` : formatted;
    };

    descriptors.forEach(({ key, label, unit, bounds: bound }) => {
      const rawValue = raw?.[key];
      const normalizedValue = normalized?.[key];

      if (!Number.isFinite(rawValue) || !Number.isFinite(normalizedValue)) return;

      const rounded = Math.round(rawValue);
      const formatted = formatValue(normalizedValue, unit);

      if (!formatted) return;

      if (rounded < bound.min && normalizedValue === bound.min) {
        adjustments.push(`${label} raised to ${formatted}`);

        return;
      }

      if (rounded > bound.max && normalizedValue === bound.max) {
        adjustments.push(`${label} capped at ${formatted}`);

        return;
      }

      if (rounded !== rawValue && normalizedValue === rounded) {
        adjustments.push(`${label} rounded to ${formatted}`);

        return;
      }

      if (normalizedValue !== rawValue) {
        adjustments.push(`${label} adjusted to ${formatted}`);
      }
    });

    return adjustments;
  }

  #geometryValuesEqual(a = {}, b = {}) {
    const keys = ["cellSize", "rows", "cols"];

    return keys.every((key) => {
      const aValue = Number(a?.[key]);
      const bValue = Number(b?.[key]);

      if (!Number.isFinite(aValue) && !Number.isFinite(bValue)) return true;

      return aValue === bValue;
    });
  }

  #formatGeometryDimensions(values = {}) {
    const cols = Number(values?.cols);
    const rows = Number(values?.rows);
    const cellSize = Number(values?.cellSize);
    const parts = [];

    if (Number.isFinite(cols) && Number.isFinite(rows)) {
      parts.push(`${cols.toLocaleString()} × ${rows.toLocaleString()} cells`);
    }

    if (Number.isFinite(cols) && Number.isFinite(rows) && Number.isFinite(cellSize)) {
      const width = Math.round(cols * cellSize);
      const height = Math.round(rows * cellSize);

      parts.push(`${width.toLocaleString()} × ${height.toLocaleString()} px`);
    } else if (Number.isFinite(cellSize) && parts.length > 0) {
      parts.push(`${cellSize.toLocaleString()} px tiles`);
    }

    return parts.join(" • ");
  }

  #showGeometryAppliedMessage(values = {}, options = {}) {
    const controls = this.geometryControls;
    const noteEl = controls?.summaryNoteEl;

    if (!noteEl) return;

    noteEl.classList.remove("geometry-summary__note--warning");
    const summary = this.#formatGeometryDimensions(values);
    const adjustments = Array.isArray(options.adjustments)
      ? options.adjustments.filter(Boolean)
      : [];

    if (options.changed) {
      noteEl.classList.add("geometry-summary__note--success");
      const prefix = options.reseed ? "World resized and reseeded" : "World resized";
      const baseMessage = summary ? `${prefix}: ${summary}.` : `${prefix}.`;
      const adjustmentNote =
        adjustments.length > 0
          ? ` Adjusted to stay within limits: ${this.#formatReadableList(adjustments)}.`
          : "";

      noteEl.textContent = `${baseMessage}${adjustmentNote}`;
    } else {
      noteEl.classList.remove("geometry-summary__note--success");
      noteEl.textContent = summary
        ? `No changes needed. World already sized at ${summary}.`
        : "No changes needed. World already at the requested size.";
    }
  }

  #setGeometryBusy(isBusy, details = {}) {
    const controls = this.geometryControls;

    if (!controls?.applyButton) return false;

    const button = controls.applyButton;
    const summary = controls.summaryEl;
    const statusEl = controls.summaryStatusEl;

    if (isBusy) {
      if (controls.geometryBusy) return false;

      controls.geometryBusy = true;
      if (!controls.applyButtonDefaultLabel) {
        controls.applyButtonDefaultLabel = button.textContent || "Apply Geometry";
      }
      if (!controls.applyButtonDefaultTitle) {
        controls.applyButtonDefaultTitle = button.title || "Apply Geometry";
      }
      if (!controls.applyButtonDefaultAriaLabel) {
        const ariaLabel = this.#readElementAttribute(button, "aria-label");

        controls.applyButtonDefaultAriaLabel =
          ariaLabel ||
          controls.applyButtonDefaultLabel ||
          controls.applyButtonDefaultTitle;
      }

      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("data-busy", "true");

      const targetSummary = this.#formatGeometryDimensions(details.target);
      let busyNote =
        details.note ||
        (details.reseed
          ? "Resizing and reseeding the world. This may take a moment."
          : "Resizing the world. This may take a moment.");

      if (targetSummary) {
        busyNote = `${busyNote} Target: ${targetSummary}.`;
      }

      button.textContent = details.label || "Applying…";
      button.title = busyNote;
      button.setAttribute("aria-label", busyNote);

      if (summary) {
        summary.setAttribute("data-state", "busy");
        summary.setAttribute("aria-busy", "true");
      }
      if (statusEl) {
        statusEl.textContent = "Applying…";
      }
      if (controls.summaryNoteEl) {
        controls.summaryNoteEl.textContent = busyNote;
        controls.summaryNoteEl.classList.remove("geometry-summary__note--warning");
        controls.summaryNoteEl.classList.remove("geometry-summary__note--success");
      }

      return true;
    }

    if (!controls.geometryBusy) return false;

    controls.geometryBusy = false;
    if (typeof button.removeAttribute === "function")
      button.removeAttribute("data-busy");
    else button.setAttribute("data-busy", "false");
    button.title = controls.applyButtonDefaultTitle || "Apply Geometry";
    const defaultAriaLabel =
      controls.applyButtonDefaultAriaLabel ||
      controls.applyButtonDefaultLabel ||
      controls.applyButtonDefaultTitle ||
      "Apply Geometry";

    button.setAttribute("aria-label", defaultAriaLabel);
    button.textContent = controls.applyButtonDefaultLabel || "Apply Geometry";

    if (summary) {
      summary.setAttribute("aria-busy", "false");
    }

    const appliedValues = details.applied ?? {};
    const normalizedApplied = this.#normalizeGeometryValues(appliedValues, {
      cellSize: this.currentCellSize,
      rows: this.gridRows,
      cols: this.gridCols,
    });
    const previousValues = this.#normalizeGeometryValues(
      details.previous ?? {},
      normalizedApplied,
      {
        clampToBounds: false,
      },
    );
    const changed = !this.#geometryValuesEqual(previousValues, normalizedApplied);

    const rawRequest = details.raw ?? appliedValues ?? {};

    this.#updateGeometrySummary(normalizedApplied, {
      raw: rawRequest,
      source: "sync",
    });

    const adjustmentList = this.#describeGeometryAdjustments(
      rawRequest,
      normalizedApplied,
    );

    this.#showGeometryAppliedMessage(normalizedApplied, {
      changed,
      reseed: Boolean(details.reseed),
      adjustments: adjustmentList,
    });

    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");

    return true;
  }

  #setResetWorldBusy(isBusy, details = {}) {
    if (isBusy) {
      if (this.resetWorldBusy) return false;

      this.resetWorldBusy = true;
      const button = this.resetWorldButton;

      if (!button) return true;

      if (!this.resetWorldButtonDefaults) {
        const defaultLabel = button.textContent || "Regenerate World";
        const defaultTitle = button.title || defaultLabel;
        const defaultAria = this.#readElementAttribute(button, "aria-label");

        this.resetWorldButtonDefaults = {
          label: defaultLabel,
          title: defaultTitle,
          ariaLabel: defaultAria,
        };
      }

      const busyMessage = details?.randomizeObstacles
        ? "Regenerating the world with a new obstacle layout. This may take a moment."
        : "Regenerating the world. This may take a moment.";

      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("data-busy", "true");
      button.textContent = "Regenerating…";
      button.title = busyMessage;
      button.setAttribute("aria-label", busyMessage);
      button.setAttribute("aria-live", "polite");

      if (details?.randomizeObstacles) {
        button.setAttribute("data-busy-mode", "randomize");
      } else {
        this.#removeElementAttribute(button, "data-busy-mode");
      }

      return true;
    }

    if (!this.resetWorldBusy) return false;

    this.resetWorldBusy = false;
    const button = this.resetWorldButton;

    if (!button) return true;

    button.disabled = false;
    button.setAttribute("aria-disabled", "false");
    this.#removeElementAttribute(button, "data-busy");
    this.#removeElementAttribute(button, "data-busy-mode");

    const defaults = this.resetWorldButtonDefaults || {};
    const defaultLabel = defaults.label || "Regenerate World";
    const defaultTitle = defaults.title || defaultLabel;

    button.textContent = defaultLabel;
    button.title = defaultTitle;

    if (typeof defaults.ariaLabel === "string" && defaults.ariaLabel.length > 0) {
      button.setAttribute("aria-label", defaults.ariaLabel);
    } else {
      this.#removeElementAttribute(button, "aria-label");
    }

    return true;
  }

  #releaseResetWorldBusy(details = {}) {
    if (!this.resetWorldBusy) return false;

    const release = () => {
      this.#setResetWorldBusy(false, details);
    };

    if (typeof window !== "undefined") {
      if (typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(() => {
          release();
        });

        return true;
      }

      if (typeof window.setTimeout === "function") {
        window.setTimeout(release, 0);

        return true;
      }
    }

    release();

    return true;
  }

  #formatReadableList(items = []) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];

    if (list.length === 0) return "";
    if (list.length === 1) return list[0];
    if (list.length === 2) return `${list[0]} and ${list[1]}`;

    const head = list.slice(0, -1).join(", ");
    const tail = list[list.length - 1];

    return `${head}, and ${tail}`;
  }

  #applyWorldGeometry(values = {}, options = {}) {
    if (typeof this.setWorldGeometry !== "function") return null;

    const normalized = this.#normalizeGeometryValues(values);
    const request = { ...normalized, ...options };
    let result = null;

    try {
      result = this.setWorldGeometry(request);
    } catch (error) {
      warnOnce("Failed to update world geometry.", error);
      result = request;
    }

    const applied = this.#normalizeGeometryValues(result, normalized);

    this.#updateGeometryInputs(applied);
    this.#scheduleUpdate();
    this.#updateZoneSummary();

    return applied;
  }

  setGridGeometry(values = {}) {
    const fallback = {
      cellSize: this.currentCellSize,
      rows: this.gridRows,
      cols: this.gridCols,
    };
    const normalized = this.#normalizeGeometryValues(values, fallback, {
      clampToBounds: false,
    });

    this.#updateGeometryInputs(normalized);
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
  }

  destroy() {
    if (this._documentKeydownListener && document?.removeEventListener) {
      document.removeEventListener("keydown", this._documentKeydownListener);
      this._documentKeydownListener = null;
    }
  }

  #ensureMainRowMounted(anchor) {
    if (this.mainRow.parentElement) return;

    if (anchor?.parentElement) {
      anchor.parentElement.insertBefore(this.mainRow, anchor);
    } else {
      this.root.appendChild(this.mainRow);
    }
  }

  #installPauseIndicator() {
    if (!this.canvasContainer || this.pauseOverlay) return;

    const overlay = document.createElement("div");

    overlay.className = "canvas-pause-indicator";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.hidden = true;

    const title = document.createElement("span");

    title.className = "canvas-pause-indicator__title";
    title.textContent = "Paused";

    const hint = document.createElement("span");

    hint.className = "canvas-pause-indicator__hint";

    const autopause = document.createElement("span");

    autopause.className = "canvas-pause-indicator__autopause";
    autopause.hidden = true;

    overlay.appendChild(title);
    overlay.appendChild(hint);
    overlay.appendChild(autopause);

    this.canvasContainer.appendChild(overlay);

    this.pauseOverlay = overlay;
    this.pauseOverlayTitle = title;
    this.pauseOverlayHint = hint;
    this.pauseOverlayAutopause = autopause;

    this.#updatePauseIndicator();
  }

  #formatHotkeyLabel(key) {
    const normalized = this.#normalizeHotkeyValue(key);

    if (!normalized) return "";

    switch (normalized) {
      case " ":
        return "Space";
      case "arrowup":
        return "Arrow Up";
      case "arrowdown":
        return "Arrow Down";
      case "arrowleft":
        return "Arrow Left";
      case "arrowright":
        return "Arrow Right";
      case "escape":
        return "Esc";
      case "enter":
        return "Enter";
      case "return":
        return "Return";
      case "pagedown":
        return "Page Down";
      case "pageup":
        return "Page Up";
      default:
        break;
    }

    if (normalized.length === 1) {
      return normalized.toUpperCase();
    }

    return normalized[0].toUpperCase() + normalized.slice(1);
  }

  #formatHotkeyList(hotkeySet) {
    if (!hotkeySet || hotkeySet.size === 0) {
      return "";
    }

    const entries = Array.from(hotkeySet, (key) => {
      const normalized = this.#normalizeHotkeyValue(key);

      if (!normalized) return null;

      const label = this.#formatHotkeyLabel(normalized);

      if (!label) return null;

      return { normalized, label };
    }).filter((entry) => entry != null);

    if (entries.length === 0) return "";

    const hasNonSpace = entries.some((entry) => entry.normalized !== " ");
    const filtered = hasNonSpace
      ? entries.filter((entry) => entry.normalized !== " ")
      : entries;
    const labels = filtered
      .map((entry) => entry.label)
      .filter((value) => value.length > 0);

    if (labels.length === 0) return "";
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;

    const last = labels[labels.length - 1];
    const leading = labels.slice(0, -1).join(", ");

    return `${leading}, or ${last}`;
  }

  #formatPauseHotkeys() {
    return this.#formatHotkeyList(this.pauseHotkeySet);
  }

  #formatStepHotkeys() {
    return this.#formatHotkeyList(this.stepHotkeySet);
  }

  #formatSpeedIncreaseHotkeys() {
    return this.#formatHotkeyList(this.speedIncreaseHotkeySet);
  }

  #formatSpeedDecreaseHotkeys() {
    return this.#formatHotkeyList(this.speedDecreaseHotkeySet);
  }

  #formatSpeedResetHotkeys() {
    return this.#formatHotkeyList(this.speedResetHotkeySet);
  }

  #formatAriaKeyShortcuts(hotkeySet) {
    if (!hotkeySet || hotkeySet.size === 0) {
      return "";
    }

    const normalizedEntries = Array.from(hotkeySet, (key) =>
      this.#normalizeHotkeyValue(key),
    ).filter((value) => value.length > 0);
    const hasNonSpaceEntries = normalizedEntries.some((value) => value !== " ");

    const entries = normalizedEntries
      .filter((value) => (value === " " ? !hasNonSpaceEntries : true))
      .map((value) => {
        if (value === " ") return "Space";

        const label = this.#formatHotkeyLabel(value);

        return label.replace(/\s+/g, "");
      })
      .filter((value) => value.length > 0);

    return entries.join(" ");
  }

  #applyButtonHotkeys(button, hotkeySet) {
    if (!button) return;

    const shortcutValue = this.#formatAriaKeyShortcuts(hotkeySet);

    if (shortcutValue.length > 0) {
      button.setAttribute("aria-keyshortcuts", shortcutValue);
    } else {
      button.removeAttribute("aria-keyshortcuts");
    }
  }

  #updatePauseButtonState() {
    if (!this.pauseButton) return;

    const hotkeyLabel = this.#formatPauseHotkeys();
    const isPaused = this.paused;
    const actionLabel = isPaused ? "Resume" : "Pause";
    const description = isPaused ? "Resume the simulation" : "Pause the simulation";
    const hotkeySuffix = hotkeyLabel.length > 0 ? ` Shortcut: ${hotkeyLabel}.` : "";
    const announcement = `${description}.${hotkeySuffix}`.trim();

    this.pauseButton.textContent = actionLabel;
    this.pauseButton.setAttribute("aria-pressed", isPaused ? "true" : "false");
    this.pauseButton.setAttribute("aria-label", announcement);
    this.pauseButton.title = announcement;
  }

  #updateStepButtonState() {
    if (!this.stepButton) return;

    this.stepButton.disabled = !this.paused;

    const hotkeyLabel = this.#formatStepHotkeys();
    const hotkeySuffix = hotkeyLabel.length > 0 ? ` (shortcut: ${hotkeyLabel})` : "";
    const pausedHint =
      "Advance one tick while paused to inspect changes frame-by-frame";
    const runningHint = "Pause the simulation to enable single-step playback";

    this.stepButton.title = this.paused
      ? `${pausedHint}${hotkeySuffix}.`
      : `${runningHint}${hotkeySuffix}.`;
  }

  #updatePauseIndicator() {
    if (!this.pauseOverlay) return;

    if (!this.paused) {
      this.pauseOverlay.hidden = true;

      return;
    }

    this.pauseOverlay.hidden = false;

    if (this.pauseOverlayTitle) {
      this.pauseOverlayTitle.textContent = "Paused";
    }

    if (this.pauseOverlayHint) {
      const hotkeyText = this.#formatPauseHotkeys();
      const hasHotkey = hotkeyText.length > 0;
      const resumeHint = hasHotkey
        ? `Press ${hotkeyText} to resume`
        : "Use the Resume button to continue";
      const buttonSuffix = hasHotkey ? " or use the Resume button." : ".";
      const stepHotkeys = this.#formatStepHotkeys();
      const showStepHint = this.#canStep() && stepHotkeys.length > 0;
      const stepHint = showStepHint ? ` Press ${stepHotkeys} to step once.` : "";

      this.pauseOverlayHint.textContent = `${resumeHint}${buttonSuffix}${stepHint}`;
    }

    if (this.pauseOverlayAutopause) {
      if (this.autoPausePending) {
        this.pauseOverlayAutopause.hidden = false;
        this.pauseOverlayAutopause.textContent =
          "Autopause resumes when the tab regains focus.";
      } else {
        this.pauseOverlayAutopause.hidden = true;
        this.pauseOverlayAutopause.textContent = "";
      }
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

  #readElementAttribute(element, name) {
    if (!element || typeof name !== "string" || name.length === 0) return null;
    if (typeof element.getAttribute === "function") {
      try {
        return element.getAttribute(name);
      } catch {
        // Ignore environments without standard DOM attribute helpers.
      }
    }

    if (element.attributes && typeof element.attributes === "object") {
      const value = element.attributes[name];

      if (value != null) return value;
    }

    return null;
  }

  #removeElementAttribute(element, name) {
    if (!element || typeof name !== "string" || name.length === 0) return;

    if (typeof element.removeAttribute === "function") {
      try {
        element.removeAttribute(name);

        return;
      } catch {
        // Ignore environments without DOM attribute helpers.
      }
    }

    if (element.attributes && typeof element.attributes === "object") {
      delete element.attributes[name];
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

  #canStep() {
    return typeof this.simulationCallbacks?.step === "function";
  }

  #executeStep() {
    if (!this.paused) return false;
    if (!this.#canStep()) return false;

    this.simulationCallbacks.step();
    this.#scheduleUpdate();

    return true;
  }

  #notifySettingChange(key, value) {
    const callback = this.simulationCallbacks?.onSettingChange;

    invokeWithErrorBoundary(callback, [key, value], {
      message: (settingKey) =>
        `UI onSettingChange callback threw while processing "${settingKey}"; continuing without interruption.`,
      once: true,
    });
  }

  #updateSetting(key, value, { notify = true } = {}) {
    this[key] = value;
    if (notify) {
      this.#notifySettingChange(key, value);
    }
  }

  #registerSliderElement(key, element) {
    if (!key || !element) return;
    if (!this._sliderInputs) {
      this._sliderInputs = new Map();
    }

    this._sliderInputs.set(key, element);
  }

  #syncSliderInput(key, value) {
    if (!key) return;

    const slider = this._sliderInputs?.get(key);

    if (slider?.updateDisplay) {
      slider.updateDisplay(value);
    }

    if (
      key === "leaderboardIntervalMs" &&
      this.dashboardCadenceSlider &&
      this.dashboardCadenceSlider !== slider &&
      this.dashboardCadenceSlider.updateDisplay
    ) {
      this.dashboardCadenceSlider.updateDisplay(value);
    }
  }

  #sanitizeSpeedMultiplier(value) {
    const bounds = UI_SLIDER_CONFIG?.speedMultiplier || {};
    const floor = Number.isFinite(bounds.floor) ? bounds.floor : undefined;
    const min = Number.isFinite(bounds.min) ? bounds.min : undefined;
    const max = Number.isFinite(bounds.max) ? bounds.max : undefined;
    const lowerBound = floor ?? min ?? 0.1;
    const upperBound = max ?? 100;
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return null;

    return clamp(numeric, lowerBound, upperBound);
  }

  #formatSpeedDisplay(value) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return "—";

    const rounded = Math.round(numeric * 10) / 10;
    const isWhole = Math.abs(rounded - Math.round(rounded)) < 1e-9;
    const displayValue = isWhole ? Math.round(rounded) : rounded.toFixed(1);

    return `${displayValue}×`;
  }

  #formatMultiplierDisplay(value, decimals = 2) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) return "—";

    const precision = Number.isFinite(decimals)
      ? Math.max(0, Math.min(4, decimals))
      : 0;
    const factor = precision > 0 ? 10 ** precision : 1;
    const rounded =
      precision > 0 ? Math.round(numeric * factor) / factor : Math.round(numeric);
    let text = precision > 0 ? rounded.toFixed(precision) : String(rounded);

    if (precision > 0) {
      text = text.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
    }

    return `${text}×`;
  }

  #buildSpeedHotkeyHint() {
    const baseHint = "Speed multiplier relative to 60 updates/sec (0.5×..100×).";
    const pieces = [];
    const increase = this.#formatSpeedIncreaseHotkeys();
    const decrease = this.#formatSpeedDecreaseHotkeys();
    const reset = this.#formatSpeedResetHotkeys();

    if (increase) {
      pieces.push(`Press ${increase} to speed up`);
    }

    if (decrease) {
      pieces.push(`Press ${decrease} to slow down`);
    }

    if (reset) {
      pieces.push(`Press ${reset} to reset to 1×`);
    }

    const hint = pieces.length > 0 ? `${baseHint} ${pieces.join(" ")}` : baseHint;
    const shiftNote =
      pieces.length > 0
        ? " Hold Shift with the shortcuts to jump five steps at a time."
        : "";

    return `${hint}${shiftNote}`.trim();
  }

  #setSpeedMultiplier(value, { notify = true } = {}) {
    const sanitized = this.#sanitizeSpeedMultiplier(value);

    if (!Number.isFinite(sanitized)) return;

    this.#updateSetting("speedMultiplier", sanitized, { notify });
    this.#updateSpeedMultiplierUI(sanitized);
  }

  #bumpSpeedMultiplier(stepCount = 1) {
    const baseStep =
      Number.isFinite(this.speedStep) && this.speedStep > 0 ? this.speedStep : 0.5;
    const current =
      Number.isFinite(this.speedMultiplier) && this.speedMultiplier > 0
        ? this.speedMultiplier
        : 1;
    const next = current + baseStep * stepCount;

    this.#setSpeedMultiplier(next);
  }

  #resetSpeedMultiplier() {
    this.#setSpeedMultiplier(1);
  }

  #updateSpeedMultiplierUI(value) {
    const numeric = Number(value);

    if (Number.isFinite(numeric) && this.playbackSpeedSlider?.updateDisplay) {
      this.playbackSpeedSlider.updateDisplay(numeric);
    }

    if (!Array.isArray(this.speedPresetButtons)) return;

    const stepSize =
      Number.isFinite(this.speedStep) && this.speedStep > 0 ? this.speedStep : 0.5;
    const tolerance = Math.max(0.001, stepSize * 0.05);

    this.speedPresetButtons.forEach(({ value: presetValue, button }) => {
      if (!button) return;
      const isActive = Number.isFinite(numeric)
        ? Math.abs(numeric - presetValue) <= tolerance
        : false;

      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  #updateZoneSummary() {
    if (!this.zoneSummaryEl) return;
    const zones =
      this.selectionManager &&
      typeof this.selectionManager.getActiveZones === "function"
        ? this.selectionManager.getActiveZones()
        : [];

    const zoneNames = zones
      .map((zone) => zone?.name || zone?.id)
      .filter((name) => typeof name === "string" && name.length > 0);
    const hasZones = zoneNames.length > 0;
    const summaryText = hasZones
      ? `Focused on ${zoneNames.length === 1 ? "zone" : "zones"}: ${zoneNames.join(", ")}`
      : "All tiles eligible for reproduction";

    if (this.zoneSummaryTextEl) {
      this.zoneSummaryTextEl.textContent = summaryText;
    } else {
      this.zoneSummaryEl.textContent = summaryText;
    }

    if (this.zoneSummaryList) {
      this.zoneSummaryList.innerHTML = "";
      if (hasZones) {
        this.zoneSummaryList.hidden = false;
        zones.forEach((zone) => {
          const item = document.createElement("li");

          item.className = "zone-summary-tag";
          if (zone?.description) item.title = zone.description;
          const swatch = document.createElement("span");

          swatch.className = "zone-summary-swatch";
          if (zone?.color) swatch.style.background = zone.color;
          else swatch.classList.add("zone-summary-swatch--muted");
          swatch.setAttribute("aria-hidden", "true");
          item.appendChild(swatch);

          const label = document.createElement("span");

          label.textContent = zone?.name || zone?.id || "Zone";
          item.appendChild(label);
          this.zoneSummaryList.appendChild(item);
        });
      } else {
        this.zoneSummaryList.hidden = true;
      }
    }
  }
  // Reusable checkbox row helper
  #addCheckbox(body, label, titleOrOptions, initial, onChange) {
    const options =
      titleOrOptions && typeof titleOrOptions === "object"
        ? titleOrOptions
        : { title: titleOrOptions };
    const { title, description, color, describedBy } = options || {};
    const row = document.createElement("label");

    row.className = "control-row";
    if (title) row.title = title;
    const line = document.createElement("div");

    line.className = "control-line control-line--checkbox";
    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = Boolean(initial);

    const labelContainer = document.createElement("div");

    labelContainer.className = "control-checkbox-label";
    const name = document.createElement("div");

    name.className = "control-name";
    if (color) {
      const swatch = document.createElement("span");

      swatch.className = "control-swatch";
      swatch.style.background = color;
      name.appendChild(swatch);
    }

    const nameText = document.createElement("span");

    nameText.textContent = label ?? "";
    name.appendChild(nameText);
    labelContainer.appendChild(name);

    let descriptionId = null;

    if (description) {
      descriptionId = `checkbox-hint-${++this._checkboxIdSequence}`;
      const descriptionEl = document.createElement("div");

      descriptionEl.className = "control-checkbox-description control-hint";
      descriptionEl.id = descriptionId;
      descriptionEl.textContent = description;
      labelContainer.appendChild(descriptionEl);
    } else if (typeof describedBy === "string" && describedBy.length > 0) {
      descriptionId = describedBy;
    }

    if (descriptionId) {
      input.setAttribute("aria-describedby", descriptionId);
    }

    if (typeof onChange === "function") {
      input.addEventListener("input", () => onChange(input.checked));
    }

    line.appendChild(input);
    line.appendChild(labelContainer);
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
    const coverage = formatIfFinite(
      event.coverageRatio,
      (ratio) => `${Math.round(clamp(ratio, 0, 1) * 100)}% of the grid`,
    );
    const remaining = formatIfFinite(
      event.remainingTicks,
      (ticks) => `${ticks} ticks remaining`,
    );
    const duration = formatIfFinite(
      event.durationTicks,
      (ticks) => `${ticks} ticks total`,
    );
    const baseIntensity = formatIfFinite(
      event.strength,
      (strength) => `base intensity ${strength.toFixed(2)}×`,
    );
    const effectiveIntensity = formatIfFinite(
      event.effectiveStrength,
      (strength) => `effective intensity ${strength.toFixed(2)}×`,
    );

    if (coverage) pieces.push(coverage);
    if (remaining) pieces.push(remaining);
    if (duration && duration !== remaining) pieces.push(duration);

    const summary = pieces.length > 0 ? pieces.join(", ") : "influence over the grid";
    const strengthParts = [baseIntensity, effectiveIntensity]
      .filter(Boolean)
      .join(" → ");
    const multiplierPart = formatIfFinite(
      multiplier,
      (value) => `Global strength multiplier ${value.toFixed(2)}×.`,
      "",
    );

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

  #resolveDeathCauseColor(causeKey) {
    const fallback = DEATH_CAUSE_COLOR_MAP.unknown;

    if (typeof causeKey !== "string") {
      return fallback;
    }

    const normalized = causeKey.trim().toLowerCase();

    return DEATH_CAUSE_COLOR_MAP[normalized] || fallback;
  }

  #updateDeathBreakdown(breakdown, fallbackTotal = 0) {
    if (!this.deathBreakdownList || !this.deathBreakdownEmptyState) return;

    this.deathBreakdownList.innerHTML = "";

    const entries = [];

    if (breakdown && typeof breakdown === "object") {
      for (const [key, value] of Object.entries(breakdown)) {
        const numeric = Number(value);

        if (!Number.isFinite(numeric) || numeric <= 0) continue;

        entries.push({ key, count: numeric });
      }
    }

    entries.sort((a, b) => b.count - a.count);

    const total = entries.reduce((sum, entry) => sum + entry.count, 0);

    if (!(total > 0)) {
      const fallback = Number.isFinite(fallbackTotal) ? fallbackTotal : 0;

      this.deathBreakdownList.hidden = true;
      this.deathBreakdownEmptyState.hidden = false;
      this.deathBreakdownEmptyState.textContent =
        fallback > 0
          ? "Deaths recorded, but causes not classified yet."
          : "No deaths recorded this tick.";

      return;
    }

    const limit =
      Number.isFinite(this.deathBreakdownMaxEntries) &&
      this.deathBreakdownMaxEntries > 0
        ? this.deathBreakdownMaxEntries
        : DEFAULT_DEATH_BREAKDOWN_MAX_ENTRIES;
    const visible = entries.slice(0, limit);
    const visibleTotal = visible.reduce((sum, entry) => sum + entry.count, 0);
    const remainder = total - visibleTotal;

    if (remainder > 0) {
      visible.push({ key: "other", count: remainder, label: "Other causes" });
    }

    this.deathBreakdownEmptyState.hidden = true;
    this.deathBreakdownList.hidden = false;

    visible.forEach((entry) => {
      const item = document.createElement("li");

      item.className = "death-breakdown-item";
      const ratio = total > 0 ? clamp01(entry.count / total) : 0;
      const percent = ratio * 100;
      const percentText =
        percent >= 10 ? `${percent.toFixed(0)}%` : `${percent.toFixed(1)}%`;
      const countText = entry.count.toLocaleString();
      const labelText =
        entry.label || this.#formatLifeEventCause({ type: "death", cause: entry.key });
      const color =
        entry.key === "other"
          ? DEATH_BREAKDOWN_OTHER_COLOR
          : this.#resolveDeathCauseColor(entry.key);
      const row = document.createElement("div");

      row.className = "death-breakdown-row";
      const labelEl = document.createElement("span");

      labelEl.className = "death-breakdown-label";
      labelEl.textContent = labelText;
      row.appendChild(labelEl);

      const valueEl = document.createElement("span");

      valueEl.className = "death-breakdown-value";
      valueEl.textContent = `${countText} (${percentText})`;
      row.appendChild(valueEl);

      item.appendChild(row);

      const meter = document.createElement("div");

      meter.className = "death-breakdown-meter";
      meter.setAttribute("role", "meter");
      meter.setAttribute("aria-label", `${labelText} share of deaths`);
      meter.setAttribute("aria-valuemin", "0");
      meter.setAttribute("aria-valuemax", "1");
      meter.setAttribute("aria-valuenow", ratio.toFixed(2));
      meter.setAttribute("aria-valuetext", `${percentText} of deaths`);
      meter.title = `${labelText} caused ${percentText} of deaths this tick.`;

      const fill = document.createElement("div");

      fill.className = "death-breakdown-fill";
      const widthPercent = ratio > 0 ? Math.max(3, Math.min(100, percent)) : 0;

      fill.style.width = `${widthPercent.toFixed(1)}%`;
      fill.style.background = color;
      meter.appendChild(fill);

      item.appendChild(meter);
      item.setAttribute(
        "aria-label",
        `${labelText}: ${countText} deaths (${percentText}) this tick`,
      );

      this.deathBreakdownList.appendChild(item);
    });
  }

  #updateLifeEventsSummary(birthCount = 0, deathCount = 0, totalCount, trend) {
    if (!this.lifeEventsSummary) return;

    const updateItem = (item, countEl, count) => {
      if (!item || !countEl) return;

      const label =
        (typeof item.getAttribute === "function" && item.getAttribute("data-label")) ||
        item.dataset?.label ||
        "";
      const singular =
        (typeof item.getAttribute === "function" &&
          item.getAttribute("data-singular")) ||
        item.dataset?.singular ||
        label;
      const safeCount = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      const displayCount = safeCount.toLocaleString();

      countEl.textContent = displayCount;
      item.classList.toggle("life-events-summary__item--muted", safeCount === 0);

      if (label) {
        const labelLower = label.toLowerCase();
        const plural = labelLower.endsWith("s") ? labelLower : `${labelLower}s`;
        const singularLower =
          typeof singular === "string" && singular.length > 0
            ? singular.toLowerCase()
            : labelLower;
        const word = safeCount === 1 ? singularLower : plural;
        const accessibleText = `${displayCount} ${word} recorded during the latest tick`;
        const titleText =
          accessibleText.charAt(0).toUpperCase() + accessibleText.slice(1);

        item.setAttribute("aria-label", accessibleText);
        item.title = `${titleText}.`;
      } else if (typeof item.removeAttribute === "function") {
        item.removeAttribute("aria-label");
      }
    };

    updateItem(
      this.lifeEventsSummaryBirthItem,
      this.lifeEventsSummaryBirthCount,
      birthCount,
    );
    updateItem(
      this.lifeEventsSummaryDeathItem,
      this.lifeEventsSummaryDeathCount,
      deathCount,
    );

    const total =
      Number.isFinite(totalCount) && totalCount >= 0
        ? totalCount
        : Math.max(0, (birthCount || 0) + (deathCount || 0));

    this.lifeEventsSummary.classList.toggle("life-events-summary--empty", total === 0);

    const netSource = Number.isFinite(trend?.net)
      ? Math.round(trend.net)
      : Math.round((birthCount || 0) - (deathCount || 0));
    const eventsPer100 = Number.isFinite(trend?.eventsPer100Ticks)
      ? trend.eventsPer100Ticks
      : 0;

    if (this.lifeEventsSummaryTrend) {
      const trendEl = this.lifeEventsSummaryTrend;

      trendEl.classList.toggle("life-events-summary__trend--positive", netSource > 0);
      trendEl.classList.toggle("life-events-summary__trend--negative", netSource < 0);
      trendEl.classList.toggle("life-events-summary__trend--neutral", netSource === 0);

      const directionText =
        netSource > 0 ? "Growing" : netSource < 0 ? "Declining" : "Stable";

      if (this.lifeEventsSummaryDirection) {
        this.lifeEventsSummaryDirection.textContent = directionText;
      }

      const netLabel =
        netSource > 0
          ? `Net increase of ${netSource}`
          : netSource < 0
            ? `Net decrease of ${Math.abs(netSource)}`
            : "Net change of 0";
      const rateLabel =
        Number.isFinite(eventsPer100) && eventsPer100 > 0
          ? `${eventsPer100.toFixed(1)} events per 100 ticks`
          : "No recent events per 100 ticks";

      trendEl.setAttribute("aria-label", `${netLabel}; ${rateLabel}`);
      trendEl.title = `${netLabel}. ${rateLabel}.`;
    }

    if (this.lifeEventsSummaryNet) {
      const formattedNet = Number.isFinite(netSource)
        ? netSource > 0
          ? `+${netSource.toLocaleString()}`
          : netSource.toLocaleString()
        : "0";

      this.lifeEventsSummaryNet.textContent = formattedNet;
    }

    if (this.lifeEventsSummaryRate) {
      if (Number.isFinite(eventsPer100) && eventsPer100 > 0) {
        const formattedEvents = eventsPer100.toFixed(1);

        this.lifeEventsSummaryRate.textContent = `Rolling 100-tick avg: ≈${formattedEvents} events per 100 ticks`;
      } else {
        this.lifeEventsSummaryRate.textContent =
          "Rolling 100-tick avg: no events per 100 ticks";
      }
    }
  }

  #renderLifeEventTimeline(timeline) {
    if (!this.lifeEventsTimelineCanvas) {
      return;
    }

    const canvas = this.lifeEventsTimelineCanvas;
    const summaryMessage = this.lifeEventsTimelineSummaryMessage;
    const statsGroup = this.lifeEventsTimelineStats;
    const windowStat = this.lifeEventsTimelineWindowStat;
    const birthStat = this.lifeEventsTimelineBirthStat;
    const deathStat = this.lifeEventsTimelineDeathStat;
    const emptyState = this.lifeEventsTimelineEmptyState;
    const ctx = canvas.getContext("2d");
    const defaultCanvasLabel =
      "Birth and death cadence across the recent observation window";
    const setCanvasLabel = (text) => {
      if (!canvas) return;

      const label =
        typeof text === "string" && text.trim().length > 0
          ? text.trim()
          : defaultCanvasLabel;

      canvas.setAttribute("aria-label", label);
    };

    const resetStats = () => {
      if (statsGroup) {
        statsGroup.hidden = true;
      }
      if (windowStat) {
        windowStat.valueEl.textContent = "—";
        windowStat.noteEl.textContent = windowStat.defaultNote;
      }
      if (birthStat) {
        birthStat.valueEl.textContent = "—";
        birthStat.noteEl.textContent = birthStat.defaultNote;
      }
      if (deathStat) {
        deathStat.valueEl.textContent = "—";
        deathStat.noteEl.textContent = deathStat.defaultNote;
      }
    };

    if (!ctx) {
      if (summaryMessage) {
        summaryMessage.textContent = LIFE_EVENT_TIMELINE_EMPTY_MESSAGE;
      }
      resetStats();
      if (emptyState) emptyState.hidden = false;
      setCanvasLabel(defaultCanvasLabel);

      return;
    }

    const buckets = Array.isArray(timeline?.buckets) ? timeline.buckets : [];
    const bucketSpan =
      Number.isFinite(timeline?.bucketSize) && timeline.bucketSize > 0
        ? Math.floor(timeline.bucketSize)
        : LIFE_EVENT_TIMELINE_MIN_BUCKET_SIZE;
    const totalBirths = Number.isFinite(timeline?.totalBirths)
      ? Math.max(0, Math.floor(timeline.totalBirths))
      : buckets.reduce(
          (sum, bucket) => sum + Math.max(0, Math.floor(bucket?.births || 0)),
          0,
        );
    const totalDeaths = Number.isFinite(timeline?.totalDeaths)
      ? Math.max(0, Math.floor(timeline.totalDeaths))
      : buckets.reduce(
          (sum, bucket) => sum + Math.max(0, Math.floor(bucket?.deaths || 0)),
          0,
        );
    const maxBirths = Number.isFinite(timeline?.maxBirths)
      ? Math.max(0, Math.floor(timeline.maxBirths))
      : buckets.reduce(
          (max, bucket) =>
            bucket && Number.isFinite(bucket.births) && bucket.births > max
              ? Math.floor(bucket.births)
              : max,
          0,
        );
    const maxDeaths = Number.isFinite(timeline?.maxDeaths)
      ? Math.max(0, Math.floor(timeline.maxDeaths))
      : buckets.reduce(
          (max, bucket) =>
            bucket && Number.isFinite(bucket.deaths) && bucket.deaths > max
              ? Math.floor(bucket.deaths)
              : max,
          0,
        );
    const maxCount = Math.max(maxBirths, maxDeaths);
    const windowTicks =
      Number.isFinite(timeline?.window) && timeline.window > 0
        ? Math.round(timeline.window)
        : Math.max(1, bucketSpan * Math.max(1, buckets.length));
    const bucketSizeLabel =
      bucketSpan === 1 ? "1 tick" : `${bucketSpan.toLocaleString()} ticks`;
    const perBucketLabel =
      bucketSpan === 1 ? "per tick" : `per ${bucketSpan.toLocaleString()}-tick bucket`;

    if (summaryMessage) {
      if (maxCount > 0) {
        summaryMessage.textContent = `Last ${windowTicks.toLocaleString()} ticks of births and deaths.`;
      } else {
        summaryMessage.textContent = LIFE_EVENT_TIMELINE_EMPTY_MESSAGE;
      }
    }

    if (statsGroup) {
      if (maxCount > 0) {
        statsGroup.hidden = false;
        if (windowStat) {
          windowStat.valueEl.textContent = `${windowTicks.toLocaleString()} ticks`;
          windowStat.noteEl.textContent = `Bucket size: ${bucketSizeLabel}`;
        }
        if (birthStat) {
          birthStat.valueEl.textContent = totalBirths.toLocaleString();
          birthStat.noteEl.textContent = `Peak ${Math.max(0, maxBirths).toLocaleString()} ${perBucketLabel}`;
        }
        if (deathStat) {
          deathStat.valueEl.textContent = totalDeaths.toLocaleString();
          deathStat.noteEl.textContent = `Peak ${Math.max(0, maxDeaths).toLocaleString()} ${perBucketLabel}`;
        }
      } else {
        resetStats();
      }
    }

    if (maxCount > 0) {
      const peakBirthText = Math.max(0, maxBirths).toLocaleString();
      const peakDeathText = Math.max(0, maxDeaths).toLocaleString();
      const totalBirthText = totalBirths.toLocaleString();
      const totalDeathText = totalDeaths.toLocaleString();
      const labelSegments = [
        `Birth and death cadence over the last ${windowTicks.toLocaleString()} ticks.`,
        `Totals: ${totalBirthText} births and ${totalDeathText} deaths.`,
      ];

      if (maxBirths > 0 || maxDeaths > 0) {
        labelSegments.push(
          `Peak births ${peakBirthText} ${perBucketLabel}, peak deaths ${peakDeathText} ${perBucketLabel}.`,
        );
      }

      setCanvasLabel(labelSegments.join(" "));
    } else {
      setCanvasLabel("No life events recorded in the observed window yet.");
    }

    const rect =
      typeof canvas.getBoundingClientRect === "function"
        ? canvas.getBoundingClientRect()
        : null;
    const cssWidth =
      rect && rect.width > 0
        ? rect.width
        : canvas.clientWidth > 0
          ? canvas.clientWidth
          : canvas.width > 0
            ? canvas.width
            : LIFE_EVENT_TIMELINE_CANVAS.width;
    const cssHeight =
      rect && rect.height > 0
        ? rect.height
        : canvas.clientHeight > 0
          ? canvas.clientHeight
          : canvas.height > 0
            ? canvas.height
            : LIFE_EVENT_TIMELINE_CANVAS.height;
    const rawPixelRatio =
      typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
        ? window.devicePixelRatio
        : Number.isFinite(globalThis?.devicePixelRatio)
          ? globalThis.devicePixelRatio
          : 1;
    const pixelRatio = Math.max(1, Math.min(4, rawPixelRatio));
    const renderWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const renderHeight = Math.max(1, Math.round(cssHeight * pixelRatio));

    if (canvas.width !== renderWidth || canvas.height !== renderHeight) {
      canvas.width = renderWidth;
      canvas.height = renderHeight;
    }

    ctx.save();
    ctx.scale(pixelRatio, pixelRatio);
    const width = renderWidth / pixelRatio;
    const height = renderHeight / pixelRatio;

    ctx.clearRect(0, 0, width, height);

    if (maxCount > 0) {
      canvas.setAttribute(
        "aria-label",
        `Birth and death cadence across the last ${windowTicks.toLocaleString()} ticks.`,
      );
      canvas.removeAttribute("aria-hidden");
    } else {
      canvas.setAttribute(
        "aria-label",
        "Birth and death cadence will appear once events are recorded.",
      );
      canvas.setAttribute("aria-hidden", "true");
      resetStats();
    }

    if (emptyState) {
      emptyState.hidden = maxCount > 0;
    }

    const paddingX = 16;
    const paddingY = 10;
    const chartWidth = Math.max(0, width - paddingX * 2);
    const chartHeight = Math.max(0, height - paddingY * 2);
    const baseline = Math.round(paddingY + chartHeight / 2) + 0.5;

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(paddingX, baseline);
    ctx.lineTo(width - paddingX, baseline);
    ctx.stroke();

    if (!(maxCount > 0 && buckets.length > 0)) {
      ctx.restore();

      return;
    }

    const birthColor = this.#resolveCssColor("--color-life-birth", "#4caf50");
    const deathColor = this.#resolveCssColor("--color-life-death", "#e74c3c");
    const scale = chartHeight > 0 ? chartHeight / 2 / maxCount : 0;
    const spacing = buckets.length > 1 ? chartWidth / (buckets.length - 1) : 0;
    const barWidth =
      buckets.length > 1
        ? Math.max(4, Math.min(18, spacing * 0.5))
        : Math.min(48, chartWidth * 0.6);

    const hasMultipleBuckets = buckets.length > 1;
    const resolveCenterX = hasMultipleBuckets
      ? (index) => paddingX + spacing * index
      : () => paddingX + chartWidth / 2;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();

    let isFirstPoint = true;

    for (const [index, rawBucket] of buckets.entries()) {
      const bucket = rawBucket ?? {};
      const centerX = resolveCenterX(index);
      const rawBirths = Number.isFinite(bucket.births) ? bucket.births : 0;
      const rawDeaths = Number.isFinite(bucket.deaths) ? bucket.deaths : 0;
      const births = Math.max(0, rawBirths);
      const deaths = Math.max(0, rawDeaths);

      if (births > 0) {
        const heightPx = births * scale;

        ctx.fillStyle = birthColor;
        ctx.fillRect(centerX - barWidth / 2, baseline - heightPx, barWidth, heightPx);
      }

      if (deaths > 0) {
        const heightPx = deaths * scale;

        ctx.fillStyle = deathColor;
        ctx.fillRect(centerX - barWidth / 2, baseline, barWidth, heightPx);
      }

      const net = rawBirths - rawDeaths;
      const y = baseline - clamp(net, -maxCount, maxCount) * scale;

      if (isFirstPoint) {
        ctx.moveTo(centerX, y);
        isFirstPoint = false;
      } else {
        ctx.lineTo(centerX, y);
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  #renderLifeEvents(stats, metrics = null) {
    if (!this.lifeEventList) return;

    const events =
      typeof stats?.getRecentLifeEvents === "function"
        ? stats.getRecentLifeEvents(12)
        : [];
    const trendSummary =
      typeof stats?.getLifeEventRateSummary === "function"
        ? stats.getLifeEventRateSummary()
        : null;
    const deathBreakdown =
      metrics?.deathBreakdown != null ? metrics.deathBreakdown : stats?.deathBreakdown;

    const windowCandidate = Number.isFinite(trendSummary?.window)
      ? Math.max(1, Math.round(trendSummary.window))
      : LIFE_EVENT_TIMELINE_DEFAULT_WINDOW;
    const bucketEstimate = Math.max(
      1,
      Math.round(windowCandidate / LIFE_EVENT_TIMELINE_TARGET_BUCKETS),
    );
    const bucketSize = Math.min(
      Math.max(bucketEstimate, LIFE_EVENT_TIMELINE_MIN_BUCKET_SIZE),
      windowCandidate,
    );
    let timeline = null;

    if (typeof stats?.getLifeEventTimeline === "function") {
      timeline = stats.getLifeEventTimeline(windowCandidate, bucketSize);
    } else if (
      metrics?.lifeEventTimeline &&
      typeof metrics.lifeEventTimeline === "object"
    ) {
      timeline = metrics.lifeEventTimeline;
    }

    this.#renderLifeEventTimeline(timeline);

    this.lifeEventList.innerHTML = "";

    if (!events || events.length === 0) {
      const fallbackDeaths =
        Number.isFinite(trendSummary?.deaths) && trendSummary.deaths >= 0
          ? trendSummary.deaths
          : 0;

      this.#updateDeathBreakdown(deathBreakdown, fallbackDeaths);
      this.#updateLifeEventsSummary(0, 0, 0, trendSummary);
      this.lifeEventList.hidden = true;
      if (this.lifeEventsEmptyState) {
        this.lifeEventsEmptyState.hidden = false;
      }

      return;
    }

    let birthCount = 0;
    let deathCount = 0;

    this.lifeEventList.hidden = false;
    if (this.lifeEventsEmptyState) {
      this.lifeEventsEmptyState.hidden = true;
    }

    events.forEach((event) => {
      if (event?.type === "birth") birthCount += 1;
      else if (event?.type === "death") deathCount += 1;

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

    this.#updateDeathBreakdown(deathBreakdown, deathCount);

    const summaryBirths =
      Number.isFinite(trendSummary?.births) && trendSummary.births >= 0
        ? trendSummary.births
        : birthCount;
    const summaryDeaths =
      Number.isFinite(trendSummary?.deaths) && trendSummary.deaths >= 0
        ? trendSummary.deaths
        : deathCount;
    const summaryTotal =
      Number.isFinite(trendSummary?.total) && trendSummary.total >= 0
        ? trendSummary.total
        : events.length;

    this.#updateLifeEventsSummary(
      summaryBirths,
      summaryDeaths,
      summaryTotal,
      trendSummary,
    );
  }

  // Utility to create a collapsible panel with a header
  #createPanel(title, options = {}) {
    const { collapsed = false, onToggle = null } = options;

    this._panelIdSequence = (this._panelIdSequence ?? 0) + 1;
    const headingId = `panel-${this._panelIdSequence}-title`;
    const bodyId = `panel-${this._panelIdSequence}-body`;
    const panel = document.createElement("div");

    panel.className = "panel";
    panel.style.maxWidth = "100%";
    panel.style.overflowX = "hidden";
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

    const setCollapsed = (shouldCollapse, { silent = false } = {}) => {
      panel.classList.toggle("collapsed", shouldCollapse);
      panel.classList.toggle("expanded", !shouldCollapse);
      toggle.textContent = shouldCollapse ? "+" : "–";
      toggle.setAttribute("aria-expanded", shouldCollapse ? "false" : "true");
      if (!silent && typeof onToggle === "function") {
        try {
          onToggle(!shouldCollapse, panel);
        } catch (error) {
          warnOnce(`Panel toggle handler for "${title}" threw.`, error);
        }
      }
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

    setCollapsed(Boolean(collapsed), { silent: true });

    return { panel, header, heading, toggle, body };
  }

  #isPanelCollapsed(panel) {
    return !panel || panel.classList.contains("collapsed");
  }

  #flushPendingMetrics() {
    if (!this._pendingMetrics || this.#isPanelCollapsed(this.insightsPanel)) return;
    const { stats, snapshot, environment } = this._pendingMetrics;

    this._pendingMetrics = null;
    this.renderMetrics(stats, snapshot, environment);
  }

  #flushPendingLeaderboard() {
    if (!this._pendingLeaderboardEntries || this.#isPanelCollapsed(this.leaderPanel)) {
      return;
    }
    const entries = this._pendingLeaderboardEntries;

    this._pendingLeaderboardEntries = null;
    this.renderLeaderboard(entries);
  }

  #flushPendingLifeEvents() {
    if (!this._pendingLifeEventsStats || this.#isPanelCollapsed(this.lifeEventsPanel)) {
      return;
    }
    const pending = this._pendingLifeEventsStats;

    this._pendingLifeEventsStats = null;
    if (
      pending &&
      typeof pending === "object" &&
      ("stats" in pending || "metrics" in pending)
    ) {
      this.#renderLifeEvents(pending.stats, pending.metrics);
    } else {
      this.#renderLifeEvents(pending);
    }
  }

  #buildControlsPanel() {
    const { panel, body } = this.#createPanel("Simulation Controls", {
      collapsed: true,
    });

    panel.id = "controls";
    panel.classList.add("controls-panel");

    this.#buildControlButtons(body);
    this.#buildGeometryControls(body);

    const sliderContext = this.#buildSliderGroups(body);

    this.#buildOverlayToggles(body);

    this.#buildObstacleControls(body);

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
      button.type = "button";
      button.addEventListener("click", (event) => {
        if (typeof onClick === "function") onClick(event);
      });
      buttonRow.appendChild(button);

      return button;
    };

    const pauseHotkeys = this.#formatPauseHotkeys();
    const pauseTitle =
      pauseHotkeys.length > 0
        ? `Pause/resume the simulation (shortcut: ${pauseHotkeys})`
        : "Pause/resume the simulation.";

    this.pauseButton = addControlButton({
      id: "pauseButton",
      label: "Pause",
      title: pauseTitle,
      onClick: () => this.togglePause(),
    });
    this.#applyButtonHotkeys(this.pauseButton, this.pauseHotkeySet);
    this.#updatePauseButtonState();

    this.stepButton = addControlButton({
      id: "stepButton",
      label: "Step",
      title: "Advance one tick while paused to inspect changes frame-by-frame.",
      onClick: () => {
        this.#executeStep();
      },
    });
    this.#applyButtonHotkeys(this.stepButton, this.stepHotkeySet);
    this.#updateStepButtonState();

    const burstHotkeys = this.#formatHotkeyList(this.burstHotkeySet);
    const burstTitlePieces = ["Spawn a cluster of new cells at a random spot."];

    if (burstHotkeys.length > 0) {
      burstTitlePieces.push(`Shortcut: ${burstHotkeys}.`);
    }

    const burstShiftHint = this.#resolveBurstHint({
      includeShortcut: burstHotkeys.length > 0,
    });

    if (burstShiftHint) {
      burstTitlePieces.push(burstShiftHint);
    }

    const burstTitle = burstTitlePieces.join(" ");

    this.burstButton = addControlButton({
      id: "burstButton",
      label: "Burst New Cells",
      title: burstTitle,
      onClick: (event) => {
        this.#triggerBurst({ shiftKey: Boolean(event?.shiftKey) });
      },
    });

    this.burstButton.setAttribute("aria-label", burstTitle);
    this.#applyButtonHotkeys(this.burstButton, this.burstHotkeySet);

    this.resetWorldButton = addControlButton({
      id: "resetWorldButton",
      label: "Regenerate World",
      title:
        "Clear the map and spawn a fresh population. Hold Shift to randomize obstacle layouts.",
      onClick: (event) => {
        const randomizeObstacles = Boolean(event?.shiftKey);
        const options = {
          randomizeObstacles,
        };
        const busyActivated = this.#setResetWorldBusy(true, { randomizeObstacles });

        if (!busyActivated) return;

        try {
          if (typeof this.simulationCallbacks?.resetWorld === "function") {
            this.simulationCallbacks.resetWorld(options);
          } else if (window.simulationEngine?.resetWorld) {
            window.simulationEngine.resetWorld(options);
          }
        } finally {
          this.#updateZoneSummary();
          this.#scheduleUpdate();
          this.#releaseResetWorldBusy();
        }
      },
    });

    if (this.resetWorldButton) {
      this.resetWorldButton.setAttribute("aria-live", "polite");

      if (!this.resetWorldButtonDefaults) {
        const defaultLabel = this.resetWorldButton.textContent || "Regenerate World";
        const defaultTitle = this.resetWorldButton.title || defaultLabel;
        const defaultAria = this.#readElementAttribute(
          this.resetWorldButton,
          "aria-label",
        );

        this.resetWorldButtonDefaults = {
          label: defaultLabel,
          title: defaultTitle,
          ariaLabel: defaultAria,
        };
      }
    }

    const speedBounds = UI_SLIDER_CONFIG?.speedMultiplier || {};
    const speedMin = speedBounds.min ?? 0.5;
    const speedMax = speedBounds.max ?? 100;
    const speedStep = speedBounds.step ?? 0.5;
    const normalizedSpeedStep =
      Number.isFinite(speedStep) && speedStep > 0 ? speedStep : 0.5;
    const speedHotkeyHint = this.#buildSpeedHotkeyHint();

    this.playbackSpeedSlider = createSliderRow(body, {
      label: "Playback Speed ×",
      min: speedMin,
      max: speedMax,
      step: normalizedSpeedStep,
      value: this.speedMultiplier,
      title: speedHotkeyHint,
      format: (v) => this.#formatSpeedDisplay(v),
      onInput: (value) => {
        this.#setSpeedMultiplier(value);
      },
    });
    this.#registerSliderElement("speedMultiplier", this.playbackSpeedSlider);
    this.speedStep = normalizedSpeedStep;

    const speedPresetRow = createControlButtonRow(body, {
      className: "control-button-row control-button-row--compact",
    });

    speedPresetRow.setAttribute("role", "group");
    speedPresetRow.setAttribute("aria-label", "Playback speed presets");

    const baseUpdates =
      this.baseUpdatesPerSecond > 0
        ? this.baseUpdatesPerSecond
        : (SIMULATION_DEFAULTS.updatesPerSecond ?? 60);
    const describeSpeedPreset = (multiplier) => {
      const display = this.#formatSpeedDisplay(multiplier);
      const updates = Number.isFinite(baseUpdates)
        ? Math.round(baseUpdates * multiplier)
        : 0;
      const updatesText = updates > 0 ? ` (~${updates} updates/sec)` : "";

      return `Set playback speed to ${display}${updatesText}.`;
    };

    const speedPresets = [
      { label: "0.5×", value: 0.5 },
      { label: "1×", value: 1 },
      { label: "2×", value: 2 },
      { label: "4×", value: 4 },
    ];

    this.speedPresetButtons = [];

    speedPresets.forEach(({ label, value }) => {
      const button = document.createElement("button");

      button.type = "button";
      button.textContent = label;
      button.title = describeSpeedPreset(value);
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        this.#setSpeedMultiplier(value);
      });
      speedPresetRow.appendChild(button);
      this.speedPresetButtons.push({ value, button });
    });

    this.#updateSpeedMultiplierUI(this.speedMultiplier);

    this.autoPauseCheckbox = this.#addCheckbox(
      body,
      "Pause When Hidden",
      { title: AUTO_PAUSE_DESCRIPTION, description: AUTO_PAUSE_DESCRIPTION },
      this.autoPauseOnBlur,
      (checked) => {
        this.setAutoPauseOnBlur(checked);
      },
    );
  }

  #buildGeometryControls(body) {
    if (typeof this.setWorldGeometry !== "function") return;

    createSectionHeading(body, "Grid Geometry");

    const geometryGrid = createControlGrid(body, "control-grid--compact");
    const geometry = this.#normalizeGeometryValues({
      cellSize: this.currentCellSize,
      rows: this.gridRows,
      cols: this.gridCols,
    });

    const bounds = GRID_GEOMETRY_BOUNDS;

    const cellSizeInput = createNumberInputRow(geometryGrid, {
      label: "Cell Size",
      title: "Pixels used to render each grid cell (2..20)",
      min: bounds.cellSize.min,
      max: bounds.cellSize.max,
      step: bounds.cellSize.step,
      value: geometry.cellSize,
      suffix: "px",
      description: "Pixels per tile. Enter a value between 2 and 20.",
    });

    const rowsInput = createNumberInputRow(geometryGrid, {
      label: "Rows",
      title: "Number of cell rows in the grid (40..240)",
      min: bounds.rows.min,
      max: bounds.rows.max,
      step: bounds.rows.step,
      value: geometry.rows,
      suffix: "tiles",
      description: "Vertical tiles allowed: 40 to 240.",
    });

    const colsInput = createNumberInputRow(geometryGrid, {
      label: "Columns",
      title: "Number of cell columns in the grid (40..240)",
      min: bounds.cols.min,
      max: bounds.cols.max,
      step: bounds.cols.step,
      value: geometry.cols,
      suffix: "tiles",
      description: "Horizontal tiles allowed: 40 to 240.",
    });

    const actions = document.createElement("div");

    actions.className = "geometry-actions";
    actions.style.gridColumn = "1 / -1";

    const applyButton = document.createElement("button");

    applyButton.type = "button";
    applyButton.className = "geometry-actions__apply";
    applyButton.textContent = "Apply Geometry";
    applyButton.title = "Resize the grid using the values above.";
    applyButton.addEventListener("click", (event) => {
      const request = {
        cellSize: Number.parseFloat(cellSizeInput.value),
        rows: Number.parseFloat(rowsInput.value),
        cols: Number.parseFloat(colsInput.value),
      };
      const reseed = Boolean(event?.shiftKey);
      const previous = {
        cellSize: this.currentCellSize,
        rows: this.gridRows,
        cols: this.gridCols,
      };
      const targetPreview = this.#normalizeGeometryValues(request, previous, {
        clampToBounds: false,
      });

      if (!this.#setGeometryBusy(true, { reseed, target: targetPreview })) {
        return;
      }

      const execute = () => {
        let applied = null;

        try {
          applied = this.#applyWorldGeometry(request, { reseed });
        } finally {
          this.#setGeometryBusy(false, {
            applied,
            raw: request,
            reseed,
            previous,
          });
        }
      };

      const raf =
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame.bind(window)
          : null;

      if (raf) raf(() => execute());
      else execute();
    });
    actions.appendChild(applyButton);

    const applyDescriptionId = "geometry-apply-description";
    const applyDescription = document.createElement("span");

    applyDescription.id = applyDescriptionId;
    applyDescription.className = "visually-hidden";
    applyDescription.textContent = "Resize the grid using the values above.";
    actions.appendChild(applyDescription);

    const reseedHintId = "geometry-reseed-hint";
    const reseedHint = document.createElement("span");

    reseedHint.id = reseedHintId;
    reseedHint.className = "geometry-actions__hint control-hint";
    reseedHint.textContent = "Shift + click to reseed the world after resizing.";
    actions.appendChild(reseedHint);

    applyButton.setAttribute(
      "aria-describedby",
      `${applyDescriptionId} ${reseedHintId}`.trim(),
    );

    geometryGrid.appendChild(actions);
    applyButton.disabled = true;
    applyButton.setAttribute("aria-disabled", "true");

    const summary = document.createElement("div");

    summary.className = "geometry-summary";
    summary.style.gridColumn = "1 / -1";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    summary.setAttribute("aria-atomic", "true");
    summary.setAttribute("aria-busy", "false");

    const summaryHeader = document.createElement("div");

    summaryHeader.className = "geometry-summary__header";

    const summaryTitle = document.createElement("span");

    summaryTitle.className = "geometry-summary__title";
    summaryTitle.textContent = "Preview";

    const summaryStatus = document.createElement("span");

    summaryStatus.className = "geometry-summary__status";
    summaryStatus.textContent = "Current";

    summaryHeader.appendChild(summaryTitle);
    summaryHeader.appendChild(summaryStatus);
    summary.appendChild(summaryHeader);

    const summaryGrid = document.createElement("dl");

    summaryGrid.className = "geometry-summary__grid";

    const createSummaryValue = (labelText) => {
      const labelEl = document.createElement("dt");

      labelEl.className = "geometry-summary__label";
      labelEl.textContent = labelText;
      const valueEl = document.createElement("dd");

      valueEl.className = "geometry-summary__value";
      valueEl.textContent = "—";
      summaryGrid.appendChild(labelEl);
      summaryGrid.appendChild(valueEl);

      return valueEl;
    };

    const cellsValueEl = createSummaryValue("Grid (cells)");
    const pixelsValueEl = createSummaryValue("Canvas (px)");

    summary.appendChild(summaryGrid);

    const summaryNote = document.createElement("p");

    summaryNote.className = "geometry-summary__note";
    summaryNote.textContent = "Preview updates as you edit. Apply to confirm changes.";
    summary.appendChild(summaryNote);

    geometryGrid.appendChild(summary);

    const defaultAriaLabel =
      this.#readElementAttribute(applyButton, "aria-label") ||
      applyButton.textContent ||
      applyButton.title;

    this.geometryControls = {
      cellSizeInput,
      rowsInput,
      colsInput,
      applyButton,
      applyButtonDefaultLabel: applyButton.textContent,
      applyButtonDefaultTitle: applyButton.title,
      applyButtonDefaultAriaLabel: defaultAriaLabel,
      summaryEl: summary,
      summaryStatusEl: summaryStatus,
      summaryNoteEl: summaryNote,
      summaryDefaultNote: summaryNote.textContent,
      previewCellsEl: cellsValueEl,
      previewPixelsEl: pixelsValueEl,
      geometryBusy: false,
    };

    const handlePreviewChange = () => {
      const parseState = (input) => {
        const text = String(input.value ?? "").trim();
        const value = Number.parseFloat(input.value);

        return { text, value };
      };

      const cellSizeState = parseState(cellSizeInput);
      const rowsState = parseState(rowsInput);
      const colsState = parseState(colsInput);
      const states = [cellSizeState, rowsState, colsState];
      const hasEmpty = states.some(({ text }) => text === "");
      const hasInvalid = states.some(
        ({ text, value }) => text !== "" && !Number.isFinite(value),
      );

      const raw = {
        cellSize: cellSizeState.value,
        rows: rowsState.value,
        cols: colsState.value,
      };

      this.#updateGeometrySummary(raw, { raw, hasEmpty, hasInvalid });
    };

    [cellSizeInput, rowsInput, colsInput].forEach((input) => {
      input.addEventListener("input", handlePreviewChange);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          applyButton.click();
        }
      });
    });

    this.#updateGeometryInputs(geometry);
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
        key,
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

    const renderSlider = (cfg, parent = body) => {
      const input = createSliderRow(parent, {
        label: cfg.label,
        min: cfg.min,
        max: cfg.max,
        step: cfg.step,
        value: getSliderValue(cfg),
        title: cfg.title,
        format: cfg.format,
        onInput: getSliderSetter(cfg),
      });

      if (cfg?.key) {
        this.#registerSliderElement(cfg.key, input);
      }

      return input;
    };

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
        format: (v) => this.#formatMultiplierDisplay(v, 2),
        getValue: () => this.eventStrengthMultiplier,
        setValue: (v) => this.#updateSetting("eventStrengthMultiplier", v),
      }),
      withSliderConfig("eventFrequencyMultiplier", {
        label: "Event Frequency ×",
        min: 0,
        max: 3,
        step: 0.1,
        title: "How often events spawn (0 disables new events)",
        format: (v) => this.#formatMultiplierDisplay(v, 1),
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
        format: (v) => this.#formatMultiplierDisplay(v, 2),
        getValue: () => this.densityEffectMultiplier,
        setValue: (v) => this.#updateSetting("densityEffectMultiplier", v),
      }),
      withSliderConfig("initialTileEnergyFraction", {
        label: "Empty Tile Energy",
        min: 0,
        max: 1,
        step: 0.05,
        title:
          "Fraction of the energy cap applied to empty tiles during resets and world refreshes (0..1)",
        format: (v) => `${Math.round(v * 100)}%`,
        getValue: () => this.initialTileEnergyFraction,
        setValue: (v) => this.setInitialTileEnergyFraction(v),
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

    const lowDiversitySliderConfig = withSliderConfig("lowDiversityReproMultiplier", {
      label: "Low Diversity Penalty ×",
      min: 0,
      max: 1,
      step: 0.05,
      title:
        "Multiplier applied to reproduction chance when diversity is below the threshold (0 disables births)",
      format: (v) => this.#formatMultiplierDisplay(v, 2),
      getValue: () => this.lowDiversityReproMultiplier,
      setValue: (v) => this.#updateSetting("lowDiversityReproMultiplier", v),
    });

    thresholdConfigs.push(lowDiversitySliderConfig);

    const generalConfigs = [
      withSliderConfig("mutationMultiplier", {
        label: "Mutation Rate ×",
        min: 0,
        max: 3,
        step: 0.05,
        title:
          "Scales averaged parental mutation chance and range for offspring (0 disables mutation)",
        format: (v) => this.#formatMultiplierDisplay(v, 2),
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
      withSliderConfig("combatTerritoryEdgeFactor", {
        label: "Territory Edge Influence",
        min: 0,
        max: 1,
        step: 0.05,
        title:
          "Scales how strongly density advantages sway combat outcomes (0 disables territory edge)",
        format: (v) => v.toFixed(2),
        getValue: () => this.combatTerritoryEdgeFactor,
        setValue: (v) => this.#updateSetting("combatTerritoryEdgeFactor", v),
        position: "beforeOverlays",
      }),
    ];

    this.leaderboardCadenceConfig = withSliderConfig("leaderboardIntervalMs", {
      label: "Dashboard Refresh Interval",
      min: 100,
      max: 3000,
      step: 50,
      title:
        "Delay between updating evolution insights and leaderboard summaries in milliseconds (100..3000)",
      format: (v) => `${Math.round(v)} ms`,
      getValue: () => this.leaderboardIntervalMs,
      setValue: (v) => this.#updateSetting("leaderboardIntervalMs", v),
    });

    createSectionHeading(body, "Similarity Thresholds");
    const thresholdsGroup = createControlGrid(body);

    thresholdConfigs.forEach((cfg) => {
      const input = renderSlider(cfg, thresholdsGroup);

      if (cfg.key === "lowDiversityReproMultiplier") {
        this.lowDiversitySlider = input;
      }
    });

    const thresholdsHint = document.createElement("p");

    thresholdsHint.className = "control-hint";
    thresholdsHint.textContent =
      "Tune how cells classify allies, enemies, and viable mates. Births below the diversity threshold use the penalty multiplier.";
    body.appendChild(thresholdsHint);

    createSectionHeading(body, "Environmental Events");
    const eventsGroup = createControlGrid(body);

    eventConfigs.forEach((cfg) => renderSlider(cfg, eventsGroup));

    createSectionHeading(body, "General Settings");
    const generalGroup = createControlGrid(body);

    generalConfigs
      .filter((cfg) => cfg.position === "beforeOverlays")
      .forEach((cfg) => {
        renderSlider(cfg, generalGroup);
      });

    const resetRow = createControlButtonRow(body);
    const resetButton = document.createElement("button");

    resetButton.type = "button";
    resetButton.textContent = "Restore Default Tuning";
    resetButton.title =
      "Reapply the canonical similarity, event, energy, mutation, combat, and cadence settings.";
    resetButton.addEventListener("click", () => {
      this.resetSimulationTuning();
    });
    resetRow.appendChild(resetButton);

    const resetHint = document.createElement("p");

    resetHint.className = "control-hint";
    resetHint.textContent =
      "Resets all sliders and playback speed to the project defaults for a clean baseline.";
    body.appendChild(resetHint);

    return {
      renderSlider,
      withSliderConfig,
      energyConfigs,
      generalConfigs,
      generalGroup,
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
        key: "showReproductiveZones",
        label: "Highlight Reproductive Zones",
        title:
          "Shade active reproductive zones so you can see which tiles permit mating",
        initial: this.showReproductiveZones,
      },
      {
        key: "showAuroraVeil",
        label: "Aurora Veil",
        title:
          "Wash the canvas with a gentle aurora ribbon that sways with the simulation clock",
        initial: this.showAuroraVeil,
      },
    ];

    overlayConfigs.forEach(({ key, label, title, initial }) => {
      this.#addCheckbox(overlayGrid, label, title, initial, (checked) => {
        this.#updateSetting(key, checked);
        this.#scheduleUpdate();
      });
    });
  }

  #buildObstacleControls(body) {
    createSectionHeading(body, "Obstacles", { className: "overlay-header" });

    const obstacleGrid = createControlGrid(body, "control-grid--compact");

    if (this.obstaclePresets.length > 0) {
      const applyPreset = (id) => {
        const args = [id, { clearExisting: true }];
        const resolveMessage = (presetId) =>
          `Obstacle preset handler threw while applying "${presetId}"; continuing with previous layout.`;

        if (typeof this.actions.applyObstaclePreset === "function") {
          invokeWithErrorBoundary(this.actions.applyObstaclePreset, args, {
            thisArg: this.actions,
            message: resolveMessage,
            reporter: warnOnce,
            once: true,
          });

          return;
        }

        if (typeof window === "undefined") return;

        const globalApply = window.grid?.applyObstaclePreset;

        if (typeof globalApply === "function") {
          invokeWithErrorBoundary(globalApply, args, {
            thisArg: window.grid,
            message: resolveMessage,
            reporter: warnOnce,
            once: true,
          });
        }
      };

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
          applyPreset(value);
        },
      });

      if (presetSelect?.options) {
        Array.from(presetSelect.options).forEach((opt) => {
          if (!opt.title && opt.textContent) opt.title = opt.textContent;
        });
      }

      const selectLine = presetSelect.closest(".control-line");
      const clearButton = document.createElement("button");

      clearButton.type = "button";
      clearButton.textContent = "Clear Obstacles";
      clearButton.title = "Remove all obstacles from the grid.";
      clearButton.addEventListener("click", () => {
        const openFieldPreset = this.obstaclePresets.find(
          (preset) => preset?.id === "none",
        );
        const clearedPreset =
          openFieldPreset?.id ?? this.obstaclePresets[0]?.id ?? "none";

        this.obstaclePreset = clearedPreset;
        if (presetSelect) presetSelect.value = clearedPreset;
        applyPreset(clearedPreset);
      });

      const shuffleButton = document.createElement("button");

      shuffleButton.type = "button";
      shuffleButton.textContent = "Shuffle Layout";
      shuffleButton.title = "Apply a random obstacle preset from the catalog.";
      shuffleButton.addEventListener("click", () => {
        const randomPresetId = this.#pickRandomObstaclePresetId();

        if (!randomPresetId) return;

        this.obstaclePreset = randomPresetId;
        if (presetSelect) presetSelect.value = randomPresetId;
        applyPreset(randomPresetId);
      });

      if (selectLine) {
        selectLine.classList.add("control-line--inline-actions");
        selectLine.appendChild(clearButton);
        selectLine.appendChild(shuffleButton);
      } else {
        obstacleGrid.appendChild(clearButton);
        obstacleGrid.appendChild(shuffleButton);
      }
    }
  }

  #buildReproductiveZoneTools(body) {
    if (!this.selectionManager) return;

    createSectionHeading(body, "Reproductive Zones", { className: "overlay-header" });

    const zoneIntro = document.createElement("p");

    zoneIntro.className = "zone-intro control-hint";
    zoneIntro.textContent =
      "Focus reproduction by enabling preset regions—from hemispheres to central sanctuaries—and combining patterns to guide evolution.";
    body.appendChild(zoneIntro);

    const zoneGrid = createControlGrid(body, "control-grid--compact");
    const patterns = this.selectionManager.getPatterns();

    patterns.forEach((pattern) => {
      const description =
        typeof pattern.description === "string" && pattern.description.trim().length > 0
          ? pattern.description
          : null;

      this.#addCheckbox(
        zoneGrid,
        pattern.name,
        { title: description || "", description, color: pattern.color },
        pattern.active,
        (checked) => {
          this.selectionManager.togglePattern(pattern.id, checked);
          this.#updateZoneSummary();
          this.#scheduleUpdate();
        },
      );
    });

    const summaryValue = document.createElement("div");

    summaryValue.className = "zone-summary";
    const summaryText = document.createElement("p");

    summaryText.className = "zone-summary-text";
    summaryText.id = "zone-summary-text";
    summaryValue.appendChild(summaryText);
    const summaryList = document.createElement("ul");

    summaryList.className = "zone-summary-tags";
    summaryList.setAttribute("role", "list");
    summaryList.hidden = true;
    summaryValue.appendChild(summaryList);

    const summaryRow = this.#appendControlRow(body, {
      label: "Active Zones",
      value: summaryValue,
      valueClass: "control-value--left",
    });

    this.zoneSummaryEl = summaryRow.querySelector(".control-value");
    this.zoneSummaryTextEl = summaryText;
    this.zoneSummaryList = summaryList;
    if (this.zoneSummaryEl) {
      this.zoneSummaryEl.id = "zone-summary";
      this.zoneSummaryEl.setAttribute("role", "status");
      this.zoneSummaryEl.setAttribute("aria-live", "polite");
      this.zoneSummaryEl.setAttribute("aria-describedby", summaryText.id);
    }

    this.#updateZoneSummary();
  }

  #buildEnergyAndGeneralTail(body, sliderContext) {
    createSectionHeading(body, "Energy Dynamics");
    const energyGroup = createControlGrid(body);

    sliderContext.energyConfigs.forEach((cfg) => {
      const input = sliderContext.renderSlider(cfg, energyGroup);

      if (cfg.key === "initialTileEnergyFraction") {
        this.initialTileEnergySlider = input;
      }
    });

    sliderContext.generalConfigs
      .filter((cfg) => cfg.position === "afterEnergy")
      .forEach((cfg) => sliderContext.renderSlider(cfg, sliderContext.generalGroup));
  }

  #buildDashboardSettingsPanel() {
    const cadenceConfig = this.leaderboardCadenceConfig;

    if (!cadenceConfig) return null;

    const { panel, body } = this.#createPanel("Dashboard Settings", {
      collapsed: true,
    });

    panel.classList.add("dashboard-settings-panel");

    const intro = document.createElement("p");

    intro.className = "metrics-intro";
    intro.textContent =
      "Tune how often Evolution Insights and the leaderboard refresh to match your inspection cadence.";
    body.appendChild(intro);

    const cadenceSection = document.createElement("section");

    cadenceSection.className = "metrics-controls";
    cadenceSection.setAttribute("aria-label", "Dashboard refresh cadence controls");

    createSectionHeading(cadenceSection, "Update Frequency");

    const cadenceGrid = createControlGrid(cadenceSection, "control-grid--compact");

    const slider = createSliderRow(cadenceGrid, {
      label: cadenceConfig.label,
      min: cadenceConfig.min,
      max: cadenceConfig.max,
      step: cadenceConfig.step,
      value: cadenceConfig.getValue(),
      title: cadenceConfig.title,
      format: cadenceConfig.format,
      onInput: cadenceConfig.setValue,
    });

    this.dashboardCadenceSlider = slider;
    this.#registerSliderElement("leaderboardIntervalMs", slider);

    const cadenceNote = document.createElement("p");

    cadenceNote.className = "control-hint";
    cadenceNote.textContent =
      "Controls how often Evolution Insights and the leaderboard request fresh data.";
    cadenceSection.appendChild(cadenceNote);

    body.appendChild(cadenceSection);

    return panel;
  }

  #buildInsightsPanel() {
    const { panel, body } = this.#createPanel("Evolution Insights", {
      collapsed: true,
      onToggle: (expanded) => {
        if (expanded) {
          this.#flushPendingMetrics();
        }
      },
    });

    const intro = document.createElement("p");

    intro.className = "metrics-intro";
    intro.textContent =
      "Track population health, energy, and behavioral trends as the simulation unfolds. Adjust the shared refresh cadence from Dashboard Settings whenever you need slower or faster updates.";
    body.appendChild(intro);

    this.metricsBox = document.createElement("div");
    this.metricsBox.className = "metrics-box";
    this.metricsBox.setAttribute("role", "status");
    this.metricsBox.setAttribute("aria-live", "polite");
    this.#showMetricsPlaceholder("Run the simulation to populate these metrics.");
    body.appendChild(this.metricsBox);

    const sparkSection = document.createElement("section");

    sparkSection.className = "metrics-section metrics-section--sparklines";
    sparkSection.setAttribute("aria-label", "Key population and energy trends");
    const sparkHeading = document.createElement("h4");

    sparkHeading.className = "metrics-section-title";
    sparkHeading.textContent = "Key Dynamics";
    sparkSection.appendChild(sparkHeading);

    const sparkHint = document.createElement("p");

    sparkHint.className = "sparkline-hint";
    sparkHint.textContent =
      "Monitor overall population, birth and death cadence, diversity, energy, and pacing as the world evolves.";
    sparkSection.appendChild(sparkHint);

    const sparkGrid = document.createElement("div");

    sparkGrid.className = "sparkline-grid";
    sparkSection.appendChild(sparkGrid);
    body.appendChild(sparkSection);

    const sparkDescriptors = [
      {
        label: "Population",
        property: "sparkPop",
        historyKey: "population",
        colorVar: "--color-metric-population",
        fallbackColor: "#4c9dff",
        description: "Total living cells over recent ticks.",
      },
      {
        label: "Birth Cadence",
        property: "sparkBirths",
        historyKey: "birthsPerTick",
        colorVar: "--color-metric-births",
        fallbackColor: "#9bda64",
        description: "Births recorded each tick.",
      },
      {
        label: "Death Cadence",
        property: "sparkDeaths",
        historyKey: "deathsPerTick",
        colorVar: "--color-metric-deaths",
        fallbackColor: "#ff6b81",
        description: "Deaths recorded each tick.",
      },
      {
        label: "Diversity",
        property: "sparkDiv2Canvas",
        historyKey: "diversity",
        colorVar: "--color-metric-diversity",
        fallbackColor: "#ff8c68",
        description: "Genetic variety (Shannon diversity index).",
      },
      {
        label: "Mean Energy",
        property: "sparkEnergy",
        historyKey: "energy",
        colorVar: "--color-metric-energy",
        fallbackColor: "#55efc4",
        description: "Average cell energy reserves.",
      },
      {
        label: "Growth",
        property: "sparkGrowth",
        historyKey: "growth",
        colorVar: "--color-metric-growth",
        fallbackColor: "#f5c669",
        description: "Births minus deaths per tick.",
      },
      {
        label: "Event Strength",
        property: "sparkEvent",
        historyKey: "eventStrength",
        colorVar: "--color-metric-event-strength",
        fallbackColor: "#b786ff",
        description: "Magnitude of current environmental events.",
      },
      {
        label: "Mutation Multiplier",
        property: "sparkMutation",
        historyKey: "mutationMultiplier",
        colorVar: "--color-metric-mutation",
        fallbackColor: "#ff6fb1",
        description: "Live mutation scaling factor.",
      },
      {
        label: "Diverse Pairing Rate",
        property: "sparkDiversePairing",
        historyKey: "diversePairingRate",
        colorVar: "--color-metric-diverse-pairing",
        fallbackColor: "#76d6ff",
        description: "Share of mating pairs exceeding the diversity threshold.",
      },
      {
        label: "Mean Diversity Appetite",
        property: "sparkDiversityAppetite",
        historyKey: "meanDiversityAppetite",
        colorVar: "--color-metric-diversity-appetite",
        fallbackColor: "#7edc8c",
        description: "Average desire for genetically novel partners.",
      },
    ];

    this.sparkMetricDescriptors = sparkDescriptors.map(
      ({ property, historyKey, colorVar, fallbackColor }) => ({
        property,
        historyKey,
        colorVar,
        fallbackColor,
      }),
    );

    sparkDescriptors.forEach(
      ({ label, property, colorVar, fallbackColor, description }) => {
        const card = document.createElement("div");
        const caption = document.createElement("div");
        const colorDot = document.createElement("span");
        const captionText = document.createElement("span");

        card.className = "sparkline-card";
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", `${label} trend`);
        if (description) card.title = description;
        caption.className = "sparkline-caption";
        colorDot.className = "sparkline-color-dot";
        if (colorVar) {
          colorDot.style.background = `var(${colorVar}, ${fallbackColor})`;
        } else if (fallbackColor) {
          colorDot.style.background = fallbackColor;
        }
        captionText.className = "sparkline-caption-text";
        captionText.textContent = label;
        caption.appendChild(colorDot);
        caption.appendChild(captionText);

        const canvas = document.createElement("canvas");

        canvas.className = "sparkline";
        canvas.width = 220;
        canvas.height = 48;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", `${label} trend over time`);
        if (description) {
          canvas.title = description;
        }

        card.appendChild(caption);
        card.appendChild(canvas);
        sparkGrid.appendChild(card);

        this[property] = canvas;
      },
    );

    const traitSection = document.createElement("section");

    traitSection.className = "metrics-section metrics-section--sparklines";
    traitSection.setAttribute("aria-label", "Trait expression trends");
    const traitHeading = document.createElement("h4");

    traitHeading.className = "metrics-section-title";
    traitHeading.textContent = "Trait Expressions";
    traitSection.appendChild(traitHeading);

    const traitHint = document.createElement("p");

    traitHint.className = "sparkline-hint";
    traitHint.textContent =
      "Compare how many cells embrace each trait against their average intensity.";
    traitSection.appendChild(traitHint);

    const traitGrid = document.createElement("div");

    traitGrid.className = "sparkline-grid sparkline-grid--traits";
    traitSection.appendChild(traitGrid);
    body.appendChild(traitSection);

    this.traitSparkGrid = traitGrid;

    return panel;
  }

  #buildLifeEventsPanel() {
    const { panel, body } = this.#createPanel("Life Event Log", {
      collapsed: true,
      onToggle: (expanded) => {
        if (expanded) {
          this.#flushPendingLifeEvents();
        }
      },
    });

    const overlayControls = document.createElement("section");

    overlayControls.className = "metrics-controls";
    overlayControls.setAttribute("aria-label", "Life event overlay visibility");

    createSectionHeading(overlayControls, "Map Overlay");

    const overlayGrid = createControlGrid(overlayControls, "control-grid--compact");

    this.lifeEventMarkersToggle = this.#addCheckbox(
      overlayGrid,
      "Life Event Markers",
      {
        title: LIFE_EVENT_MARKER_OVERLAY_DESCRIPTION,
        description: LIFE_EVENT_MARKER_OVERLAY_DESCRIPTION,
      },
      this.showLifeEventMarkers,
      (checked) => {
        this.#updateSetting("showLifeEventMarkers", checked);
        this.#scheduleUpdate();
      },
    );

    body.appendChild(overlayControls);

    const lifeEventsSection = document.createElement("section");

    lifeEventsSection.className = "metrics-section";

    const lifeHeading = document.createElement("h4");

    lifeHeading.className = "metrics-section-title";
    lifeHeading.textContent = "Recent Activity";
    lifeEventsSection.appendChild(lifeHeading);

    const lifeBody = document.createElement("div");

    lifeBody.className = "metrics-section-body life-events-body";

    const createSummaryItem = (label, modifierClass, description) => {
      const item = document.createElement("div");
      const normalizedClass = ["life-events-summary__item", modifierClass]
        .filter(Boolean)
        .join(" ");

      item.className = normalizedClass;
      item.setAttribute("role", "listitem");
      if (typeof item.setAttribute === "function") {
        if (typeof label === "string" && label.length > 0) {
          item.setAttribute("data-label", label);
          const singularCandidate = label.toLowerCase().endsWith("s")
            ? label.slice(0, -1)
            : label;

          item.setAttribute("data-singular", singularCandidate.toLowerCase());
        }
        if (description) {
          item.setAttribute("data-description", description);
        }
      }

      if (description) {
        item.title = description;
      }

      const textGroup = document.createElement("div");

      textGroup.className = "life-events-summary__text";
      const labelEl = document.createElement("span");

      labelEl.className = "life-events-summary__label";
      labelEl.textContent = label;
      const periodEl = document.createElement("span");

      periodEl.className = "life-events-summary__period";
      periodEl.textContent = "Latest tick";
      textGroup.appendChild(labelEl);
      textGroup.appendChild(periodEl);

      const countEl = document.createElement("span");

      countEl.className = "life-events-summary__count";
      countEl.textContent = "0";

      item.appendChild(textGroup);
      item.appendChild(countEl);

      return { item, countEl };
    };

    this.lifeEventsSummary = document.createElement("div");
    this.lifeEventsSummary.className = "life-events-summary";
    this.lifeEventsSummary.setAttribute("role", "list");
    this.lifeEventsSummary.setAttribute("aria-live", "polite");
    this.lifeEventsSummary.setAttribute(
      "aria-label",
      "Latest tick birth and death counts",
    );

    const birthsSummary = createSummaryItem(
      "Births",
      "life-events-summary__item--birth",
      "Births recorded during the latest tick.",
    );
    const deathsSummary = createSummaryItem(
      "Deaths",
      "life-events-summary__item--death",
      "Deaths recorded during the latest tick.",
    );

    this.lifeEventsSummaryBirthItem = birthsSummary.item;
    this.lifeEventsSummaryBirthCount = birthsSummary.countEl;
    this.lifeEventsSummaryDeathItem = deathsSummary.item;
    this.lifeEventsSummaryDeathCount = deathsSummary.countEl;

    this.lifeEventsSummary.appendChild(birthsSummary.item);
    this.lifeEventsSummary.appendChild(deathsSummary.item);

    const trendSummary = document.createElement("div");

    trendSummary.className =
      "life-events-summary__trend life-events-summary__trend--neutral";
    trendSummary.setAttribute("role", "group");
    trendSummary.setAttribute("aria-live", "polite");
    trendSummary.setAttribute("aria-label", "Net population change and event cadence");

    const trendHeader = document.createElement("div");

    trendHeader.className = "life-events-summary__trend-header";
    const trendLabel = document.createElement("span");

    trendLabel.className = "life-events-summary__trend-label";
    trendLabel.textContent = "Net change";
    const trendDirection = document.createElement("span");

    trendDirection.className = "life-events-summary__trend-direction";
    trendDirection.textContent = "Stable";
    trendHeader.appendChild(trendLabel);
    trendHeader.appendChild(trendDirection);

    const trendValues = document.createElement("div");

    trendValues.className = "life-events-summary__trend-values";
    const trendValue = document.createElement("span");

    trendValue.className = "life-events-summary__trend-value";
    trendValue.textContent = "+0";

    const trendRate = document.createElement("span");

    trendRate.className = "life-events-summary__trend-rate";
    trendRate.textContent = "Rolling 100-tick avg: none yet";

    trendValues.appendChild(trendValue);
    trendValues.appendChild(trendRate);

    trendSummary.appendChild(trendHeader);
    trendSummary.appendChild(trendValues);

    this.lifeEventsSummaryTrend = trendSummary;
    this.lifeEventsSummaryNet = trendValue;
    this.lifeEventsSummaryDirection = trendDirection;
    this.lifeEventsSummaryRate = trendRate;

    this.lifeEventsSummary.appendChild(trendSummary);
    lifeBody.appendChild(this.lifeEventsSummary);

    const timelineCard = document.createElement("figure");

    timelineCard.className = "life-events-timeline";
    timelineCard.setAttribute("role", "group");
    const timelineTitleId = `${body.id || "life-events"}-timeline-title`;

    timelineCard.setAttribute("aria-labelledby", timelineTitleId);

    const timelineTitle = document.createElement("h5");

    timelineTitle.className = "life-events-timeline__title";
    timelineTitle.textContent = "Birth & Death Cadence";
    timelineTitle.id = timelineTitleId;
    timelineCard.appendChild(timelineTitle);

    const timelineSummary = document.createElement("figcaption");

    timelineSummary.className = "life-events-timeline__summary";
    timelineSummary.setAttribute(
      "aria-label",
      "Summary of recent birth and death cadence",
    );

    const timelineSummaryMessage = document.createElement("p");

    timelineSummaryMessage.className =
      "life-events-timeline__summary-message control-hint";
    timelineSummaryMessage.textContent = LIFE_EVENT_TIMELINE_EMPTY_MESSAGE;
    const timelineSummaryMessageId = `${timelineTitleId}-summary`;

    timelineSummaryMessage.id = timelineSummaryMessageId;
    timelineSummaryMessage.setAttribute("role", "status");
    timelineSummaryMessage.setAttribute("aria-live", "polite");
    timelineSummaryMessage.setAttribute("aria-atomic", "true");
    timelineSummary.appendChild(timelineSummaryMessage);
    timelineCard.setAttribute("aria-describedby", timelineSummaryMessageId);

    const timelineStats = document.createElement("dl");

    timelineStats.className = "life-events-timeline__stats";
    timelineStats.setAttribute("aria-label", "Birth and death cadence summary");
    timelineStats.setAttribute("aria-live", "polite");
    timelineStats.hidden = true;

    const createTimelineStat = (label, noteText) => {
      const wrapper = document.createElement("div");

      wrapper.className = "life-events-timeline__stat";

      const term = document.createElement("dt");

      term.className = "life-events-timeline__stat-label";
      term.textContent = label;

      const metric = document.createElement("dd");

      metric.className = "life-events-timeline__stat-metric";
      const valueEl = document.createElement("span");

      valueEl.className = "life-events-timeline__stat-value";
      valueEl.textContent = "—";
      const noteEl = document.createElement("span");

      noteEl.className = "life-events-timeline__stat-note";
      noteEl.textContent = noteText;

      metric.appendChild(valueEl);
      metric.appendChild(noteEl);
      wrapper.appendChild(term);
      wrapper.appendChild(metric);
      timelineStats.appendChild(wrapper);

      return { valueEl, noteEl, defaultNote: noteText };
    };

    const windowStat = createTimelineStat("Window", "Bucket size: —");
    const birthStat = createTimelineStat("Births", "Peak — per bucket");
    const deathStat = createTimelineStat("Deaths", "Peak — per bucket");

    timelineSummary.appendChild(timelineStats);
    timelineCard.appendChild(timelineSummary);

    const timelineChart = document.createElement("div");

    timelineChart.className = "life-events-timeline__chart";
    const timelineCanvas = document.createElement("canvas");

    timelineCanvas.className = "life-events-timeline__canvas";
    timelineCanvas.width = LIFE_EVENT_TIMELINE_CANVAS.width;
    timelineCanvas.height = LIFE_EVENT_TIMELINE_CANVAS.height;
    timelineCanvas.setAttribute(
      "aria-label",
      "Birth and death cadence across the recent observation window",
    );
    timelineCanvas.setAttribute("role", "img");
    timelineChart.appendChild(timelineCanvas);
    timelineCard.appendChild(timelineChart);

    const timelineEmpty = document.createElement("p");

    timelineEmpty.className = "life-events-timeline__empty control-hint";
    timelineEmpty.textContent = "No events recorded in the recent window yet.";
    timelineCard.appendChild(timelineEmpty);

    const timelineLegend = document.createElement("div");

    timelineLegend.className = "life-events-timeline__legend";
    timelineLegend.setAttribute("role", "list");
    timelineLegend.setAttribute("aria-label", "Timeline legend");

    const createLegendItem = (label, modifierClass, colorVar, fallbackColor) => {
      const item = document.createElement("span");

      item.className = ["life-events-timeline__legend-item", modifierClass]
        .filter(Boolean)
        .join(" ");
      item.setAttribute("role", "listitem");

      const swatch = document.createElement("span");

      swatch.className = "life-events-timeline__legend-swatch";
      if (colorVar) {
        swatch.style.background = `var(${colorVar}, ${fallbackColor})`;
      } else if (fallbackColor) {
        swatch.style.background = fallbackColor;
      }

      const text = document.createElement("span");

      text.className = "life-events-timeline__legend-label";
      text.textContent = label;

      item.appendChild(swatch);
      item.appendChild(text);

      return item;
    };

    timelineLegend.appendChild(
      createLegendItem(
        "Births",
        "life-events-timeline__legend-item--birth",
        "--color-life-birth",
        "#4caf50",
      ),
    );
    timelineLegend.appendChild(
      createLegendItem(
        "Deaths",
        "life-events-timeline__legend-item--death",
        "--color-life-death",
        "#e74c3c",
      ),
    );
    timelineCard.appendChild(timelineLegend);

    lifeBody.appendChild(timelineCard);

    this.lifeEventsTimelineCard = timelineCard;
    this.lifeEventsTimelineCanvas = timelineCanvas;
    this.lifeEventsTimelineSummary = timelineSummary;
    this.lifeEventsTimelineSummaryMessage = timelineSummaryMessage;
    this.lifeEventsTimelineStats = timelineStats;
    this.lifeEventsTimelineWindowStat = windowStat;
    this.lifeEventsTimelineBirthStat = birthStat;
    this.lifeEventsTimelineDeathStat = deathStat;
    this.lifeEventsTimelineEmptyState = timelineEmpty;

    const breakdownCard = document.createElement("div");

    breakdownCard.className = "life-events-breakdown";
    breakdownCard.setAttribute(
      "aria-label",
      "Breakdown of recent death causes for the latest tick",
    );

    const breakdownTitle = document.createElement("h5");

    breakdownTitle.className = "life-events-breakdown__title";
    breakdownTitle.textContent = "Death Causes (this tick)";
    breakdownCard.appendChild(breakdownTitle);

    const breakdownHint = document.createElement("p");

    breakdownHint.className = "life-events-breakdown__hint control-hint";
    breakdownHint.textContent =
      "Highlights the leading reasons cells died during the most recent update.";
    breakdownCard.appendChild(breakdownHint);

    const breakdownList = document.createElement("ul");

    breakdownList.className = "death-breakdown-list";
    breakdownList.setAttribute("role", "list");
    breakdownList.hidden = true;
    breakdownCard.appendChild(breakdownList);
    this.deathBreakdownList = breakdownList;

    const breakdownEmpty = document.createElement("p");

    breakdownEmpty.className = "death-breakdown-empty control-hint";
    breakdownEmpty.textContent = "No deaths recorded this tick.";
    breakdownCard.appendChild(breakdownEmpty);
    this.deathBreakdownEmptyState = breakdownEmpty;

    lifeBody.appendChild(breakdownCard);

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

    this.#updateLifeEventsSummary(0, 0, 0, null);

    return panel;
  }

  togglePause() {
    const toggler = this.simulationCallbacks?.togglePause;
    const nextPaused = typeof toggler === "function" ? toggler() : !this.paused;

    this.setPauseState(nextPaused);
    if (!nextPaused) this.#scheduleUpdate();

    return this.paused;
  }

  isPaused() {
    return this.paused;
  }

  setPauseState(paused) {
    this.paused = Boolean(paused);
    if (!this.paused && this.autoPausePending) {
      this.autoPausePending = false;
    }
    this.#updatePauseButtonState();
    this.#updateStepButtonState();
    this.#updatePauseIndicator();
  }

  setAutoPauseOnBlur(enabled, { notify = true } = {}) {
    const nextValue = coerceBoolean(enabled, this.autoPauseOnBlur);
    const changed = this.autoPauseOnBlur !== nextValue;

    this.autoPauseOnBlur = nextValue;
    if (!this.autoPauseOnBlur && this.autoPausePending) {
      this.autoPausePending = false;
    }
    if (this.autoPauseCheckbox) {
      this.autoPauseCheckbox.checked = this.autoPauseOnBlur;
    }
    this.#updatePauseIndicator();

    if (changed && notify) {
      this.#notifySettingChange("autoPauseOnBlur", this.autoPauseOnBlur);
    }
  }

  setUpdatesPerSecond(value, { notify = true } = {}) {
    const sanitized = sanitizeNumber(value, {
      fallback: null,
      min: 1,
      round: Math.round,
    });

    if (sanitized === null) return;

    const base =
      Number.isFinite(this.baseUpdatesPerSecond) && this.baseUpdatesPerSecond > 0
        ? this.baseUpdatesPerSecond
        : SIMULATION_DEFAULTS.updatesPerSecond;
    const derivedMultiplier = sanitized / base;
    const safeMultiplier =
      Number.isFinite(derivedMultiplier) && derivedMultiplier > 0
        ? derivedMultiplier
        : this.speedMultiplier;

    if (Number.isFinite(safeMultiplier) && safeMultiplier > 0) {
      this.#updateSetting("speedMultiplier", safeMultiplier, { notify });
      this.#updateSpeedMultiplierUI(safeMultiplier);
    }

    const resolvedCadence = Math.max(1, sanitized);

    if (!this.simulationClock || typeof this.simulationClock !== "object") {
      this.simulationClock = {
        ticks: 0,
        elapsedSeconds: 0,
        lastUpdatesPerSecond: resolvedCadence,
      };
    } else {
      this.simulationClock.lastUpdatesPerSecond = resolvedCadence;
    }
  }

  setAutoPausePending(pending) {
    const nextValue = Boolean(pending);

    if (this.autoPausePending === nextValue) {
      return;
    }

    this.autoPausePending = nextValue;
    this.#updatePauseIndicator();
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
  // Returns effective updates/sec derived from the configured base cadence
  getUpdatesPerSecond() {
    const base =
      Number.isFinite(this.baseUpdatesPerSecond) && this.baseUpdatesPerSecond > 0
        ? this.baseUpdatesPerSecond
        : SIMULATION_DEFAULTS.updatesPerSecond;

    return Math.max(1, Math.round(base * this.speedMultiplier));
  }
  getDensityEffectMultiplier() {
    return this.densityEffectMultiplier;
  }
  getMutationMultiplier() {
    return this.mutationMultiplier;
  }
  getLowDiversityReproMultiplier() {
    return this.lowDiversityReproMultiplier;
  }
  getEventFrequencyMultiplier() {
    return this.eventFrequencyMultiplier;
  }
  getInitialTileEnergyFraction() {
    return this.initialTileEnergyFraction;
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
    const timestamp = Number(now);

    if (!Number.isFinite(timestamp)) {
      return false;
    }

    const intervalCandidate = Number(this.leaderboardIntervalMs);
    const interval = Number.isFinite(intervalCandidate)
      ? Math.max(0, intervalCandidate)
      : 0;

    if (timestamp < this._lastSlowUiRender) {
      this._lastSlowUiRender = timestamp;

      return true;
    }

    if (interval === 0 || timestamp - this._lastSlowUiRender >= interval) {
      this._lastSlowUiRender = timestamp;

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
  getShowObstacles() {
    return this.showObstacles;
  }
  getShowLifeEventMarkers() {
    return this.showLifeEventMarkers;
  }
  getShowAuroraVeil() {
    return this.showAuroraVeil;
  }
  getShowReproductiveZones() {
    return this.showReproductiveZones;
  }

  setInitialTileEnergyFraction(value, { notify = true } = {}) {
    const clamped = sanitizeNumber(value, { fallback: null, min: 0, max: 1 });

    if (clamped === null) return;

    this.initialTileEnergyFraction = clamped;

    if (this.initialTileEnergySlider?.updateDisplay) {
      this.initialTileEnergySlider.updateDisplay(clamped);
    }

    if (notify) {
      this.#notifySettingChange("initialTileEnergyFraction", clamped);
    }
  }

  setLowDiversityReproMultiplier(value, { notify = true } = {}) {
    const clamped = sanitizeNumber(value, { fallback: null, min: 0, max: 1 });

    if (clamped === null) return;
    const changed = this.lowDiversityReproMultiplier !== clamped;

    this.lowDiversityReproMultiplier = clamped;

    if (this.lowDiversitySlider?.updateDisplay) {
      this.lowDiversitySlider.updateDisplay(clamped);
    }

    if (changed && notify) {
      this.#notifySettingChange("lowDiversityReproMultiplier", clamped);
    }
  }

  resetSimulationTuning({ notify = true } = {}) {
    const defaults = this._defaultSettings;

    if (!defaults) return false;

    const applySetting = (key, value) => {
      if (value === undefined) return;

      this.#updateSetting(key, value, { notify });
      this.#syncSliderInput(key, value);
    };

    applySetting("societySimilarity", defaults.societySimilarity);
    applySetting("enemySimilarity", defaults.enemySimilarity);
    applySetting("matingDiversityThreshold", defaults.matingDiversityThreshold);
    applySetting("eventStrengthMultiplier", defaults.eventStrengthMultiplier);
    applySetting("eventFrequencyMultiplier", defaults.eventFrequencyMultiplier);
    applySetting("densityEffectMultiplier", defaults.densityEffectMultiplier);
    applySetting("energyRegenRate", defaults.energyRegenRate);
    applySetting("energyDiffusionRate", defaults.energyDiffusionRate);
    applySetting("mutationMultiplier", defaults.mutationMultiplier);
    applySetting("combatEdgeSharpness", defaults.combatEdgeSharpness);
    applySetting("combatTerritoryEdgeFactor", defaults.combatTerritoryEdgeFactor);
    applySetting("leaderboardIntervalMs", defaults.leaderboardIntervalMs);

    if (defaults.lowDiversityReproMultiplier !== undefined) {
      this.setLowDiversityReproMultiplier(defaults.lowDiversityReproMultiplier, {
        notify,
      });
    }

    if (defaults.initialTileEnergyFraction !== undefined) {
      this.setInitialTileEnergyFraction(defaults.initialTileEnergyFraction, {
        notify,
      });
    }

    if (defaults.speedMultiplier !== undefined) {
      this.#setSpeedMultiplier(defaults.speedMultiplier);
    }

    this.#scheduleUpdate();

    return true;
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

  #resetSimulationClock() {
    if (!this.simulationClock || typeof this.simulationClock !== "object") {
      this.simulationClock = {
        ticks: 0,
        elapsedSeconds: 0,
        lastUpdatesPerSecond: Math.max(1, this.getUpdatesPerSecond()),
      };

      return;
    }

    this.simulationClock.ticks = 0;
    this.simulationClock.elapsedSeconds = 0;
    this.simulationClock.lastUpdatesPerSecond = Math.max(1, this.getUpdatesPerSecond());
  }

  #resolveClockUpdatesPerSecond(candidate) {
    if (!this.simulationClock || typeof this.simulationClock !== "object") {
      this.simulationClock = {
        ticks: 0,
        elapsedSeconds: 0,
        lastUpdatesPerSecond: Math.max(1, this.getUpdatesPerSecond()),
      };
    }

    const normalized =
      Number.isFinite(candidate) && candidate > 0 ? Number(candidate) : null;

    if (normalized != null) {
      this.simulationClock.lastUpdatesPerSecond = normalized;

      return normalized;
    }

    const fallback =
      Number.isFinite(this.simulationClock.lastUpdatesPerSecond) &&
      this.simulationClock.lastUpdatesPerSecond > 0
        ? this.simulationClock.lastUpdatesPerSecond
        : Math.max(1, this.getUpdatesPerSecond());

    this.simulationClock.lastUpdatesPerSecond = fallback;

    return fallback;
  }

  #updateSimulationClock(totalTicks, updatesPerSecond) {
    if (!this.simulationClock || typeof this.simulationClock !== "object") {
      this.simulationClock = {
        ticks: 0,
        elapsedSeconds: 0,
        lastUpdatesPerSecond: Math.max(1, this.getUpdatesPerSecond()),
      };
    }

    const ticks = Number.isFinite(totalTicks)
      ? Math.max(0, Math.floor(totalTicks))
      : null;
    const previousTicks = Number.isFinite(this.simulationClock.ticks)
      ? Math.max(0, Math.floor(this.simulationClock.ticks))
      : 0;

    if (ticks != null && ticks < previousTicks) {
      this.#resetSimulationClock();
      this.simulationClock.ticks = ticks;

      return {
        ticks,
        seconds: this.simulationClock.elapsedSeconds,
        updatesPerSecond: this.#resolveClockUpdatesPerSecond(updatesPerSecond),
      };
    }

    const cadence = this.#resolveClockUpdatesPerSecond(updatesPerSecond);

    if (ticks != null && ticks > previousTicks) {
      if (Number.isFinite(cadence) && cadence > 0) {
        const delta = ticks - previousTicks;
        const base = Number.isFinite(this.simulationClock.elapsedSeconds)
          ? this.simulationClock.elapsedSeconds
          : 0;

        this.simulationClock.elapsedSeconds = base + delta / cadence;
      }

      this.simulationClock.ticks = ticks;
    } else if (ticks != null) {
      this.simulationClock.ticks = ticks;
    }

    return {
      ticks: Number.isFinite(this.simulationClock.ticks)
        ? Math.max(0, Math.floor(this.simulationClock.ticks))
        : 0,
      seconds: Number.isFinite(this.simulationClock.elapsedSeconds)
        ? this.simulationClock.elapsedSeconds
        : 0,
      updatesPerSecond: cadence,
    };
  }

  #formatElapsedTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return "—";
    }

    if (seconds < 60) {
      return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
    }

    const totalSeconds = Math.floor(seconds);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }

    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }

  renderMetrics(stats, snapshot, environment = {}) {
    this.renderLifeEvents(stats, snapshot);

    const snapshotData = snapshot && typeof snapshot === "object" ? snapshot : {};
    const insightSnapshot = { ...snapshotData };

    delete insightSnapshot.rendering;

    if (!this.metricsBox) return;

    if (this.#isPanelCollapsed(this.insightsPanel)) {
      this._pendingMetrics = { stats, snapshot, environment };

      return;
    }

    this._pendingMetrics = null;
    const hasSnapshotData = Object.keys(insightSnapshot).some(
      (key) => insightSnapshot[key] !== undefined,
    );

    if (!hasSnapshotData) {
      this.#showMetricsPlaceholder("Run the simulation to populate these metrics.");

      return;
    }

    this.#hideMetricsPlaceholder();
    this.metricsBox.innerHTML = "";
    this.#ensureTraitSparklineCards(stats);
    const s = insightSnapshot;
    const totals = (stats && stats.totals) || {};
    const lastTotals = this._lastInteractionTotals || { fights: 0, cooperations: 0 };
    const fightDelta = Math.max(0, (totals.fights ?? 0) - (lastTotals.fights ?? 0));
    const coopDelta = Math.max(
      0,
      (totals.cooperations ?? 0) - (lastTotals.cooperations ?? 0),
    );
    const interactionTotal = fightDelta + coopDelta;

    const appendMetricRow = (container, { label, value, title, valueClass }) => {
      const card = document.createElement("article");

      card.className = "metrics-stat";
      card.setAttribute("role", "group");
      if (typeof label === "string" && label.length > 0) {
        card.setAttribute("data-metric-label", label);
      }

      const labelEl = document.createElement("span");

      labelEl.className = "metrics-stat-label";
      labelEl.textContent = label ?? "";

      const valueEl = document.createElement("span");

      valueEl.className = "metrics-stat-value";
      const normalizedValueClass =
        valueClass === "control-value--left" ? "metrics-stat-value--left" : valueClass;

      if (typeof normalizedValueClass === "string" && normalizedValueClass.length > 0) {
        valueEl.classList.add(normalizedValueClass);
      }

      let displayValue = "—";
      const isDomNode = typeof Node !== "undefined" && value instanceof Node;

      if (isDomNode) {
        displayValue = value.textContent?.trim() || "—";
        valueEl.appendChild(value);
      } else if (value != null) {
        displayValue = String(value);
        valueEl.textContent = displayValue;
      } else {
        valueEl.textContent = displayValue;
      }

      card.appendChild(labelEl);
      card.appendChild(valueEl);

      if (typeof title === "string" && title.length > 0) {
        card.title = title;
        card.setAttribute("aria-label", `${label}: ${displayValue}`);
      } else {
        card.title = `${label}: ${displayValue}`;
        card.setAttribute("aria-label", card.title);
      }

      container.appendChild(card);

      return card;
    };

    const createSection = (title, options = {}) => {
      const { wide = false, layout = "grid", accent } = options;
      const section = document.createElement("section");

      section.className = "metrics-section";
      if (wide) section.classList.add("metrics-section--wide");
      if (typeof accent === "string" && accent.length > 0) {
        section.style.setProperty("--metrics-section-accent", accent);
      }
      const heading = document.createElement("h4");

      heading.className = "metrics-section-title";
      heading.textContent = title;
      section.appendChild(heading);
      const body = document.createElement("div");

      body.className = "metrics-section-body";
      if (layout === "grid") {
        body.classList.add("metrics-section-body--grid");
      }
      section.appendChild(body);
      this.metricsBox.appendChild(section);

      return body;
    };

    const finiteOrDash = (value, formatter = String) =>
      formatIfFinite(value, formatter, "—");
    const percentOrDash = (value) =>
      formatIfFinite(value, (v) => `${(v * 100).toFixed(0)}%`, "—");
    const countOrDash = (value) => finiteOrDash(value);
    const fixedOrDash = (value, digits) =>
      formatIfFinite(value, (v) => v.toFixed(digits), "—");
    const coverageOrNull = (ratio) =>
      formatIfFinite(
        ratio,
        (value) => `${Math.round(clamp(value, 0, 1) * 100)}% area`,
        null,
      );
    const secondsOrNull = (seconds) =>
      formatIfFinite(
        seconds,
        (value) => {
          const rounded = value >= 10 ? Math.round(value) : value.toFixed(1);

          return `${rounded}s left`;
        },
        null,
      );
    const intensityOrNull = (value) =>
      formatIfFinite(value, (v) => `${v.toFixed(2)}× intensity`, null);

    const eventMultiplier = formatIfFinite(
      environment?.eventStrengthMultiplier,
      (value) => value,
      null,
    );
    const activeEvents = Array.isArray(environment?.activeEvents)
      ? environment.activeEvents
      : [];

    this._lastInteractionTotals = {
      fights: totals.fights ?? lastTotals.fights ?? 0,
      cooperations: totals.cooperations ?? lastTotals.cooperations ?? 0,
    };

    const clockState = this.#updateSimulationClock(
      stats?.totals?.ticks,
      environment?.updatesPerSecond,
    );
    const elapsedTimeLabel = this.#formatElapsedTime(clockState?.seconds);
    const elapsedTimeTitle = Number.isFinite(clockState?.seconds)
      ? `Approximately ${
          clockState.seconds < 10
            ? clockState.seconds.toFixed(1)
            : Math.round(clockState.seconds)
        } simulated seconds have elapsed since the current world spawned.`
      : "Elapsed simulation time since the current world spawned.";
    const tickDisplay = formatIfFinite(
      clockState?.ticks,
      (value) => Math.max(0, Math.floor(value)).toLocaleString(),
      "—",
    );
    const baseCadence =
      Number.isFinite(this.baseUpdatesPerSecond) && this.baseUpdatesPerSecond > 0
        ? this.baseUpdatesPerSecond
        : SIMULATION_DEFAULTS.updatesPerSecond;
    const cadenceDisplay = formatIfFinite(
      clockState?.updatesPerSecond,
      (value) => {
        const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
        const factor = 10 ** decimals;
        const rounded = Math.round(value * factor) / factor;
        const formatted =
          decimals === 0
            ? Math.round(rounded).toLocaleString()
            : rounded
                .toFixed(decimals)
                .replace(/(\.\d*?[1-9])0+$/u, "$1")
                .replace(/\.0+$/u, "");
        const cadenceText = `${formatted} updates/sec`;

        if (Number.isFinite(baseCadence) && baseCadence > 0) {
          const multiplierText = this.#formatSpeedDisplay(value / baseCadence);

          if (multiplierText && multiplierText !== "—") {
            return `${cadenceText} (${multiplierText})`;
          }
        }

        return cadenceText;
      },
      "—",
    );
    const cadenceTitleParts = [
      "Effective updates processed per simulated second derived from the playback speed controls.",
    ];

    if (Number.isFinite(baseCadence) && baseCadence > 0) {
      const baseLabel = Math.round(baseCadence).toLocaleString();

      cadenceTitleParts.push(`Base cadence: ${baseLabel} updates/sec.`);
    }

    const cadenceTitle = cadenceTitleParts.join(" ");

    const clockSection = createSection("Simulation Clock", {
      accent: "var(--color-metric-growth)",
    });

    appendMetricRow(clockSection, {
      label: "Elapsed Time",
      value: elapsedTimeLabel,
      title: elapsedTimeTitle,
    });

    appendMetricRow(clockSection, {
      label: "Ticks Elapsed",
      value: tickDisplay,
      title: "Total simulation ticks processed since the current world spawned.",
    });
    appendMetricRow(clockSection, {
      label: "Current Cadence",
      value: cadenceDisplay,
      title: cadenceTitle,
    });

    const populationSection = createSection("Population Snapshot", {
      accent: "var(--color-metric-population)",
    });

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
    const interactionSection = createSection("Interaction Pulse", {
      accent: "var(--color-life-birth)",
    });

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

    const vitalitySection = createSection("Vitality Signals", {
      accent: "var(--color-metric-energy)",
    });

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

    const environmentSection = createSection("Environmental Events", {
      accent: "var(--color-metric-event-strength)",
    });

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

    const reproductionSection = createSection("Reproduction Trends", {
      accent: "var(--color-metric-mutation)",
    });

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
      const traitSection = createSection("Trait Presence", {
        wide: true,
        layout: "stack",
        accent: "var(--color-metric-diversity)",
      });
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
        const traitConfigs = resolveTraitDisplayConfigs(stats);

        if (traitConfigs.length > 0) {
          const traitList = document.createElement("ul");

          traitList.className = "trait-bar-list";
          traitList.setAttribute("role", "list");

          traitConfigs.forEach((trait) => {
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
            item.setAttribute("data-trait", trait.key);

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

            const presenceColor = trait.colors.presence;

            fill.style.background = presenceColor.colorVar
              ? `var(${presenceColor.colorVar}, ${presenceColor.fallbackColor})`
              : presenceColor.fallbackColor;
            meter.appendChild(fill);

            item.appendChild(meter);
            traitList.appendChild(item);
          });

          traitBody.appendChild(traitList);
        } else {
          const emptyState = document.createElement("p");

          emptyState.className = "trait-empty-state";
          emptyState.textContent = "No living cells to sample for trait presence yet.";
          traitBody.appendChild(emptyState);
        }
      } else {
        const emptyState = document.createElement("p");

        emptyState.className = "trait-empty-state";
        emptyState.textContent = "No living cells to sample for trait presence yet.";
        traitBody.appendChild(emptyState);
      }

      traitSection.appendChild(traitGroup);
    }

    if (Array.isArray(this.sparkMetricDescriptors)) {
      this.sparkMetricDescriptors.forEach(
        ({ property, historyKey, colorVar, fallbackColor }) => {
          const canvas = this[property];
          const data = stats?.history?.[historyKey];
          const color = this.#resolveCssColor(colorVar, fallbackColor);

          this.drawSpark(canvas, Array.isArray(data) ? data : [], color);
        },
      );
    }

    if (Array.isArray(this.traitSparkDescriptors)) {
      this.traitSparkDescriptors.forEach(
        ({ property, traitKey, traitType, colorVar, fallbackColor }) => {
          const canvas = this[property];
          const data = stats?.traitHistory?.[traitType]?.[traitKey];
          const color = this.#resolveCssColor(colorVar, fallbackColor);

          this.drawSpark(canvas, Array.isArray(data) ? data : [], color);
        },
      );
    }
  }

  #ensureTraitSparklineCards(stats) {
    if (!this.traitSparkGrid) return;

    const configs = resolveTraitDisplayConfigs(stats);
    const keys = configs.map((config) => config.key);
    const keysUnchanged =
      Array.isArray(this._traitSparkKeys) &&
      this._traitSparkKeys.length === keys.length &&
      this._traitSparkKeys.every((key, index) => key === keys[index]);

    if (keysUnchanged) {
      return;
    }

    if (Array.isArray(this.traitSparkDescriptors)) {
      this.traitSparkDescriptors.forEach(({ property }) => {
        if (property && Object.hasOwn(this, property)) {
          delete this[property];
        }
      });
    }

    this.traitSparkGrid.innerHTML = "";

    if (configs.length === 0) {
      this.traitSparkDescriptors = [];
      this._traitSparkKeys = [];

      return;
    }

    const descriptors = [];

    configs.forEach((trait) => {
      const label = trait.label;
      const key = trait.key;
      const baseId = toPascalCase(key) || "Trait";
      const card = document.createElement("div");

      card.className = "sparkline-card sparkline-card--trait";
      card.setAttribute("role", "group");
      card.setAttribute("aria-label", `${label} trait trends`);
      card.setAttribute("data-trait", key);

      const header = document.createElement("div");

      header.className = "sparkline-trait-header";
      const nameEl = document.createElement("span");

      nameEl.className = "sparkline-trait-name";
      nameEl.textContent = label;
      header.appendChild(nameEl);

      const contextEl = document.createElement("span");

      contextEl.className = "sparkline-trait-context";
      contextEl.textContent = "Presence vs intensity";
      header.appendChild(contextEl);

      card.appendChild(header);

      const metrics = [
        {
          label: "Activity (presence %)",
          property: `sparkTrait${baseId}Presence`,
          traitKey: key,
          traitType: "presence",
          colorVar: trait.colors.presence.colorVar,
          fallbackColor: trait.colors.presence.fallbackColor,
          ariaLabel: `${label} presence trend over time`,
        },
        {
          label: "Intensity (avg level)",
          property: `sparkTrait${baseId}Average`,
          traitKey: key,
          traitType: "average",
          colorVar: trait.colors.intensity.colorVar,
          fallbackColor: trait.colors.intensity.fallbackColor,
          ariaLabel: `${label} intensity trend over time`,
        },
      ];

      metrics.forEach((metric, index) => {
        const row = document.createElement("div");

        row.className = "sparkline-trait-row";
        if (index > 0) row.classList.add("sparkline-trait-row--separated");

        const rowCaption = document.createElement("div");

        rowCaption.className = "sparkline-caption sparkline-caption--trait";
        const dot = document.createElement("span");

        dot.className = "sparkline-color-dot";
        if (metric.colorVar) {
          dot.style.background = `var(${metric.colorVar}, ${metric.fallbackColor})`;
        } else if (metric.fallbackColor) {
          dot.style.background = metric.fallbackColor;
        }
        const labelText = document.createElement("span");

        labelText.className = "sparkline-caption-text";
        labelText.textContent = metric.label;
        rowCaption.appendChild(dot);
        rowCaption.appendChild(labelText);

        const canvas = document.createElement("canvas");

        canvas.className = "sparkline sparkline--trait";
        canvas.width = 220;
        canvas.height = 48;
        canvas.setAttribute("role", "img");
        canvas.setAttribute("aria-label", metric.ariaLabel);
        canvas.title = metric.label;

        row.appendChild(rowCaption);
        row.appendChild(canvas);
        card.appendChild(row);

        this[metric.property] = canvas;
        descriptors.push({
          property: metric.property,
          traitKey: metric.traitKey,
          traitType: metric.traitType,
          colorVar: metric.colorVar,
          fallbackColor: metric.fallbackColor,
        });
      });

      this.traitSparkGrid.appendChild(card);
    });

    this.traitSparkDescriptors = descriptors;
    this._traitSparkKeys = keys;
  }

  renderLifeEvents(stats, metrics) {
    if (!this.lifeEventsPanel) {
      this._pendingLifeEventsStats =
        stats || metrics ? { stats: stats ?? null, metrics: metrics ?? null } : null;

      return;
    }

    if (this.#isPanelCollapsed(this.lifeEventsPanel)) {
      this._pendingLifeEventsStats =
        stats || metrics ? { stats: stats ?? null, metrics: metrics ?? null } : null;

      return;
    }

    this._pendingLifeEventsStats = null;
    this.#renderLifeEvents(stats, metrics);
  }

  drawSpark(canvas, data, color = "#88d") {
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const series = Array.isArray(data) ? data : [];
    const length = series.length;
    const w = Number(canvas.width) || 0;
    const h = Number(canvas.height) || 0;

    if (!ctx || w <= 0 || h <= 0) {
      return;
    }

    ctx.clearRect(0, 0, w, h);

    if (length < 2) {
      return;
    }

    const {
      min: computedMin,
      max: computedMax,
      allFiniteNumbers,
    } = series.reduce(
      (acc, candidate) => {
        if (typeof candidate === "number") {
          if (!Number.isFinite(candidate)) {
            acc.allFiniteNumbers = false;

            return acc;
          }

          if (candidate < acc.min) acc.min = candidate;
          if (candidate > acc.max) acc.max = candidate;

          return acc;
        }

        const numeric = Number(candidate);

        if (!Number.isFinite(numeric)) {
          acc.allFiniteNumbers = false;

          return acc;
        }

        acc.allFiniteNumbers = false;
        if (numeric < acc.min) acc.min = numeric;
        if (numeric > acc.max) acc.max = numeric;

        return acc;
      },
      {
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
        allFiniteNumbers: true,
      },
    );

    let min = computedMin;
    let max = computedMax;

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      min = 0;
      max = 0;
    }

    let span = max - min;

    if (!Number.isFinite(span) || span <= 0) {
      span = 1;
    }

    const lastIndex = length - 1;
    const widthScale = lastIndex > 0 ? (w - 1) / lastIndex : 0;
    const heightScale = h - 1;
    const invSpan = 1 / span;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    if (allFiniteNumbers) {
      for (let i = 0; i < length; i++) {
        const value = series[i];
        const x = i * widthScale;
        const y = h - (value - min) * invSpan * heightScale - 1;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    } else {
      for (let i = 0; i < length; i++) {
        const candidate = series[i];
        let resolvedValue = min;

        if (typeof candidate === "number") {
          if (Number.isFinite(candidate)) {
            resolvedValue = candidate;
          }
        } else {
          const numeric = Number(candidate);

          if (Number.isFinite(numeric)) {
            resolvedValue = numeric;
          }
        }

        const x = i * widthScale;
        const y = h - (resolvedValue - min) * invSpan * heightScale - 1;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    }

    ctx.stroke();
  }

  renderLeaderboard(top) {
    if (!this.leaderPanel) {
      const { panel, body } = this.#createPanel("Leaderboard", {
        collapsed: true,
        onToggle: (expanded) => {
          if (expanded) {
            this.#flushPendingLeaderboard();
          }
        },
      });

      panel.classList.add("leaderboard-panel");
      this.dashboardGrid?.appendChild(panel);
      this.leaderPanel = panel;

      const entriesContainer = document.createElement("ol");

      entriesContainer.className = "leaderboard-entries";
      entriesContainer.setAttribute("role", "list");
      entriesContainer.setAttribute("aria-live", "polite");
      entriesContainer.setAttribute("aria-busy", "false");
      entriesContainer.setAttribute(
        "aria-label",
        "Top organisms ranked by overall fitness",
      );
      body.appendChild(entriesContainer);

      this.leaderBody = entriesContainer;
      this.leaderEntriesContainer = entriesContainer;
    }

    if (this.dashboardCadenceSlider?.updateDisplay) {
      this.dashboardCadenceSlider.updateDisplay(this.leaderboardIntervalMs);
    }

    const entries = Array.isArray(top) ? top.filter(Boolean) : [];

    if (this.#isPanelCollapsed(this.leaderPanel)) {
      this._pendingLeaderboardEntries = entries;

      return;
    }

    const target = this.leaderEntriesContainer || this.leaderBody;

    if (!target) {
      this._pendingLeaderboardEntries = entries;

      return;
    }

    this._pendingLeaderboardEntries = null;
    target.innerHTML = "";
    target.setAttribute("aria-busy", "true");

    if (entries.length === 0) {
      const empty = document.createElement("li");

      empty.className = "leaderboard-empty-state";
      empty.setAttribute("role", "listitem");
      empty.textContent = "Run the simulation to populate the leaderboard.";
      target.appendChild(empty);
      target.setAttribute("aria-busy", "false");

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
      const card = document.createElement("li");

      card.className = "leaderboard-entry";
      card.setAttribute("role", "listitem");
      card.tabIndex = 0;

      const readableRank = index + 1;

      card.setAttribute(
        "aria-label",
        `Rank ${readableRank} organism with fitness ${formatFloat(summaryFitness)}`,
      );

      if (index === 0) {
        card.classList.add("leaderboard-entry--top");
      }

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
      target.appendChild(card);
    });

    target.setAttribute("aria-busy", "false");
  }
}
