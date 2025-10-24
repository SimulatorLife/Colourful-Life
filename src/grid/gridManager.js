import {
  randomRange,
  clamp,
  lerp,
  createRankedBuffer,
  sanitizePositiveInteger,
} from "../utils.js";
import { warnOnce } from "../utils/error.js";
import DNA from "../genome.js";
import Cell from "../cell.js";
import { computeFitness } from "../fitness.mjs";
import { computeBehaviorComplementarity } from "./behaviorComplementarity.js";
import {
  createEventContext,
  defaultEventContext,
  defaultIsEventAffecting,
} from "../events/eventContext.js";
import { accumulateEventModifiers } from "../energySystem.js";
import InteractionSystem from "../interactionSystem.js";
import GridInteractionAdapter from "./gridAdapter.js";
import { clearTileEnergyBuffers } from "./energyUtils.js";
import ReproductionZonePolicy from "./reproductionZonePolicy.js";
import { OBSTACLE_PRESETS, resolveObstaclePresetCatalog } from "./obstaclePresets.js";
import { resolvePopulationScarcityMultiplier } from "./populationScarcity.js";
import { resolveGridEnvironment } from "./gridEnvironment.js";
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS_DEFAULT,
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  COMBAT_TERRITORY_EDGE_FACTOR,
  REGEN_DENSITY_PENALTY,
  CONSUMPTION_DENSITY_PENALTY,
  DECAY_RETURN_FRACTION,
  DECAY_MAX_AGE,
  INITIAL_TILE_ENERGY_FRACTION_DEFAULT,
} from "../config.js";
const BRAIN_SNAPSHOT_LIMIT = 5;
const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};
const EMPTY_EVENT_LIST = Object.freeze([]);
const EMPTY_TARGET_LIST = Object.freeze([]);

const similarityCache = new WeakMap();
const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const DECAY_IMMEDIATE_SHARE = 0.25;
const DECAY_RELEASE_BASE = 0.12;
const DECAY_RELEASE_RATE = 0.18;
const DECAY_EPSILON = 1e-4;
const ENERGY_SPARSE_SCAN_RATIO = 0.2;

function resolveInitialTileEnergyFraction(candidate) {
  const numeric = Number(candidate);

  if (!Number.isFinite(numeric)) {
    return INITIAL_TILE_ENERGY_FRACTION_DEFAULT;
  }

  return clamp(numeric, 0, 1);
}

const TARGET_DESCRIPTOR_BASE_KEYS = new Set([
  "row",
  "col",
  "target",
  "classification",
  "precomputedSimilarity",
  "similarity",
]);

const COLOR_CACHE_LIMIT = 4096;
const COLOR_CACHE = new Map();
const COLOR_CACHE_KEYS = [];
let colorCacheEvictIndex = 0;
const CELL_COLOR_RECORD_CACHE = new WeakMap();
const RGB_PATTERN =
  /rgba?\(\s*([0-9]+)\s*,\s*([0-9]+)\s*,\s*([0-9]+)(?:\s*,\s*([0-9.]+)\s*)?\)/i;
const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i;
const EMPTY_RGBA = Object.freeze([0, 0, 0, 0]);
const PACK_RGBA32 = (() => {
  if (typeof Uint8ClampedArray !== "function" || typeof Uint32Array !== "function") {
    return null;
  }

  try {
    const probe = new Uint8ClampedArray(4);
    const view = new Uint32Array(probe.buffer);

    view[0] = 0x01020304;

    if (
      probe[0] === 0x04 &&
      probe[1] === 0x03 &&
      probe[2] === 0x02 &&
      probe[3] === 0x01
    ) {
      return (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  } catch (error) {
    warnOnce("Uint32 color packing unsupported", error);
  }

  return null;
})();
const EMPTY_COLOR_RECORD = Object.freeze({
  rgba: EMPTY_RGBA,
  packed: PACK_RGBA32 ? PACK_RGBA32(0, 0, 0, 0) : 0,
});
const TIMESTAMP_NOW =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

function parseHexColorComponents(hex) {
  const length = hex.length;

  if (length === 3 || length === 4) {
    const rNibble = Number.parseInt(hex[0], 16);
    const gNibble = Number.parseInt(hex[1], 16);
    const bNibble = Number.parseInt(hex[2], 16);

    if (Number.isNaN(rNibble) || Number.isNaN(gNibble) || Number.isNaN(bNibble)) {
      return null;
    }

    const r = (rNibble << 4) | rNibble;
    const g = (gNibble << 4) | gNibble;
    const b = (bNibble << 4) | bNibble;
    let a = 255;

    if (length === 4) {
      const aNibble = Number.parseInt(hex[3], 16);

      if (Number.isNaN(aNibble)) {
        return null;
      }

      a = (aNibble << 4) | aNibble;
    }

    return { r, g, b, a };
  }

  if (length === 6 || length === 8) {
    const parsed = Number.parseInt(hex, 16);

    if (!Number.isFinite(parsed)) {
      return null;
    }

    const value = parsed >>> 0;

    if (length === 6) {
      return {
        r: (value >>> 16) & 0xff,
        g: (value >>> 8) & 0xff,
        b: value & 0xff,
        a: 255,
      };
    }

    return {
      r: (value >>> 24) & 0xff,
      g: (value >>> 16) & 0xff,
      b: (value >>> 8) & 0xff,
      a: value & 0xff,
    };
  }

  return null;
}

function rememberColor(normalized, record) {
  if (COLOR_CACHE_LIMIT <= 0 || COLOR_CACHE.has(normalized)) {
    return COLOR_CACHE.get(normalized) ?? record;
  }

  COLOR_CACHE.set(normalized, record);

  if (COLOR_CACHE_KEYS.length < COLOR_CACHE_LIMIT) {
    COLOR_CACHE_KEYS.push(normalized);

    return record;
  }

  const evictKey = COLOR_CACHE_KEYS[colorCacheEvictIndex];

  if (evictKey !== undefined) {
    COLOR_CACHE.delete(evictKey);
  }

  COLOR_CACHE_KEYS[colorCacheEvictIndex] = normalized;
  colorCacheEvictIndex =
    COLOR_CACHE_LIMIT > 0 ? (colorCacheEvictIndex + 1) % COLOR_CACHE_LIMIT : 0;

  return record;
}

function createColorRecord(r, g, b, a) {
  const rgba = Object.freeze([r, g, b, a]);
  const packed = PACK_RGBA32 ? PACK_RGBA32(r, g, b, a) : 0;

  return Object.freeze({ rgba, packed });
}

function resolveColorRecord(color) {
  if (typeof color !== "string") {
    return EMPTY_COLOR_RECORD;
  }

  const normalized = color.trim();

  if (normalized.length === 0) {
    return EMPTY_COLOR_RECORD;
  }

  if (COLOR_CACHE.has(normalized)) {
    return COLOR_CACHE.get(normalized);
  }

  let record = EMPTY_COLOR_RECORD;

  if (normalized.startsWith("#")) {
    const match = HEX_PATTERN.exec(normalized);

    if (match) {
      const components = parseHexColorComponents(match[1]);

      if (components) {
        record = createColorRecord(
          components.r,
          components.g,
          components.b,
          components.a,
        );
      }
    }
  } else {
    const match = RGB_PATTERN.exec(normalized);

    if (match) {
      const r = clamp(parseInt(match[1], 10) || 0, 0, 255);
      const g = clamp(parseInt(match[2], 10) || 0, 0, 255);
      const b = clamp(parseInt(match[3], 10) || 0, 0, 255);
      const alpha = match[4] != null ? Number.parseFloat(match[4]) : 1;
      const a = clamp(Math.round((Number.isFinite(alpha) ? alpha : 1) * 255), 0, 255);

      record = createColorRecord(r, g, b, a);
    }
  }

  return rememberColor(normalized, record);
}

function resolveCellColorRecord(cell) {
  if (!cell || typeof cell !== "object") {
    return EMPTY_COLOR_RECORD;
  }

  const cached = CELL_COLOR_RECORD_CACHE.get(cell);
  const color = typeof cell.color === "string" ? cell.color : "";

  if (cached && cached.color === color) {
    return cached.record;
  }

  const record = color ? resolveColorRecord(color) : EMPTY_COLOR_RECORD;

  CELL_COLOR_RECORD_CACHE.set(cell, { color, record });

  return record;
}

function getPairSimilarity(cellA, cellB) {
  if (!cellA || !cellB) return 0;

  let cacheA = similarityCache.get(cellA);

  if (!cacheA) {
    cacheA = new WeakMap();
    similarityCache.set(cellA, cacheA);
  }

  if (cacheA.has(cellB)) {
    return cacheA.get(cellB);
  }

  const value = cellA.similarityTo(cellB);

  cacheA.set(cellB, value);

  let cacheB = similarityCache.get(cellB);

  if (!cacheB) {
    cacheB = new WeakMap();
    similarityCache.set(cellB, cacheB);
  }

  cacheB.set(cellA, value);

  return value;
}

function toBrainSnapshotCollector(candidate) {
  if (typeof candidate === "function") {
    return candidate;
  }

  if (candidate && typeof candidate.captureFromEntries === "function") {
    return (entries, options) => candidate.captureFromEntries(entries, options);
  }

  return null;
}

/**
 * Primary orchestrator for cell lifecycle, energy management, and spatial
 * interactions. `GridManager` owns the grid data structures, applies movement
 * and reproduction rules, coordinates energy updates, and relays leaderboard
 * snapshots. The class exposes numerous hooks consumed by
 * {@link SimulationEngine}, UI controls, and tests; the JSDoc on public
 * methods documents parameters and side effects so external systems can
 * safely coordinate behaviour.
 */
export default class GridManager {
  // Base per-tick regen before modifiers; logistic to max, density-aware
  static energyRegenRate = ENERGY_REGEN_RATE_DEFAULT;
  // Fraction to diffuse toward neighbors each tick
  static energyDiffusionRate = ENERGY_DIFFUSION_RATE_DEFAULT;
  static DENSITY_RADIUS = DENSITY_RADIUS_DEFAULT;
  static maxTileEnergy = MAX_TILE_ENERGY;
  static combatEdgeSharpness = COMBAT_EDGE_SHARPNESS_DEFAULT;
  static combatTerritoryEdgeFactor = COMBAT_TERRITORY_EDGE_FACTOR;
  #spawnCandidateScratch = null;
  #segmentWindowScratch = null;
  #columnEventScratch = null;
  #eventRowsScratch = null;
  #activeCellSnapshotScratch = null;
  #eventModifierScratch = null;
  #sparseDirtyColumnsScratch = null;
  #sparseDirtyRowsScratch = null;
  #imageDataCanvas = null;
  #imageDataCtx = null;
  #imageData = null;
  #imageData32 = null;
  #imageDataNeedsFullRefresh = false;
  #targetScratch = {
    mates: [],
    enemies: [],
    society: [],
  };
  #targetGroupsView = null;
  #targetDescriptorPool = [];
  #rowOccupancy = [];
  #tickSimilarityCache = new WeakMap();
  #tickSimilarityVersion = -1;

  static #normalizeMoveOptions(options = {}) {
    const {
      obstacles = null,
      onBlocked = null,
      onMove = null,
      activeCells = null,
      onCellMoved = null,
      clearDestinationEnergy = null,
    } = options || {};

    return {
      obstacles,
      onBlocked,
      onMove,
      activeCells,
      onCellMoved,
      clearDestinationEnergy,
    };
  }

  static #isOutOfBounds(row, col, rows, cols) {
    return row < 0 || row >= rows || col < 0 || col >= cols;
  }

  static #computeMinPopulation(rows, cols) {
    const area = Math.max(1, Math.floor(rows) * Math.floor(cols));

    if (area < 100) return 0;

    const fractionalFloor = Math.round(area * 0.025);

    return Math.max(15, fractionalFloor);
  }

  #computePopulationScarcitySignal() {
    if (!Number.isFinite(this.minPopulation) || this.minPopulation <= 0) {
      return 0;
    }

    const population = this.activeCells?.size ?? 0;

    if (population >= this.minPopulation) {
      return 0;
    }

    const area = Math.max(1, Math.floor(this.rows) * Math.floor(this.cols));
    const occupancy = clamp(population / area, 0, 1);
    const deficit = clamp((this.minPopulation - population) / this.minPopulation, 0, 1);
    const scarcity = clamp(deficit * (0.6 + (1 - occupancy) * 0.4), 0, 1);

    return scarcity;
  }

  static #isObstacle(obstacles, row, col) {
    return Boolean(obstacles?.[row]?.[col]);
  }

  static #resolveDiversityDrive(
    cell,
    { localDensity = 0, tileEnergy = 0.5, tileEnergyDelta = 0 } = {},
  ) {
    if (!cell || typeof cell !== "object") return 0;

    const appetite = clamp(cell.diversityAppetite ?? 0, 0, 1);
    const bias = clamp(cell.matePreferenceBias ?? 0, -1, 1);
    const fertilityFrac = clamp(
      typeof cell.dna?.reproductionThresholdFrac === "function"
        ? cell.dna.reproductionThresholdFrac()
        : 0.4,
      0,
      1,
    );
    const densitySignal = clamp(localDensity ?? 0, 0, 1);
    const scarcitySignal = clamp(1 - (tileEnergy ?? 0), 0, 1);
    const declineSignal = clamp(-(tileEnergyDelta ?? 0), 0, 1);
    const curiosity = clamp(
      appetite + Math.max(0, -bias) * 0.5 - Math.max(0, bias) * 0.4,
      0,
      1,
    );
    const caution = clamp(1 - fertilityFrac, 0, 1);
    const environment = clamp(
      0.5 * densitySignal + 0.3 * scarcitySignal + 0.2 * declineSignal,
      0,
      1,
    );
    const drive = curiosity * (0.55 + 0.45 * caution);

    return clamp(drive * 0.7 + environment * 0.3, 0, 1);
  }

  #getSegmentWindowScratch() {
    if (!this.#segmentWindowScratch) {
      this.#segmentWindowScratch = [];
    }

    this.#segmentWindowScratch.length = 0;

    return this.#segmentWindowScratch;
  }

  #getColumnEventScratch() {
    if (!this.#columnEventScratch) {
      this.#columnEventScratch = [];
    }

    this.#columnEventScratch.length = 0;

    return this.#columnEventScratch;
  }

  #acquireActiveCellSnapshot() {
    if (!this.#activeCellSnapshotScratch) {
      this.#activeCellSnapshotScratch = [];
    }

    const scratch = this.#activeCellSnapshotScratch;

    scratch.length = 0;

    if (this.activeCells && this.activeCells.size > 0) {
      for (const cell of this.activeCells) {
        if (!this.#ensureTrackedCell(cell)) {
          this.activeCells.delete(cell);

          continue;
        }

        scratch.push(cell);
      }
    }

    return scratch;
  }

  #ensureTrackedCell(cell) {
    if (!cell || typeof cell !== "object") {
      return false;
    }

    if (!this.cellPositions || typeof this.cellPositions.get !== "function") {
      this.cellPositions = new WeakMap();
    }

    const tracked = this.cellPositions.get(cell);

    if (tracked && this.#isValidLocation(tracked.row, tracked.col, cell)) {
      return true;
    }

    if (tracked) {
      this.#untrackCell(cell);
    }

    const directRow = Number.isInteger(cell.row) ? cell.row : null;
    const directCol = Number.isInteger(cell.col) ? cell.col : null;

    if (this.#isValidLocation(directRow, directCol, cell)) {
      this.#trackCellPosition(cell, directRow, directCol);

      return true;
    }

    const located = this.#scanForCell(cell);

    if (!located) {
      return false;
    }

    this.#trackCellPosition(cell, located.row, located.col);

    return true;
  }

  #releaseActiveCellSnapshot() {
    if (this.#activeCellSnapshotScratch) {
      this.#activeCellSnapshotScratch.length = 0;
    }
  }

  #getEventModifierScratch() {
    if (!this.#eventModifierScratch) {
      this.#eventModifierScratch = {
        regenMultiplier: 1,
        regenAdd: 0,
        drainAdd: 0,
        appliedEvents: EMPTY_EVENT_LIST,
      };
    }

    return this.#eventModifierScratch;
  }

  #prepareSparseDirtyColumns(rowCount) {
    if (
      !this.#sparseDirtyColumnsScratch ||
      this.#sparseDirtyColumnsScratch.length !== rowCount
    ) {
      this.#sparseDirtyColumnsScratch = Array.from({ length: rowCount }, () => []);
    } else {
      for (let i = 0; i < this.#sparseDirtyColumnsScratch.length; i++) {
        this.#sparseDirtyColumnsScratch[i].length = 0;
      }
    }

    return this.#sparseDirtyColumnsScratch;
  }

  #getSparseDirtyRowList() {
    if (!this.#sparseDirtyRowsScratch) {
      this.#sparseDirtyRowsScratch = [];
    } else {
      this.#sparseDirtyRowsScratch.length = 0;
    }

    return this.#sparseDirtyRowsScratch;
  }

  #prepareEventsByRow(rowCount) {
    if (!this.#eventRowsScratch || this.#eventRowsScratch.length !== rowCount) {
      this.#eventRowsScratch = Array.from({ length: rowCount }, () => []);
    } else {
      for (let i = 0; i < this.#eventRowsScratch.length; i++) {
        this.#eventRowsScratch[i].length = 0;
      }
    }

    return this.#eventRowsScratch;
  }

  static #computePairDiversityThreshold({
    parentA,
    parentB,
    baseThreshold,
    localDensity = 0,
    tileEnergy = 0.5,
    tileEnergyDelta = 0,
    diversityPressure = 0,
    behaviorComplementarity = 0,
    scarcity = 0,
  } = {}) {
    const baseline = clamp(Number.isFinite(baseThreshold) ? baseThreshold : 0, 0, 1);
    const appetiteNeutral = 0.35;
    const appetiteA = clamp(parentA?.diversityAppetite ?? 0, 0, 1);
    const appetiteB = clamp(parentB?.diversityAppetite ?? 0, 0, 1);
    const appetiteAverage = (appetiteA + appetiteB) / 2;
    const appetiteDelta = appetiteAverage - appetiteNeutral;
    const biasA = clamp(parentA?.matePreferenceBias ?? 0, -1, 1);
    const biasB = clamp(parentB?.matePreferenceBias ?? 0, -1, 1);
    const biasAverage = clamp((biasA + biasB) / 2, -1, 1);
    const noveltyBias = Math.max(0, -biasAverage);
    const kinBias = Math.max(0, biasAverage);
    const fertilityFracA = clamp(
      typeof parentA?.dna?.reproductionThresholdFrac === "function"
        ? parentA.dna.reproductionThresholdFrac()
        : 0.4,
      0,
      1,
    );
    const fertilityFracB = clamp(
      typeof parentB?.dna?.reproductionThresholdFrac === "function"
        ? parentB.dna.reproductionThresholdFrac()
        : 0.4,
      0,
      1,
    );
    const cautionAverage = clamp(1 - (fertilityFracA + fertilityFracB) / 2, 0, 1);
    const cautionDelta = cautionAverage - 0.5;
    const densitySignal = clamp(localDensity ?? 0, 0, 1);
    const scarcitySignal = clamp(1 - (tileEnergy ?? 0), 0, 1);
    const declineSignal = clamp(-(tileEnergyDelta ?? 0), 0, 1);
    const environmentUrgency = clamp(
      densitySignal * 0.45 + scarcitySignal * 0.35 + declineSignal * 0.2,
      0,
      1,
    );
    const pressure = clamp(
      Number.isFinite(diversityPressure) ? diversityPressure : 0,
      0,
      1,
    );
    const complementValue = clamp(
      Number.isFinite(behaviorComplementarity) ? behaviorComplementarity : 0,
      0,
      1,
    );
    const scarcityValue = clamp(Number.isFinite(scarcity) ? scarcity : 0, 0, 1);
    const appetiteShift =
      appetiteDelta * (0.3 + environmentUrgency * 0.3 + pressure * 0.2);
    const cautionShift = cautionDelta * (0.18 + environmentUrgency * 0.22);
    const noveltyShift =
      noveltyBias * (0.15 + environmentUrgency * 0.25 + pressure * 0.2);
    const kinShift = kinBias * (0.2 - environmentUrgency * 0.1 - pressure * 0.05);
    const pressureShift = pressure * 0.08;
    const complementRelief =
      complementValue *
      (0.2 + pressure * 0.25 + environmentUrgency * 0.2 + scarcityValue * 0.3);
    const delta =
      appetiteShift + cautionShift + noveltyShift + pressureShift - kinShift;
    const rawThreshold = clamp(baseline + delta - complementRelief, 0, 1);
    const smoothing = clamp(0.25 + environmentUrgency * 0.35 + pressure * 0.25, 0, 1);

    return clamp(baseline * (1 - smoothing) + rawThreshold * smoothing, 0, 1);
  }

  #scoreSpawnCandidate(candidate, context = {}) {
    if (!candidate) return 0;

    const { r, c } = candidate;

    if (r == null || c == null) return 0;

    const {
      parentA = null,
      parentB = null,
      densityGrid = null,
      densityEffectMultiplier = 1,
    } = context;
    const maxTileEnergy = this.maxTileEnergy > 0 ? this.maxTileEnergy : 1;
    const tileEnergyRaw = this.energyGrid?.[r]?.[c] ?? 0;
    const tileEnergy = clamp(tileEnergyRaw / maxTileEnergy, 0, 1);
    const tileDelta = clamp(((this.energyDeltaGrid?.[r]?.[c] ?? 0) + 1) / 2, 0, 1);
    const densitySource = densityGrid?.[r]?.[c] ?? this.getDensityAt(r, c);
    const density = clamp((densitySource ?? 0) * (densityEffectMultiplier ?? 1), 0, 1);
    const crowdA = clamp(parentA?.baseCrowdingTolerance ?? 0.5, 0, 1);
    const crowdB = clamp(parentB?.baseCrowdingTolerance ?? 0.5, 0, 1);
    const crowdComfort = clamp((crowdA + crowdB) / 2, 0, 1);
    const crowdAffinity = clamp(1 - Math.abs(density - crowdComfort), 0, 1);
    const resourceA = clamp(parentA?.resourceTrendAdaptation ?? 0.35, 0, 1);
    const resourceB = clamp(parentB?.resourceTrendAdaptation ?? 0.35, 0, 1);
    const resourceDrive = clamp((resourceA + resourceB) / 2, 0, 1);
    const rawRiskA =
      typeof parentA?.getRiskTolerance === "function"
        ? parentA.getRiskTolerance()
        : (parentA?.baseRiskTolerance ?? 0.5);
    const rawRiskB =
      typeof parentB?.getRiskTolerance === "function"
        ? parentB.getRiskTolerance()
        : (parentB?.baseRiskTolerance ?? 0.5);
    const riskA = clamp(Number.isFinite(rawRiskA) ? rawRiskA : 0.5, 0, 1);
    const riskB = clamp(Number.isFinite(rawRiskB) ? rawRiskB : 0.5, 0, 1);
    const riskPreference = (riskA + riskB) / 2;
    const energyWeight = 0.45 + resourceDrive * 0.35; // 0.45..0.8
    const densityWeight = 0.35 + (1 - resourceDrive) * 0.25; // 0.35..0.6
    const trendWeight = 0.2 + resourceDrive * 0.3; // 0.2..0.5
    const crowdRiskPenalty =
      density > crowdComfort
        ? (density - crowdComfort) * Math.max(0, riskPreference) * 0.6
        : 0;
    const score =
      tileEnergy * energyWeight +
      crowdAffinity * densityWeight +
      tileDelta * trendWeight -
      crowdRiskPenalty;

    return Math.max(0, score);
  }

  #chooseSpawnCandidate(candidates, context = {}) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    const weights = new Array(candidates.length);
    let totalWeight = 0;

    for (let i = 0; i < candidates.length; i++) {
      const weight = this.#scoreSpawnCandidate(candidates[i], context);

      weights[i] = weight;
      totalWeight += weight;
    }

    if (!(totalWeight > 0)) {
      const fallbackIndex = Math.floor(this.#random() * candidates.length);

      return candidates[fallbackIndex] ?? null;
    }

    const roll = this.#random() * totalWeight;
    let acc = 0;

    for (let i = 0; i < candidates.length; i++) {
      acc += weights[i];

      if (roll <= acc) {
        return candidates[i];
      }
    }

    return candidates[candidates.length - 1] ?? null;
  }

  static #notify(callback, ...args) {
    if (typeof callback === "function") callback(...args);
  }

  static #updateCellPosition(cell, row, col) {
    if (!cell || typeof cell !== "object") return;
    if ("row" in cell) cell.row = row;
    if ("col" in cell) cell.col = col;
  }

  static #applyMovementEnergyCost(cell) {
    if (!cell || typeof cell !== "object" || cell.energy == null || !cell.dna) return;

    const baseCost =
      typeof cell.dna.moveCost === "function" ? cell.dna.moveCost() : 0.005;
    const ageScale =
      typeof cell.ageEnergyMultiplier === "function"
        ? cell.ageEnergyMultiplier(0.6)
        : 1;
    const cost = baseCost * ageScale;

    cell.energy = Math.max(0, cell.energy - cost);
  }

  static #completeMove({
    gridArr,
    moving,
    attempt,
    onMove,
    onCellMoved,
    activeCells,
    clearDestinationEnergy,
  }) {
    const { fromRow, fromCol, toRow, toCol } = attempt;

    gridArr[toRow][toCol] = moving;
    gridArr[fromRow][fromCol] = null;

    if (typeof clearDestinationEnergy === "function") {
      clearDestinationEnergy(toRow, toCol);
    }

    GridManager.#updateCellPosition(moving, toRow, toCol);
    GridManager.#applyMovementEnergyCost(moving);

    GridManager.#notify(onMove, {
      cell: moving,
      fromRow,
      fromCol,
      toRow,
      toCol,
    });
    GridManager.#notify(onCellMoved, moving, fromRow, fromCol, toRow, toCol);

    if (moving && activeCells && typeof activeCells.add === "function") {
      activeCells.add(moving);
    }
  }

  static tryMove(
    gridArr,
    sourceRow,
    sourceCol,
    deltaRow,
    deltaCol,
    rowCount,
    colCount,
    options = {},
  ) {
    const normalizedOptions = GridManager.#normalizeMoveOptions(options);
    const moving = gridArr[sourceRow]?.[sourceCol] ?? null;

    if (!moving) return false;

    const attempt = {
      fromRow: sourceRow,
      fromCol: sourceCol,
      toRow: sourceRow + deltaRow,
      toCol: sourceCol + deltaCol,
    };

    if (!Number.isInteger(deltaRow) || !Number.isInteger(deltaCol)) {
      GridManager.#notify(normalizedOptions.onBlocked, {
        reason: "range",
        row: sourceRow,
        col: sourceCol,
        nextRow: attempt.toRow,
        nextCol: attempt.toCol,
        mover: moving,
      });

      return false;
    }

    const rowDelta = Math.abs(deltaRow);
    const colDelta = Math.abs(deltaCol);

    if (rowDelta > 1 || colDelta > 1 || (rowDelta === 0 && colDelta === 0)) {
      GridManager.#notify(normalizedOptions.onBlocked, {
        reason: "range",
        row: sourceRow,
        col: sourceCol,
        nextRow: attempt.toRow,
        nextCol: attempt.toCol,
        mover: moving,
      });

      return false;
    }

    if (GridManager.#isOutOfBounds(attempt.toRow, attempt.toCol, rowCount, colCount)) {
      GridManager.#notify(normalizedOptions.onBlocked, {
        reason: "bounds",
        row: sourceRow,
        col: sourceCol,
        nextRow: attempt.toRow,
        nextCol: attempt.toCol,
        mover: moving,
      });

      return false;
    }

    if (
      GridManager.#isObstacle(normalizedOptions.obstacles, attempt.toRow, attempt.toCol)
    ) {
      GridManager.#notify(normalizedOptions.onBlocked, {
        reason: "obstacle",
        row: sourceRow,
        col: sourceCol,
        nextRow: attempt.toRow,
        nextCol: attempt.toCol,
        mover: moving,
      });

      return false;
    }

    if (gridArr[attempt.toRow][attempt.toCol]) return false;

    GridManager.#completeMove({
      gridArr,
      moving,
      attempt,
      onMove: normalizedOptions.onMove,
      onCellMoved: normalizedOptions.onCellMoved,
      activeCells: normalizedOptions.activeCells,
      clearDestinationEnergy: normalizedOptions.clearDestinationEnergy,
    });

    return true;
  }

  static moveToTarget(
    gridArr,
    row,
    col,
    targetRow,
    targetCol,
    rows,
    cols,
    options = {},
  ) {
    const best = GridManager.#chooseDirectionalStep({
      mode: "approach",
      gridArr,
      row,
      col,
      targetRow,
      targetCol,
      rows,
      cols,
      options,
    });

    if (best) {
      return GridManager.tryMove(
        gridArr,
        row,
        col,
        best.dr,
        best.dc,
        rows,
        cols,
        options,
      );
    }

    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let fallbackDr = 0;
    let fallbackDc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) fallbackDr = Math.sign(dRow);
    else fallbackDc = Math.sign(dCol);

    return GridManager.tryMove(
      gridArr,
      row,
      col,
      fallbackDr,
      fallbackDc,
      rows,
      cols,
      options,
    );
  }

  static moveAwayFromTarget(
    gridArr,
    row,
    col,
    targetRow,
    targetCol,
    rows,
    cols,
    options = {},
  ) {
    const best = GridManager.#chooseDirectionalStep({
      mode: "avoid",
      gridArr,
      row,
      col,
      targetRow,
      targetCol,
      rows,
      cols,
      options,
    });

    if (best) {
      return GridManager.tryMove(
        gridArr,
        row,
        col,
        best.dr,
        best.dc,
        rows,
        cols,
        options,
      );
    }

    const dRow = targetRow - row;
    const dCol = targetCol - col;
    let fallbackDr = 0;
    let fallbackDc = 0;

    if (Math.abs(dRow) >= Math.abs(dCol)) fallbackDr = -Math.sign(dRow);
    else fallbackDc = -Math.sign(dCol);

    return GridManager.tryMove(
      gridArr,
      row,
      col,
      fallbackDr,
      fallbackDc,
      rows,
      cols,
      options,
    );
  }

  // Picks a direction toward or away from a target by blending local context with
  // organism traits. This replaces the previous axis-aligned heuristic so pursuit
  // behavior emerges from DNA-tuned movement genes, crowding tolerance, and
  // resource appetites.
  static #chooseDirectionalStep({
    mode,
    gridArr,
    row,
    col,
    targetRow,
    targetCol,
    rows,
    cols,
    options = {},
  }) {
    const moving = gridArr?.[row]?.[col] ?? null;

    if (!moving) return null;

    const distBefore = Math.max(Math.abs(targetRow - row), Math.abs(targetCol - col));
    const candidates = [
      { dr: -1, dc: 0 },
      { dr: 1, dc: 0 },
      { dr: 0, dc: -1 },
      { dr: 0, dc: 1 },
    ];

    let bestDirection = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const direction of candidates) {
      const nextRow = row + direction.dr;
      const nextCol = col + direction.dc;

      if (GridManager.#isOutOfBounds(nextRow, nextCol, rows, cols)) continue;
      if (GridManager.#isObstacle(options?.obstacles, nextRow, nextCol)) continue;

      const occupant = gridArr?.[nextRow]?.[nextCol] ?? null;

      if (occupant && occupant !== moving) continue;

      const distAfter = Math.max(
        Math.abs(targetRow - nextRow),
        Math.abs(targetCol - nextCol),
      );
      const score = GridManager.#scoreDirectedMove({
        mode,
        moving,
        fromRow: row,
        fromCol: col,
        nextRow,
        nextCol,
        distBefore,
        distAfter,
        options,
      });

      if (score > bestScore) {
        bestScore = score;
        bestDirection = direction;
      }
    }

    return bestDirection;
  }

  // Scores a potential directed move using organism preferences plus
  // environmental context (energy gradient, local density, risk tolerance).
  static #scoreDirectedMove({
    mode,
    moving,
    fromRow,
    fromCol,
    nextRow,
    nextCol,
    distBefore,
    distAfter,
    options = {},
  }) {
    const movingGenes = moving?.movementGenes || {
      wandering: 0.33,
      pursuit: 0.33,
      cautious: 0.34,
    };
    const wandering = Math.max(0, movingGenes.wandering ?? 0);
    const pursuit = Math.max(0, movingGenes.pursuit ?? 0);
    const cautious = Math.max(0, movingGenes.cautious ?? 0);
    const total = wandering + pursuit + cautious || 1;
    const pursuitBias = pursuit / total;
    const cautiousBias = cautious / total;
    const roamingBias = wandering / total;
    const densityAt =
      typeof options.densityAt === "function"
        ? clamp(options.densityAt(nextRow, nextCol) ?? 0, 0, 1)
        : 0;
    const tolerance = clamp(
      Number.isFinite(moving?.baseCrowdingTolerance)
        ? moving.baseCrowdingTolerance
        : 0.5,
      0,
      1,
    );
    const densityGap = densityAt - tolerance;
    const maxTileEnergy =
      Number.isFinite(options.maxTileEnergy) && options.maxTileEnergy > 0
        ? options.maxTileEnergy
        : MAX_TILE_ENERGY;
    const energyAtFn = typeof options.energyAt === "function" ? options.energyAt : null;
    const energyCurrent = clamp(
      maxTileEnergy > 0 && energyAtFn
        ? (energyAtFn(fromRow, fromCol) ?? 0) / maxTileEnergy
        : 0,
      0,
      1,
    );
    const energyCandidate = clamp(
      maxTileEnergy > 0 && energyAtFn
        ? (energyAtFn(nextRow, nextCol) ?? 0) / maxTileEnergy
        : 0,
      0,
      1,
    );
    const energyDelta = energyCandidate - energyCurrent;
    const resourceDrive = clamp(
      Number.isFinite(moving?.resourceTrendAdaptation)
        ? moving.resourceTrendAdaptation
        : 0.35,
      0,
      1,
    );
    const riskTolerance = clamp(
      typeof moving?.getRiskTolerance === "function"
        ? moving.getRiskTolerance()
        : typeof moving?.baseRiskTolerance === "number"
          ? moving.baseRiskTolerance
          : 0.5,
      0,
      1,
    );
    const distanceDelta = distBefore - distAfter;
    let score = 0;

    if (mode === "approach") {
      score += distanceDelta * (0.6 + pursuitBias * 0.6);

      if (distanceDelta <= 0) {
        score += roamingBias * 0.05;
      }

      score += riskTolerance * pursuitBias * 0.2;
    } else {
      score += -distanceDelta * (0.6 + cautiousBias * 0.6);

      if (distanceDelta > 0) {
        score -= 0.4 + cautiousBias * 0.5;
      }

      score += (1 - riskTolerance) * cautiousBias * 0.25;
    }

    if (densityGap > 0) {
      score -= densityGap * (0.45 + cautiousBias * 0.45);
    } else if (densityGap < 0) {
      score += Math.abs(densityGap) * (0.2 + roamingBias * 0.3);
    }

    score += energyDelta * (0.25 + resourceDrive * 0.5);

    return score;
  }

  static moveRandomly(
    gridArr,
    row,
    col,
    cell,
    rows,
    cols,
    options = {},
    movementContext = null,
  ) {
    const { dr, dc } = cell.decideRandomMove(movementContext);

    return GridManager.tryMove(gridArr, row, col, dr, dc, rows, cols, options);
  }

  #acquireSpawnScratch() {
    if (!this.#spawnCandidateScratch) {
      this.#spawnCandidateScratch = {
        list: [],
        set: new Set(),
      };
    }

    this.#spawnCandidateScratch.list.length = 0;
    this.#spawnCandidateScratch.set.clear();

    return this.#spawnCandidateScratch;
  }

  #enqueueDecay(row, col, cell) {
    if (!cell || typeof cell !== "object") return;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    const energy = Number.isFinite(cell.energy) ? cell.energy : 0;

    if (energy <= DECAY_EPSILON) return;

    if (!this.decayAmount || this.decayAmount.length !== this.rows) {
      this.#initializeDecayBuffers(this.rows, this.cols);
    }

    const returned = energy * DECAY_RETURN_FRACTION;

    if (returned <= DECAY_EPSILON) return;

    let reserve = returned * (1 - DECAY_IMMEDIATE_SHARE);
    const immediate = returned - reserve;

    if (immediate > DECAY_EPSILON) {
      const leftover = this.#distributeEnergy(row, col, immediate);

      if (leftover > DECAY_EPSILON) {
        reserve += leftover;
      }
    }

    if (reserve <= DECAY_EPSILON) return;

    const rowStore = this.decayAmount[row];
    const ageRow = this.decayAge[row];

    if (!rowStore || !ageRow) return;

    rowStore[col] = (rowStore[col] || 0) + reserve;
    ageRow[col] = 0;
    this.decayActive.add(row * this.cols + col);
  }

  #applyDecayDeltas() {
    if (!this.decayDeltaPending || this.decayDeltaPending.size === 0) return;

    const deltaGrid = this.energyDeltaGrid;
    const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

    if (!deltaGrid || cap <= 0) {
      this.decayDeltaPending.clear();

      return;
    }

    const invCap = 1 / cap;

    for (const [key, amount] of this.decayDeltaPending.entries()) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) continue;

      const rowDeltas = deltaGrid[row];

      if (!rowDeltas) continue;

      const normalized = clamp(amount * invCap, -1, 1);
      const prior = Number.isFinite(rowDeltas[col]) ? rowDeltas[col] : 0;
      let next = prior + normalized;

      if (next < -1) next = -1;
      else if (next > 1) next = 1;

      rowDeltas[col] = next;
    }

    this.decayDeltaPending.clear();
  }

  #initializeDecayBuffers(rows, cols) {
    const rowCount = Math.max(0, Math.floor(rows));
    const colCount = Math.max(0, Math.floor(cols));

    this.decayAmount = Array.from({ length: rowCount }, () => Array(colCount).fill(0));
    this.decayAge = Array.from({ length: rowCount }, () => Array(colCount).fill(0));
    this.decayActive = new Set();
    this.decayDeltaPending = null;
  }

  #accumulateDecayDelta(row, col, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;

    if (!this.decayDeltaPending) {
      this.decayDeltaPending = new Map();
    }

    const key = row * this.cols + col;
    const current = this.decayDeltaPending.get(key) || 0;

    this.decayDeltaPending.set(key, current + amount);
  }

  #distributeEnergy(row, col, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return amount;

    const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

    if (cap <= 0) return amount;

    let remaining = amount;
    const energyRow = this.energyGrid?.[row];
    let touched = false;

    if (energyRow) {
      const before = Number.isFinite(energyRow[col]) ? energyRow[col] : 0;
      const capacity = Math.max(0, cap - before);

      if (capacity > 0) {
        const deposit = Math.min(capacity, remaining);

        if (deposit > 0) {
          energyRow[col] = before + deposit;
          this.#accumulateDecayDelta(row, col, deposit);
          remaining -= deposit;
          touched = true;
        }
      }
    }

    if (remaining <= DECAY_EPSILON) return 0;

    const obstacles = this.obstacles;

    for (let i = 0; i < NEIGHBOR_OFFSETS.length && remaining > DECAY_EPSILON; i++) {
      const [dr, dc] = NEIGHBOR_OFFSETS[i];
      const r = row + dr;
      const c = col + dc;

      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) continue;
      if (obstacles?.[r]?.[c]) continue;

      const neighborRow = this.energyGrid?.[r];

      if (!neighborRow) continue;

      const before = Number.isFinite(neighborRow[c]) ? neighborRow[c] : 0;
      const capacity = Math.max(0, cap - before);

      if (capacity <= 0) continue;

      const deposit = Math.min(capacity, remaining);

      if (deposit > 0) {
        neighborRow[c] = before + deposit;
        this.#accumulateDecayDelta(r, c, deposit);
        remaining -= deposit;
        touched = true;
      }
    }

    if (touched) {
      this.markEnergyDirty(row, col, { radius: 1 });
    }

    return remaining;
  }

  #processDecay() {
    if (!this.decayActive || this.decayActive.size === 0) {
      if (this.decayDeltaPending) this.decayDeltaPending.clear();

      return;
    }

    if (!this.decayAmount || this.decayAmount.length !== this.rows) {
      this.#initializeDecayBuffers(this.rows, this.cols);

      return;
    }

    if (!this.decayDeltaPending) {
      this.decayDeltaPending = new Map();
    } else {
      this.decayDeltaPending.clear();
    }

    const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

    if (cap <= 0) {
      this.decayActive.clear();

      for (let r = 0; r < this.decayAmount.length; r++) {
        const rowStore = this.decayAmount[r];
        const ageRow = this.decayAge?.[r];

        if (!rowStore || !ageRow) continue;

        rowStore.fill(0);
        ageRow.fill(0);
      }

      return;
    }

    const nextActive = new Set();

    for (const key of this.decayActive) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
        continue;
      }

      const rowStore = this.decayAmount[row];
      const ageRow = this.decayAge[row];

      if (!rowStore || !ageRow) continue;

      let pool = Number.isFinite(rowStore[col]) ? rowStore[col] : 0;

      if (pool <= DECAY_EPSILON) {
        rowStore[col] = 0;
        ageRow[col] = 0;

        continue;
      }

      const release = Math.min(pool, DECAY_RELEASE_BASE + pool * DECAY_RELEASE_RATE);
      const leftover = pool - release;
      const remainder = this.#distributeEnergy(row, col, release);
      const consumed = release - remainder;
      let nextAmount = leftover + remainder;
      let age = Number.isFinite(ageRow[col]) ? ageRow[col] : 0;

      if (consumed > DECAY_EPSILON) {
        age = 0;
      } else {
        age += 1;
      }

      if (nextAmount <= DECAY_EPSILON || age >= DECAY_MAX_AGE) {
        rowStore[col] = 0;
        ageRow[col] = 0;

        continue;
      }

      rowStore[col] = nextAmount;
      ageRow[col] = age;
      nextActive.add(key);
    }

    this.decayActive = nextActive;
  }

  constructor(rows, cols, options = {}) {
    const {
      eventManager,
      eventContext,
      ctx = null,
      cellSize = 8,
      stats,
      maxTileEnergy,
      initialTileEnergyFraction,
      selectionManager,
      initialObstaclePreset = "none",
      initialObstaclePresetOptions = {},
      randomizeInitialObstacles = false,
      randomObstaclePresetPool = null,
      obstaclePresets,
      rng,
      brainSnapshotCollector,
    } = options;
    const {
      eventManager: resolvedEventManager,
      ctx: resolvedCtx,
      cellSize: resolvedCellSize,
      stats: resolvedStats,
    } = resolveGridEnvironment({ eventManager, ctx, cellSize, stats }, GLOBAL);

    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    this.#initializeOccupancy(this.rows);
    this.maxTileEnergy =
      typeof maxTileEnergy === "number" ? maxTileEnergy : GridManager.maxTileEnergy;
    // Consumers can tune how energetic the world starts without touching the
    // core constant by supplying a fraction of the tile cap. The sanitizer keeps
    // the value in the 0..1 range so overrides remain deterministic.
    this.initialTileEnergyFraction = resolveInitialTileEnergyFraction(
      initialTileEnergyFraction,
    );
    this.initialTileEnergy = this.maxTileEnergy * this.initialTileEnergyFraction;
    this.energyGrid = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => this.initialTileEnergy),
    );
    this.energyNext = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.energyDeltaGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.pendingOccupantRegen = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.#initializeDecayBuffers(rows, cols);
    this.obstacles = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.#resetObstacleRenderCache();
    this.eventManager = resolvedEventManager;
    this.eventContext = createEventContext(eventContext);
    this.eventEffectCache = new Map();
    this.ctx = resolvedCtx;
    this.cellSize = resolvedCellSize;
    this.stats = resolvedStats;
    this.renderStrategy =
      typeof options?.renderStrategy === "string" ? options.renderStrategy : "auto";
    this.renderDirtyTiles = new Set();
    this.renderStats = {
      frameCount: 0,
      lastFrameMs: 0,
      avgFrameMs: 0,
      lastCellLoopMs: 0,
      avgCellLoopMs: 0,
      lastObstacleLoopMs: 0,
      avgObstacleLoopMs: 0,
      fps: 0,
      mode: "canvas",
      lastDirtyTileCount: 0,
      lastProcessedTiles: 0,
      lastPaintedCells: 0,
      refreshType: "none",
      timestamp: 0,
    };
    this.#resetImageDataBuffer();
    this.energyDirtyTiles = new Set();
    this.energyTimerNow =
      typeof options?.performanceNow === "function"
        ? options.performanceNow
        : TIMESTAMP_NOW;
    this.obstaclePresets = resolveObstaclePresetCatalog(obstaclePresets);
    const knownPresetIds = new Set(
      this.obstaclePresets
        .map((preset) => (typeof preset?.id === "string" ? preset.id : null))
        .filter((id) => typeof id === "string" && id.length > 0),
    );
    const sanitizedRandomPool = Array.isArray(randomObstaclePresetPool)
      ? randomObstaclePresetPool
          .map((id) => (typeof id === "string" ? id.trim() : ""))
          .filter((id) => id && knownPresetIds.has(id))
      : null;

    this.randomObstaclePresetPool =
      sanitizedRandomPool && sanitizedRandomPool.length > 0
        ? sanitizedRandomPool
        : null;
    this.reproductionZones = new ReproductionZonePolicy();
    Object.defineProperty(this, "selectionManager", {
      configurable: true,
      enumerable: true,
      get: () => this.reproductionZones.getSelectionManager(),
      set: (manager) => {
        this.reproductionZones.setSelectionManager(manager);
      },
    });
    this.selectionManager = selectionManager || null;
    const initialThreshold =
      typeof stats?.matingDiversityThreshold === "number"
        ? clamp(stats.matingDiversityThreshold, 0, 1)
        : 0.42;

    this.matingDiversityThreshold = initialThreshold;
    // Raised alongside the config default so kin-heavy stretches still produce
    // offspring instead of stalling out when penalty math bottoms out.
    this.lowDiversityReproMultiplier = 0.57;
    this.densityRadius = GridManager.DENSITY_RADIUS;
    this.densityCounts = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    this.densityLiveGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityGrid = Array.from({ length: rows }, () => Array(cols).fill(0));
    this.densityDirtyTiles = new Set();
    this.lastSnapshot = null;
    this.minPopulation = GridManager.#computeMinPopulation(rows, cols);
    this.currentObstaclePreset = "none";
    this.tickCount = 0;
    this.rng = typeof rng === "function" ? rng : Math.random;
    this.activeCells = new Set();
    this.cellPositions = new WeakMap();
    this.cellPositionTelemetry = { mismatches: 0, lastTick: 0 };
    this.onMoveCallback = (payload) => this.#handleCellMoved(payload);
    this.interactionAdapter = new GridInteractionAdapter({ gridManager: this });
    this.interactionSystem = new InteractionSystem({
      adapter: this.interactionAdapter,
      combatTerritoryEdgeFactor: GridManager.combatTerritoryEdgeFactor,
    });
    this.populationScarcitySignal = 0;
    this.brainSnapshotCollector = toBrainSnapshotCollector(brainSnapshotCollector);
    this.boundTryMove = (
      gridArr,
      sourceRow,
      sourceCol,
      deltaRow,
      deltaCol,
      rowCount,
      colCount,
    ) =>
      GridManager.tryMove(
        gridArr,
        sourceRow,
        sourceCol,
        deltaRow,
        deltaCol,
        rowCount,
        colCount,
        this.#movementOptions(),
      );
    this.boundMoveToTarget = (gridArr, row, col, targetRow, targetCol, rows, cols) =>
      GridManager.moveToTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rows,
        cols,
        this.#movementOptions(),
      );
    this.boundMoveAwayFromTarget = (
      gridArr,
      row,
      col,
      targetRow,
      targetCol,
      rows,
      cols,
    ) =>
      GridManager.moveAwayFromTarget(
        gridArr,
        row,
        col,
        targetRow,
        targetCol,
        rows,
        cols,
        this.#movementOptions(),
      );
    this.#targetGroupsView = {
      mates: this.#targetScratch.mates,
      enemies: this.#targetScratch.enemies,
      society: this.#targetScratch.society,
    };
    this.boundMoveRandomly = (gridArr, row, col, cell, rows, cols, movementContext) =>
      GridManager.moveRandomly(
        gridArr,
        row,
        col,
        cell,
        rows,
        cols,
        this.#movementOptions(),
        movementContext,
      );
    const resolvedPresetId = this.#resolveInitialObstaclePreset({
      initialPreset: initialObstaclePreset,
      randomize: randomizeInitialObstacles,
      pool: randomObstaclePresetPool,
    });

    if (resolvedPresetId && resolvedPresetId !== "none") {
      const presetOptions = this.#resolvePresetOptions(
        resolvedPresetId,
        initialObstaclePresetOptions,
      );

      this.applyObstaclePreset(resolvedPresetId, {
        clearExisting: true,
        append: false,
        presetOptions,
        evict: true,
      });
    }
    this.init();
    this.recalculateDensityCounts();
    this.rebuildActiveCells();
  }

  #movementOptions() {
    return {
      obstacles: this.obstacles,
      onMove: this.onMoveCallback,
      activeCells: this.activeCells,
      onCellMoved: (cell, fromRow, fromCol, toRow, toCol) => {
        if (!cell) return;

        this.#shiftOccupancy(fromRow, fromCol, toRow, toCol);
        this.activeCells.add(cell);
        this.#trackCellPosition(cell, toRow, toCol);
      },
      densityAt: (r, c) => this.densityGrid?.[r]?.[c] ?? this.getDensityAt(r, c),
      energyAt: (r, c) => this.energyGrid?.[r]?.[c] ?? 0,
      maxTileEnergy: this.maxTileEnergy,
      clearDestinationEnergy: (r, c) => clearTileEnergyBuffers(this, r, c),
    };
  }

  #initializeOccupancy(rowCount) {
    const rows = Math.max(0, Math.floor(Number.isFinite(rowCount) ? rowCount : 0));

    this.#rowOccupancy = Array.from({ length: rows }, () => new Set());
  }

  #resetOccupancyTracking() {
    if (!Array.isArray(this.#rowOccupancy) || this.#rowOccupancy.length !== this.rows) {
      this.#initializeOccupancy(this.rows);

      return;
    }

    for (let i = 0; i < this.#rowOccupancy.length; i++) {
      const bucket = this.#rowOccupancy[i];

      if (bucket) bucket.clear();
    }
  }

  #recordOccupancy(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    if (!Array.isArray(this.#rowOccupancy) || this.#rowOccupancy.length !== this.rows) {
      this.#initializeOccupancy(this.rows);
    }

    let bucket = this.#rowOccupancy[row];

    if (!bucket) {
      bucket = new Set();
      this.#rowOccupancy[row] = bucket;
    }

    bucket.add(col);
  }

  #releaseOccupancy(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;

    this.#rowOccupancy?.[row]?.delete?.(col);
  }

  #shiftOccupancy(fromRow, fromCol, toRow, toCol) {
    this.#releaseOccupancy(fromRow, fromCol);
    this.#recordOccupancy(toRow, toCol);
  }

  #trackCellPosition(cell, row, col) {
    if (
      !cell ||
      typeof cell !== "object" ||
      !Number.isInteger(row) ||
      !Number.isInteger(col)
    ) {
      if (cell) this.#untrackCell(cell);

      return;
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      this.#untrackCell(cell);

      return;
    }

    cell.row = row;
    cell.col = col;

    const existing = this.cellPositions.get(cell);

    if (existing) {
      existing.row = row;
      existing.col = col;
    } else {
      this.cellPositions.set(cell, { row, col });
    }
  }

  #untrackCell(cell) {
    if (!cell) return;

    this.cellPositions.delete(cell);
  }

  #clearTrackedPositions() {
    this.cellPositions = new WeakMap();
  }

  #isValidLocation(row, col, cell) {
    return (
      Number.isInteger(row) &&
      Number.isInteger(col) &&
      row >= 0 &&
      row < this.rows &&
      col >= 0 &&
      col < this.cols &&
      this.grid[row]?.[col] === cell
    );
  }

  #scanForCell(cell) {
    for (let r = 0; r < this.rows; r++) {
      const gridRow = this.grid[r];

      if (!gridRow) continue;

      for (let c = 0; c < this.cols; c++) {
        if (gridRow[c] === cell) {
          return { row: r, col: c };
        }
      }
    }

    return null;
  }

  #recordCellPositionMismatch() {
    if (!this.cellPositionTelemetry) {
      this.cellPositionTelemetry = { mismatches: 0, lastTick: 0 };
    }

    this.cellPositionTelemetry.mismatches += 1;
    this.cellPositionTelemetry.lastTick = this.tickCount;
    warnOnce(
      "GridManager detected inconsistent cell coordinates; resynchronizing tracked positions.",
    );
  }

  #resolveCellCoordinates(cell) {
    if (!cell) return null;

    const tracked = this.cellPositions.get(cell);

    if (tracked && this.#isValidLocation(tracked.row, tracked.col, cell)) {
      return { row: tracked.row, col: tracked.col };
    }

    if (tracked) {
      this.#untrackCell(cell);
    }

    const directRow = Number.isInteger(cell.row) ? cell.row : null;
    const directCol = Number.isInteger(cell.col) ? cell.col : null;

    if (this.#isValidLocation(directRow, directCol, cell)) {
      this.#trackCellPosition(cell, directRow, directCol);

      return { row: directRow, col: directCol };
    }

    if (directRow != null || directCol != null) {
      this.#untrackCell(cell);
    }

    const located = this.#scanForCell(cell);

    if (!located) return null;

    if (tracked) {
      this.#recordCellPositionMismatch();
    }
    this.#trackCellPosition(cell, located.row, located.col);

    return located;
  }

  #random() {
    return typeof this.rng === "function" ? this.rng() : Math.random();
  }

  #getPresetById(id) {
    if (typeof id !== "string") return null;

    const trimmed = id.trim();

    if (!trimmed) return null;

    const catalog =
      Array.isArray(this.obstaclePresets) && this.obstaclePresets.length > 0
        ? this.obstaclePresets
        : OBSTACLE_PRESETS;

    return catalog.find((preset) => preset?.id === trimmed) ?? null;
  }

  #pickRandomObstaclePresetId(poolIds = null) {
    let candidates =
      Array.isArray(this.obstaclePresets) && this.obstaclePresets.length > 0
        ? this.obstaclePresets
        : OBSTACLE_PRESETS;

    if (Array.isArray(poolIds) && poolIds.length > 0) {
      const normalized = poolIds.map((id) => this.#getPresetById(id)).filter(Boolean);

      if (normalized.length > 0) candidates = normalized;
    }

    if (!candidates || candidates.length === 0) return null;

    // Treat the "none" preset as an explicit opt-out. Randomization should favour
    // actual obstacle layouts so users who ask for a randomized map do not
    // occasionally receive the empty field. When "none" is the only available
    // option (e.g. custom pools), keep it as the fallback.
    const usableCandidates = candidates.filter((preset) => preset?.id !== "none");
    const pool = usableCandidates.length > 0 ? usableCandidates : candidates;
    const index = Math.floor(this.#random() * pool.length);

    return pool[index]?.id ?? null;
  }

  #resolveInitialObstaclePreset({
    initialPreset,
    randomize = false,
    pool = null,
  } = {}) {
    if (randomize || initialPreset === "random") {
      return this.#pickRandomObstaclePresetId(pool);
    }

    if (typeof initialPreset === "string") {
      const match = this.#getPresetById(initialPreset);

      return match ? match.id : null;
    }

    return null;
  }

  #resolvePresetOptions(presetId, presetOptionsInput) {
    if (!presetId) return {};
    if (typeof presetOptionsInput === "function") {
      const result = presetOptionsInput(presetId);

      return result && typeof result === "object" ? result : {};
    }

    if (
      presetOptionsInput &&
      typeof presetOptionsInput === "object" &&
      !Array.isArray(presetOptionsInput)
    ) {
      if (Object.prototype.hasOwnProperty.call(presetOptionsInput, presetId)) {
        const scoped = presetOptionsInput[presetId];

        return scoped && typeof scoped === "object" ? scoped : {};
      }

      return presetOptionsInput;
    }

    return {};
  }

  setSelectionManager(selectionManager) {
    this.reproductionZones.setSelectionManager(selectionManager);
  }

  setBrainSnapshotCollector(collector) {
    this.brainSnapshotCollector = toBrainSnapshotCollector(collector);
  }

  setMatingDiversityOptions({ threshold, lowDiversityMultiplier } = {}) {
    if (threshold !== undefined) {
      const numeric = Number(threshold);

      if (Number.isFinite(numeric)) {
        this.matingDiversityThreshold = clamp(numeric, 0, 1);
      }
    } else if (typeof this.stats?.matingDiversityThreshold === "number") {
      this.matingDiversityThreshold = clamp(this.stats.matingDiversityThreshold, 0, 1);
    }

    if (lowDiversityMultiplier !== undefined) {
      const numeric = Number(lowDiversityMultiplier);

      if (Number.isFinite(numeric)) {
        this.lowDiversityReproMultiplier = clamp(numeric, 0, 1);
      }
    }
  }

  isObstacle(row, col) {
    return Boolean(this.obstacles?.[row]?.[col]);
  }

  isTileBlocked(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;

    return this.isObstacle(row, col);
  }

  #clearTileEnergy(row, col, { includeNext = true } = {}) {
    if (this.energyGrid?.[row]) {
      this.energyGrid[row][col] = 0;
    }

    if (includeNext && this.energyNext?.[row]) {
      this.energyNext[row][col] = 0;
    }

    this.markEnergyDirty(row, col, { radius: 1 });
  }

  #redistributeEnergyToNeighbors(row, col, amount, { previousEnergyGrid = null } = {}) {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }

    const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

    if (!(cap > 0)) {
      return 0;
    }

    const neighbors = [
      [row - 1, col],
      [row + 1, col],
      [row, col - 1],
      [row, col + 1],
    ];

    let remaining = amount;

    let touched = false;

    for (const [nRow, nCol] of neighbors) {
      if (!Number.isInteger(nRow) || !Number.isInteger(nCol)) continue;
      if (nRow < 0 || nRow >= this.rows || nCol < 0 || nCol >= this.cols) continue;
      if (this.isObstacle(nRow, nCol)) continue;
      if (this.grid?.[nRow]?.[nCol]) continue;

      const energyRow = this.energyGrid?.[nRow];

      if (!energyRow) continue;

      const before = Number.isFinite(energyRow[nCol]) ? energyRow[nCol] : 0;
      const capacity = Math.max(0, cap - before);

      if (capacity <= 0) continue;

      const deposit = Math.min(capacity, remaining);

      if (deposit <= 0) continue;

      energyRow[nCol] = before + deposit;
      remaining -= deposit;
      touched = true;

      const deltaRow = this.energyDeltaGrid?.[nRow];

      if (deltaRow) {
        const previous = previousEnergyGrid?.[nRow]?.[nCol];

        if (Number.isFinite(previous)) {
          deltaRow[nCol] = clamp((energyRow[nCol] - previous) / cap, -1, 1);
        } else {
          deltaRow[nCol] = clamp(energyRow[nCol] / cap, -1, 1);
        }
      }

      if (remaining <= 0) break;
    }

    if (touched) {
      this.markEnergyDirty(row, col, { radius: 1 });
    }

    return remaining;
  }

  #applyEnergyExclusivityAt(
    row,
    col,
    cell,
    { previousEnergyGrid = null, absorb = true } = {},
  ) {
    const energyRow = this.energyGrid?.[row];

    if (!energyRow) return;

    const storedBefore = Number.isFinite(energyRow[col]) ? energyRow[col] : 0;

    if (storedBefore <= 0) {
      if (storedBefore !== 0) energyRow[col] = 0;
      const deltaRow = this.energyDeltaGrid?.[row];

      if (deltaRow && Number.isFinite(deltaRow[col])) {
        const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

        if (cap > 0) {
          const previous = previousEnergyGrid?.[row]?.[col];

          if (Number.isFinite(previous)) {
            deltaRow[col] = clamp((energyRow[col] - previous) / cap, -1, 1);
          } else {
            deltaRow[col] = clamp(energyRow[col] / cap, -1, 1);
          }
        }
      }

      return;
    }

    const cap = this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

    let remaining = storedBefore;

    if (absorb && cell && typeof cell === "object" && typeof cell.energy === "number") {
      const currentEnergy = Number.isFinite(cell.energy) ? cell.energy : 0;
      const availableCapacity = Math.max(0, cap - currentEnergy);

      if (availableCapacity > 0) {
        const absorbed = Math.min(availableCapacity, remaining);

        if (absorbed > 0) {
          cell.energy = clamp(currentEnergy + absorbed, 0, cap);
          remaining -= absorbed;
        }
      }
    }

    if (remaining > 0) {
      remaining = this.#redistributeEnergyToNeighbors(row, col, remaining, {
        previousEnergyGrid,
      });
    }

    energyRow[col] = 0;

    const deltaRow = this.energyDeltaGrid?.[row];

    if (deltaRow) {
      const previous = previousEnergyGrid?.[row]?.[col];

      if (Number.isFinite(previous) && cap > 0) {
        deltaRow[col] = clamp((0 - previous) / cap, -1, 1);
      } else if (cap > 0) {
        deltaRow[col] = clamp(-storedBefore / cap, -1, 0);
      } else {
        deltaRow[col] = 0;
      }
    }

    this.markEnergyDirty(row, col, { radius: 1 });
  }

  #enforceEnergyExclusivity({ previousEnergyGrid = null } = {}) {
    if (!this.grid || !this.energyGrid) return;
    const activeCells = this.activeCells;
    const hasActiveCells = Boolean(activeCells && activeCells.size > 0);

    if (hasActiveCells) {
      let fallbackScanNeeded = false;

      for (const cell of activeCells) {
        if (!cell) continue;

        let location = null;

        if (this.cellPositions && typeof this.cellPositions.get === "function") {
          location = this.cellPositions.get(cell) || null;
        }

        if (
          !location ||
          !Number.isInteger(location.row) ||
          !Number.isInteger(location.col) ||
          this.grid?.[location.row]?.[location.col] !== cell
        ) {
          if (!this.#ensureTrackedCell(cell)) {
            fallbackScanNeeded = true;

            continue;
          }

          location = this.cellPositions.get(cell) || null;

          if (!location) {
            fallbackScanNeeded = true;

            continue;
          }
        }

        this.#applyEnergyExclusivityAt(location.row, location.col, cell, {
          previousEnergyGrid,
        });
      }

      if (!fallbackScanNeeded) {
        return;
      }
    } else {
      const hasRecordedOccupancy = Array.isArray(this.#rowOccupancy)
        ? this.#rowOccupancy.some((bucket) => bucket && bucket.size > 0)
        : false;

      if (!hasRecordedOccupancy) {
        return;
      }
    }

    for (let row = 0; row < this.rows; row++) {
      const gridRow = this.grid[row];

      if (!gridRow) continue;

      for (let col = 0; col < this.cols; col++) {
        const cell = gridRow[col];

        if (!cell) continue;

        this.#applyEnergyExclusivityAt(row, col, cell, { previousEnergyGrid });
      }
    }
  }

  clearObstacles() {
    let changed = false;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.obstacles[r][c]) {
          this.obstacles[r][c] = false;
          changed = true;
        }
      }
    }
    if (changed) {
      this.#markObstacleRenderDirty();
    }

    this.currentObstaclePreset = "none";
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const wasBlocked = this.obstacles[row][col];

    if (!blocked) {
      if (wasBlocked) {
        this.obstacles[row][col] = false;
        this.#markObstacleRenderDirty();
      } else {
        this.obstacles[row][col] = false;
      }

      return true;
    }

    this.obstacles[row][col] = true;

    if (!wasBlocked) {
      const occupant = this.grid[row][col];

      if (occupant && evict) {
        const removed = this.removeCell(row, col);

        if (removed) {
          this.registerDeath(removed, { row, col, cause: "obstacle" });
        }
      }
      this.#markObstacleRenderDirty();
    }

    this.#clearTileEnergy(row, col);

    return true;
  }

  _paintWallLine(
    axis,
    index,
    {
      spanStart = 0,
      spanEnd = axis === "vertical" ? this.rows - 1 : this.cols - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {},
  ) {
    const isVertical = axis === "vertical";
    const primaryLimit = isVertical ? this.rows : this.cols;
    const secondaryLimit = isVertical ? this.cols : this.rows;
    const normalizedStart = Math.max(0, Math.floor(spanStart));
    const normalizedEnd = Math.min(primaryLimit - 1, Math.floor(spanEnd));
    const thicknessValue = Math.max(1, Math.floor(thickness));

    for (let offset = 0; offset < thicknessValue; offset++) {
      const secondaryIndex = index + offset;

      if (secondaryIndex < 0 || secondaryIndex >= secondaryLimit) continue;
      for (let primary = normalizedStart; primary <= normalizedEnd; primary++) {
        if (gapEvery > 0) {
          const idx = primary - normalizedStart + gapOffset;

          if (idx % gapEvery === 0) continue;
        }

        if (isVertical) {
          this.setObstacle(primary, secondaryIndex, true, { evict });
        } else {
          this.setObstacle(secondaryIndex, primary, true, { evict });
        }
      }
    }
  }

  paintVerticalWall(
    col,
    {
      startRow = 0,
      endRow = this.rows - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {},
  ) {
    this._paintWallLine("vertical", col, {
      spanStart: startRow,
      spanEnd: endRow,
      gapEvery,
      gapOffset,
      thickness,
      evict,
    });
  }

  paintHorizontalWall(
    row,
    {
      startCol = 0,
      endCol = this.cols - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {},
  ) {
    this._paintWallLine("horizontal", row, {
      spanStart: startCol,
      spanEnd: endCol,
      gapEvery,
      gapOffset,
      thickness,
      evict,
    });
  }

  paintCheckerboard({
    tileSize = 2,
    offsetRow = 0,
    offsetCol = 0,
    blockParity = 0,
    evict = true,
  } = {}) {
    const size = Math.max(1, Math.floor(tileSize));
    const normalizeParity = (value) => ((value % 2) + 2) % 2;
    const targetParity = normalizeParity(blockParity);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tileR = Math.floor((r + offsetRow) / size);
        const tileC = Math.floor((c + offsetCol) / size);
        const parity = normalizeParity(tileR + tileC);

        if (parity === targetParity) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  paintPerimeter({ thickness = 1, evict = true } = {}) {
    const t = Math.max(1, Math.floor(thickness));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const onEdge = r < t || r >= this.rows - t || c < t || c >= this.cols - t;

        if (onEdge) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  applyObstaclePreset(
    presetId,
    { clearExisting = true, append = false, presetOptions = {}, evict = true } = {},
  ) {
    const normalizedId =
      typeof presetId === "string"
        ? presetId.trim()
        : presetId === "none"
          ? "none"
          : "";
    const isClearPreset = normalizedId === "none";
    const isKnownPreset = isClearPreset || this.#getPresetById(normalizedId) != null;

    if (!isKnownPreset) {
      warnOnce(`Unknown obstacle preset "${presetId}"; ignoring request.`);

      return;
    }

    if (clearExisting && !append) this.clearObstacles();
    const options = presetOptions || {};

    switch (normalizedId) {
      case "none":
        if (clearExisting) this.clearObstacles();
        break;
      case "midline": {
        const col = Math.floor(this.cols / 2);
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 10));
        const gapOffset = Math.floor(options.gapOffset ?? gapEvery / 2);
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintVerticalWall(col, { gapEvery, gapOffset, thickness, evict });
        break;
      }
      case "corridor": {
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 12));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const first = Math.max(1, Math.floor(this.cols / 3));
        const second = Math.min(this.cols - 2, Math.floor((2 * this.cols) / 3));

        this.paintVerticalWall(first, { gapEvery, thickness, evict });
        this.paintVerticalWall(second, {
          gapEvery,
          thickness,
          evict,
          gapOffset: Math.floor(gapEvery / 2),
        });
        break;
      }
      case "checkerboard": {
        const tileSize = Math.max(1, Math.floor(options.tileSize ?? 2));
        const offsetRow = Math.floor(options.offsetRow ?? 0);
        const offsetCol = Math.floor(options.offsetCol ?? 0);
        const rawBlockParity = Math.floor(options.blockParity ?? 0);
        const blockParity = ((rawBlockParity % 2) + 2) % 2;

        this.paintCheckerboard({ tileSize, offsetRow, offsetCol, blockParity, evict });
        break;
      }
      case "perimeter": {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintPerimeter({ thickness, evict });
        break;
      }
      case "sealed-quadrants": {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 2));
        const halfThickness = Math.floor(thickness / 2);
        const centerCol = Math.max(0, Math.floor(this.cols / 2) - halfThickness);
        const centerRow = Math.max(0, Math.floor(this.rows / 2) - halfThickness);

        this.paintVerticalWall(centerCol, {
          gapEvery: 0,
          thickness,
          evict,
        });
        this.paintHorizontalWall(centerRow, {
          gapEvery: 0,
          thickness,
          evict,
        });
        if (options.perimeter) {
          const perimeterThickness = Math.max(1, Math.floor(options.perimeter));

          this.paintPerimeter({ thickness: perimeterThickness, evict });
        }
        break;
      }
      case "sealed-chambers": {
        const rows = Math.max(2, Math.floor(options.rows ?? 3));
        const cols = Math.max(2, Math.floor(options.cols ?? 3));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const rowStep = Math.max(1, Math.floor(this.rows / rows));
        const colStep = Math.max(1, Math.floor(this.cols / cols));

        for (let r = 1; r < rows; r++) {
          const rowIndex = Math.min(this.rows - 1, r * rowStep);

          this.paintHorizontalWall(rowIndex, { thickness, evict });
        }

        for (let c = 1; c < cols; c++) {
          const colIndex = Math.min(this.cols - 1, c * colStep);

          this.paintVerticalWall(colIndex, { thickness, evict });
        }

        if (options.perimeter !== false) {
          const perimeterThickness = Math.max(
            1,
            Math.floor(options.perimeter ?? thickness),
          );

          this.paintPerimeter({ thickness: perimeterThickness, evict });
        }
        break;
      }
      case "corner-islands": {
        const moat = Math.max(1, Math.floor(options.moat ?? 3));
        const gapRows = Math.max(moat, Math.floor(options.gapRows ?? moat));
        const gapCols = Math.max(moat, Math.floor(options.gapCols ?? moat));
        const maxIslandRows = Math.max(3, this.rows - 3 * gapRows);
        const maxIslandCols = Math.max(3, this.cols - 3 * gapCols);
        const islandRows = Math.max(
          3,
          Math.min(Math.floor(options.islandRows ?? maxIslandRows / 2), maxIslandRows),
        );
        const islandCols = Math.max(
          3,
          Math.min(Math.floor(options.islandCols ?? maxIslandCols / 2), maxIslandCols),
        );
        const topStart = Math.max(0, gapRows);
        const leftStart = Math.max(0, gapCols);
        const rightStart = Math.max(0, this.cols - gapCols - islandCols);
        const bottomStart = Math.max(0, this.rows - gapRows - islandRows);
        const safeTop = Math.min(topStart, this.rows - islandRows);
        const safeBottom = Math.min(bottomStart, this.rows - islandRows);
        const safeLeft = Math.min(leftStart, this.cols - islandCols);
        const safeRight = Math.min(rightStart, this.cols - islandCols);
        const baseEnergy = this.initialTileEnergy;

        const isInsideIsland = (row, col) =>
          (row >= safeTop &&
            row < safeTop + islandRows &&
            col >= safeLeft &&
            col < safeLeft + islandCols) ||
          (row >= safeTop &&
            row < safeTop + islandRows &&
            col >= safeRight &&
            col < safeRight + islandCols) ||
          (row >= safeBottom &&
            row < safeBottom + islandRows &&
            col >= safeLeft &&
            col < safeLeft + islandCols) ||
          (row >= safeBottom &&
            row < safeBottom + islandRows &&
            col >= safeRight &&
            col < safeRight + islandCols);

        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (isInsideIsland(r, c)) {
              if (this.isObstacle(r, c)) {
                this.setObstacle(r, c, false, { evict });
              }
              if (this.energyGrid?.[r]) this.energyGrid[r][c] = baseEnergy;
              if (this.energyNext?.[r]) this.energyNext[r][c] = 0;
            } else {
              this.setObstacle(r, c, true, { evict });
            }
          }
        }
        break;
      }
      default:
        break;
    }

    this.currentObstaclePreset = normalizedId;
  }

  init() {
    this.#resetOccupancyTracking();
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.isObstacle(row, col)) continue;
        if (this.#random() < 0.05) {
          const dna = DNA.random(() => this.#random());

          this.spawnCell(row, col, { dna });
        }
      }
    }

    this.#seedInitialPopulation(this.minPopulation);
  }

  resize(rows, cols, options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    const nextRows = sanitizePositiveInteger(rows, {
      fallback: this.rows,
    });
    const nextCols = sanitizePositiveInteger(cols, {
      fallback: this.cols,
    });
    const nextCellSize = sanitizePositiveInteger(opts.cellSize, {
      fallback: this.cellSize,
    });

    const changed =
      nextRows !== this.rows ||
      nextCols !== this.cols ||
      (Number.isFinite(nextCellSize) && nextCellSize !== this.cellSize);
    const wantsPresetUpdate =
      opts.randomizeObstacles === true ||
      (typeof opts.obstaclePreset === "string" &&
        opts.obstaclePreset.trim().length > 0) ||
      typeof opts.presetOptions === "function" ||
      (opts.presetOptions &&
        typeof opts.presetOptions === "object" &&
        Object.keys(opts.presetOptions).length > 0);
    const wantsReseed = opts.reseed === true;

    if (!changed && !wantsPresetUpdate && !wantsReseed) {
      return { rows: this.rows, cols: this.cols, cellSize: this.cellSize };
    }

    const rowsInt = nextRows;
    const colsInt = nextCols;
    const cellSizeValue = nextCellSize;
    const baseEnergy = this.initialTileEnergy;
    const shouldReseed = opts.reseed === true;
    const preservePopulation = !shouldReseed;
    let preservedCells = null;

    if (preservePopulation) {
      preservedCells = [];

      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          const cell = this.grid?.[row]?.[col];

          if (!cell) continue;

          const tileEnergy = Number.isFinite(this.energyGrid?.[row]?.[col])
            ? this.energyGrid[row][col]
            : baseEnergy;

          preservedCells.push({ cell, row, col, tileEnergy });
        }
      }
    }

    this.rows = rowsInt;
    this.cols = colsInt;
    this.cellSize = cellSizeValue;
    this.grid = Array.from({ length: rowsInt }, () => Array(colsInt).fill(null));
    this.#initializeOccupancy(this.rows);
    this.energyGrid = Array.from({ length: rowsInt }, () =>
      Array.from({ length: colsInt }, () => baseEnergy),
    );
    this.energyNext = Array.from({ length: rowsInt }, () => Array(colsInt).fill(0));
    this.energyDeltaGrid = Array.from({ length: rowsInt }, () =>
      Array(colsInt).fill(0),
    );
    this.pendingOccupantRegen = Array.from({ length: rowsInt }, () =>
      Array(colsInt).fill(0),
    );
    this.#initializeDecayBuffers(rowsInt, colsInt);
    this.obstacles = Array.from({ length: rowsInt }, () => Array(colsInt).fill(false));
    this.#resetObstacleRenderCache();
    this.#resetImageDataBuffer();
    this.densityCounts = Array.from({ length: rowsInt }, () => Array(colsInt).fill(0));
    this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    this.densityLiveGrid = Array.from({ length: rowsInt }, () =>
      Array(colsInt).fill(0),
    );
    this.densityGrid = Array.from({ length: rowsInt }, () => Array(colsInt).fill(0));
    this.densityDirtyTiles?.clear?.();
    this.activeCells.clear();
    this.#clearTrackedPositions();
    this.tickCount = 0;
    this.cellPositionTelemetry = { mismatches: 0, lastTick: 0 };
    this.lastSnapshot = null;
    this.eventEffectCache?.clear?.();
    this.minPopulation = GridManager.#computeMinPopulation(rowsInt, colsInt);

    if (this.selectionManager?.setDimensions) {
      this.selectionManager.setDimensions(rowsInt, colsInt);
    }

    const resolvedPreset = this.#resolveInitialObstaclePreset({
      initialPreset:
        opts.randomizeObstacles === true
          ? "random"
          : typeof opts.obstaclePreset === "string"
            ? opts.obstaclePreset
            : this.currentObstaclePreset,
      randomize: Boolean(opts.randomizeObstacles),
      pool: this.randomObstaclePresetPool,
    });

    if (resolvedPreset && resolvedPreset !== "none") {
      const presetOptions = this.#resolvePresetOptions(
        resolvedPreset,
        opts.presetOptions,
      );

      this.applyObstaclePreset(resolvedPreset, {
        clearExisting: true,
        append: false,
        presetOptions,
        evict: true,
      });
    } else {
      this.currentObstaclePreset = "none";
    }

    if (preservePopulation && preservedCells?.length) {
      const maxTileEnergy =
        this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;

      for (const { cell, row, col, tileEnergy } of preservedCells) {
        if (row >= rowsInt || col >= colsInt) continue;
        if (this.isObstacle(row, col)) continue;
        if (this.grid[row][col]) continue;

        this.grid[row][col] = cell;
        this.#recordOccupancy(row, col);
        this.#trackCellPosition(cell, row, col);
        this.#markTileDirty(row, col);

        if (cell && typeof cell === "object" && typeof cell.energy === "number") {
          cell.energy = clamp(cell.energy, 0, maxTileEnergy);
        }

        if (this.energyGrid?.[row]) {
          const sanitizedEnergy = Number.isFinite(tileEnergy)
            ? clamp(tileEnergy, 0, maxTileEnergy)
            : baseEnergy;

          this.energyGrid[row][col] = sanitizedEnergy;
        }
      }
    }

    if (shouldReseed) {
      this.init();
    }
    this.recalculateDensityCounts();
    this.rebuildActiveCells();
    this.#enforceEnergyExclusivity({ previousEnergyGrid: null });

    return { rows: this.rows, cols: this.cols, cellSize: this.cellSize };
  }

  resetWorld({
    randomizeObstacles = false,
    obstaclePreset = null,
    presetOptions = null,
    reseed = false,
    clearCustomZones = false,
  } = {}) {
    const baseEnergy = this.initialTileEnergy;

    this.#markAllTilesDirty();
    this.#resetOccupancyTracking();

    for (let row = 0; row < this.rows; row++) {
      const gridRow = this.grid[row];
      const energyRow = this.energyGrid[row];
      const nextRow = this.energyNext?.[row];
      const deltaRow = this.energyDeltaGrid?.[row];
      const obstacleRow = this.obstacles?.[row];
      const densityCountRow = this.densityCounts?.[row];
      const densityLiveRow = this.densityLiveGrid?.[row];
      const densityRow = this.densityGrid?.[row];

      for (let col = 0; col < this.cols; col++) {
        if (gridRow) gridRow[col] = null;
        if (energyRow) energyRow[col] = baseEnergy;
        if (nextRow) nextRow[col] = 0;
        if (deltaRow) deltaRow[col] = 0;
        if (obstacleRow) obstacleRow[col] = false;
        if (densityCountRow) densityCountRow[col] = 0;
        if (densityLiveRow) densityLiveRow[col] = 0;
        if (densityRow) densityRow[col] = 0;
        if (this.pendingOccupantRegen?.[row]) {
          this.pendingOccupantRegen[row][col] = 0;
        }
      }
    }

    this.activeCells.clear();
    this.#clearTrackedPositions();
    this.tickCount = 0;
    this.cellPositionTelemetry = { mismatches: 0, lastTick: 0 };
    this.lastSnapshot = null;
    this.densityDirtyTiles?.clear?.();
    this.eventEffectCache?.clear?.();
    this.#initializeDecayBuffers(this.rows, this.cols);
    this.#markObstacleRenderDirty();

    if (
      clearCustomZones &&
      typeof this.reproductionZones?.clearActiveZones === "function"
    ) {
      this.reproductionZones.clearActiveZones();
    }

    const shouldRandomize = Boolean(randomizeObstacles);
    let targetPreset = obstaclePreset;

    if (shouldRandomize) {
      targetPreset = this.#pickRandomObstaclePresetId(this.randomObstaclePresetPool);
    }

    if (typeof targetPreset !== "string" || targetPreset.length === 0) {
      targetPreset = this.currentObstaclePreset || "none";
    }

    const presetArgs = {
      clearExisting: true,
      presetOptions: presetOptions ?? {},
      evict: true,
    };

    this.applyObstaclePreset(targetPreset, presetArgs);

    if (reseed === true) {
      this.init();
    }

    this.recalculateDensityCounts();
    this.rebuildActiveCells();
  }

  #seedInitialPopulation(targetPopulation) {
    const target = Math.max(0, Math.floor(targetPopulation ?? 0));
    const currentPopulation = this.activeCells?.size ?? 0;

    if (currentPopulation >= target) return;

    const scarcitySignal = clamp(
      Number.isFinite(this.populationScarcitySignal)
        ? this.populationScarcitySignal
        : this.#computePopulationScarcitySignal(),
      0,
      1,
    );
    const energyFloorFrac = clamp(0.35 + scarcitySignal * 0.15, 0.35, 0.85);
    const spawnBufferFrac = clamp(0.05 + scarcitySignal * 0.05, 0.05, 0.12);
    const maxSpawnAttempts = 6;
    const empties = [];
    const viable = [];

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.getCell(r, c) || this.isObstacle(r, c)) continue;

        const availableEnergy = Math.max(0, this.energyGrid?.[r]?.[c] ?? 0);
        const normalizedEnergy =
          this.maxTileEnergy > 0
            ? clamp(availableEnergy / this.maxTileEnergy, 0, 1)
            : 0;
        const density = clamp(this.getDensityAt(r, c) ?? 0, 0, 1);
        const entry = {
          row: r,
          col: c,
          availableEnergy,
          score: normalizedEnergy * 0.7 + (1 - density) * 0.3,
        };

        empties.push(entry);

        if (normalizedEnergy >= energyFloorFrac) {
          viable.push(entry);
        }
      }
    }

    if (empties.length === 0) return;

    viable.sort((a, b) => b.score - a.score);

    const requiredSeeds = Math.min(target - currentPopulation, empties.length);

    let seedsPlaced = 0;

    while (seedsPlaced < requiredSeeds) {
      const pool = viable.length > 0 ? viable : empties;

      if (pool.length === 0) break;
      const bandSize =
        pool === viable
          ? Math.max(1, Math.min(pool.length, Math.ceil(pool.length * 0.2)))
          : pool.length;
      const pickIndex = Math.min(
        pool.length - 1,
        Math.floor(this.#random() * bandSize),
      );
      const candidate = pool.splice(pickIndex, 1)[0];

      if (pool !== empties) {
        const emptyIndex = empties.indexOf(candidate);

        if (emptyIndex !== -1) {
          empties.splice(emptyIndex, 1);
        }
      }

      if (pool !== viable) {
        const viableIndex = viable.indexOf(candidate);

        if (viableIndex !== -1) {
          viable.splice(viableIndex, 1);
        }
      }

      const { row, col, availableEnergy } = candidate;
      const normalizedAvailable =
        this.maxTileEnergy > 0 ? clamp(availableEnergy / this.maxTileEnergy, 0, 1) : 0;

      if (normalizedAvailable <= 0) {
        continue;
      }

      let spawned = false;

      for (let attempt = 0; attempt < maxSpawnAttempts; attempt++) {
        const dna = DNA.random(() => this.#random());
        const starvationFrac = clamp(dna.starvationThresholdFrac(), 0, 1);
        const spawnTargetFrac = clamp(
          starvationFrac + spawnBufferFrac,
          energyFloorFrac,
          0.95,
        );

        if (spawnTargetFrac - normalizedAvailable > 1e-6) {
          continue;
        }

        const spawnEnergy = Math.min(
          availableEnergy,
          this.maxTileEnergy * spawnTargetFrac,
        );

        if (!(spawnEnergy > 0)) {
          continue;
        }

        const offspring = this.spawnCell(row, col, {
          dna,
          spawnEnergy,
          recordBirth: true,
        });

        if (offspring) {
          spawned = true;
          break;
        }
      }

      if (spawned) {
        seedsPlaced += 1;
      }
    }
  }

  consumeEnergy(
    cell,
    row,
    col,
    densityGrid = this.densityGrid,
    densityEffectMultiplier = 1,
  ) {
    const available = this.energyGrid[row][col];
    // DNA-driven harvest with density penalty
    const baseRate =
      typeof cell.dna.forageRate === "function" ? cell.dna.forageRate() : 0.4;
    const base = clamp(baseRate, 0.05, 1);
    const density =
      densityGrid?.[row]?.[col] ??
      this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const effDensity = clamp((density ?? 0) * densityEffectMultiplier, 0, 1);
    const tileEnergyDelta = this.energyDeltaGrid?.[row]?.[col] ?? 0;
    const normalizedTileEnergy =
      this.maxTileEnergy > 0 ? clamp(available / this.maxTileEnergy, 0, 1) : 0;
    const crowdPenalty =
      typeof cell?.resolveHarvestCrowdingPenalty === "function"
        ? cell.resolveHarvestCrowdingPenalty({
            density: effDensity,
            tileEnergy: normalizedTileEnergy,
            tileEnergyDelta,
            baseRate: base,
            availableEnergy: available,
            maxTileEnergy: this.maxTileEnergy,
          })
        : Math.max(0, 1 - CONSUMPTION_DENSITY_PENALTY * effDensity);
    const minCap =
      typeof cell.dna.harvestCapMin === "function" ? cell.dna.harvestCapMin() : 0.1;
    const maxCapRaw =
      typeof cell.dna.harvestCapMax === "function" ? cell.dna.harvestCapMax() : 0.5;
    const maxCap = Math.max(minCap, clamp(maxCapRaw, minCap, 1));
    const cap = clamp(base * crowdPenalty, minCap, maxCap);
    const take = Math.min(cap, available);

    this.energyGrid[row][col] -= take;
    cell.energy = Math.min(this.maxTileEnergy, cell.energy + take);
    this.markEnergyDirty(row, col, { radius: 1 });
  }

  regenerateEnergyGrid(
    events = null,
    eventStrengthMultiplier = 1,
    R = GridManager.energyRegenRate,
    D = GridManager.energyDiffusionRate,
    densityGrid = null,
    densityEffectMultiplier = 1,
  ) {
    const rows = this.rows;
    const cols = this.cols;
    const evs = Array.isArray(events) ? events : events ? [events] : EMPTY_EVENT_LIST;
    const hasEvents = evs.length > 0;
    const hasDensityGrid = Array.isArray(densityGrid);
    const energyGrid = this.energyGrid;
    const next = this.energyNext;
    const deltaGrid = this.energyDeltaGrid;
    const obstacles = this.obstacles;
    const occupantRegenGrid = this.pendingOccupantRegen;
    const { isEventAffecting, getEventEffect } =
      this.eventContext ?? defaultEventContext;
    const regenRate = Number.isFinite(R) ? R : 0;
    const diffusionRate = Number.isFinite(D) ? D : 0;
    const useDiffusion = diffusionRate !== 0;
    const maxTileEnergy = this.maxTileEnergy;
    const invMaxTileEnergy = maxTileEnergy > 0 ? 1 / maxTileEnergy : 1;
    const normalizedDensityMultiplier = Number.isFinite(densityEffectMultiplier)
      ? densityEffectMultiplier
      : 1;
    const normalizedEventStrengthMultiplier = Number.isFinite(eventStrengthMultiplier)
      ? eventStrengthMultiplier
      : 1;
    const effectCache = getEventEffect ? this.eventEffectCache : null;
    const usingSegmentedEvents =
      hasEvents && isEventAffecting === defaultIsEventAffecting;
    const eventModifierScratch = this.#getEventModifierScratch();
    const eventOptions = hasEvents
      ? {
          events: evs,
          row: 0,
          col: 0,
          eventStrengthMultiplier: normalizedEventStrengthMultiplier,
          isEventAffecting,
          getEventEffect,
          effectCache,
          collectAppliedEvents: false,
          result: eventModifierScratch,
        }
      : null;
    const profileEnabled = typeof this.stats?.recordEnergyStageTimings === "function";
    const now =
      profileEnabled && typeof this.energyTimerNow === "function"
        ? this.energyTimerNow
        : profileEnabled
          ? TIMESTAMP_NOW
          : null;
    const startTime = profileEnabled ? now() : 0;

    let eventsByRow = null;

    if (hasEvents) {
      eventsByRow = this.#prepareEventsByRow(rows);

      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i];
        const area = ev?.affectedArea;

        if (!area) continue;

        const startRow = Math.max(0, Math.floor(area.y));
        const endRow = Math.min(rows, Math.ceil(area.y + area.height));

        if (startRow >= endRow) continue;

        if (usingSegmentedEvents) {
          const startCol = Math.max(0, Math.floor(area.x));
          const endCol = Math.min(cols, Math.ceil(area.x + area.width));

          if (startCol >= endCol) continue;

          for (let rr = startRow; rr < endRow; rr++) {
            if (!eventsByRow[rr]) eventsByRow[rr] = [];
            eventsByRow[rr].push({ event: ev, startCol, endCol });
          }
        } else {
          for (let rr = startRow; rr < endRow; rr++) {
            if (!eventsByRow[rr]) eventsByRow[rr] = [];
            eventsByRow[rr].push(ev);
          }
        }
      }

      if (usingSegmentedEvents && eventsByRow) {
        for (let r = 0; r < eventsByRow.length; r++) {
          const rowEvents = eventsByRow[r];

          if (Array.isArray(rowEvents) && rowEvents.length > 1) {
            rowEvents.sort((a, b) => a.startCol - b.startCol);
          }
        }
      }
    }

    const totalTiles = rows * cols;
    const dirtyCount = this.energyDirtyTiles ? this.energyDirtyTiles.size : 0;
    const preferSparse =
      totalTiles > 0 &&
      dirtyCount > 0 &&
      dirtyCount < totalTiles &&
      dirtyCount / totalTiles <= ENERGY_SPARSE_SCAN_RATIO;

    const processTileBase = (
      r,
      c,
      energyRow,
      nextRow,
      deltaRow,
      densityRow,
      obstacleRow,
      gridRow,
      upEnergyRow,
      downEnergyRow,
      upObstacleRow,
      downObstacleRow,
      occupantRegenRow,
      regenMultiplier = 1,
      regenAdd = 0,
      drain = 0,
    ) => {
      if (!nextRow || !energyRow) return;

      if (obstacleRow?.[c]) {
        nextRow[c] = 0;
        if (energyRow[c] !== 0) energyRow[c] = 0;
        if (deltaRow) deltaRow[c] = 0;

        return;
      }

      const densityRowValue = densityRow ? densityRow[c] : null;
      const baseDensity =
        densityRowValue == null
          ? this.localDensity(r, c, GridManager.DENSITY_RADIUS)
          : densityRowValue;
      let effectiveDensity = (baseDensity ?? 0) * normalizedDensityMultiplier;

      if (effectiveDensity <= 0) {
        effectiveDensity = 0;
      } else if (effectiveDensity >= 1) {
        effectiveDensity = 1;
      }

      const currentEnergy = Number.isFinite(energyRow?.[c]) ? energyRow[c] : 0;
      let regen = maxTileEnergy > 0 ? regenRate * (maxTileEnergy - currentEnergy) : 0;
      const regenPenalty = 1 - REGEN_DENSITY_PENALTY * effectiveDensity;

      if (regenPenalty <= 0) {
        regen = 0;
      } else {
        regen *= regenPenalty;
      }

      regen = regen * regenMultiplier + regenAdd;

      let neighborSum = 0;
      let neighborCount = 0;

      if (useDiffusion) {
        if (upEnergyRow && (!upObstacleRow || !upObstacleRow[c])) {
          neighborSum += upEnergyRow[c];
          neighborCount += 1;
        }

        if (downEnergyRow && (!downObstacleRow || !downObstacleRow[c])) {
          neighborSum += downEnergyRow[c];
          neighborCount += 1;
        }

        if (c > 0 && (!obstacleRow || !obstacleRow[c - 1])) {
          neighborSum += energyRow[c - 1];
          neighborCount += 1;
        }

        if (c < cols - 1 && (!obstacleRow || !obstacleRow[c + 1])) {
          neighborSum += energyRow[c + 1];
          neighborCount += 1;
        }
      }

      let diffusion = 0;

      if (neighborCount > 0) {
        diffusion = diffusionRate * (neighborSum / neighborCount - currentEnergy);
      }

      let nextEnergy = currentEnergy + regen - drain + diffusion;

      if (nextEnergy <= 0) {
        nextEnergy = 0;
      } else if (nextEnergy >= maxTileEnergy) {
        nextEnergy = maxTileEnergy;
      }

      if (gridRow?.[c]) {
        if (occupantRegenRow) occupantRegenRow[c] = nextEnergy;

        nextRow[c] = 0;
        if (energyRow[c] !== 0) energyRow[c] = 0;
        if (deltaRow) deltaRow[c] = 0;

        return;
      }

      nextRow[c] = nextEnergy;

      if (deltaRow) {
        let normalizedDelta = (nextEnergy - currentEnergy) * invMaxTileEnergy;

        if (normalizedDelta < -1) {
          normalizedDelta = -1;
        } else if (normalizedDelta > 1) {
          normalizedDelta = 1;
        }

        deltaRow[c] = normalizedDelta;
      }
    };

    const processTileWithEvents = hasEvents
      ? (
          r,
          c,
          energyRow,
          nextRow,
          deltaRow,
          densityRow,
          obstacleRow,
          gridRow,
          upEnergyRow,
          downEnergyRow,
          upObstacleRow,
          downObstacleRow,
          occupantRegenRow,
          eventsForTile,
        ) => {
          let regenMultiplier = 1;
          let regenAdd = 0;
          let drain = 0;

          if (eventOptions && eventsForTile && eventsForTile.length > 0) {
            const previousEvents = eventOptions.events;

            eventOptions.row = r;
            eventOptions.col = c;
            eventOptions.events = eventsForTile;

            const modifiers = accumulateEventModifiers(eventOptions);

            if (modifiers) {
              regenMultiplier = modifiers.regenMultiplier;
              regenAdd = modifiers.regenAdd;
              drain = modifiers.drainAdd;
            }

            eventOptions.events = previousEvents;
          }

          processTileBase(
            r,
            c,
            energyRow,
            nextRow,
            deltaRow,
            densityRow,
            obstacleRow,
            gridRow,
            upEnergyRow,
            downEnergyRow,
            upObstacleRow,
            downObstacleRow,
            occupantRegenRow,
            regenMultiplier,
            regenAdd,
            drain,
          );
        }
      : null;

    const processTile = hasEvents
      ? (
          r,
          c,
          energyRow,
          nextRow,
          deltaRow,
          densityRow,
          obstacleRow,
          gridRow,
          upEnergyRow,
          downEnergyRow,
          upObstacleRow,
          downObstacleRow,
          occupantRegenRow,
          eventsForTile,
        ) =>
          processTileWithEvents(
            r,
            c,
            energyRow,
            nextRow,
            deltaRow,
            densityRow,
            obstacleRow,
            gridRow,
            upEnergyRow,
            downEnergyRow,
            upObstacleRow,
            downObstacleRow,
            occupantRegenRow,
            eventsForTile,
          )
      : (
          r,
          c,
          energyRow,
          nextRow,
          deltaRow,
          densityRow,
          obstacleRow,
          gridRow,
          upEnergyRow,
          downEnergyRow,
          upObstacleRow,
          downObstacleRow,
          occupantRegenRow,
        ) =>
          processTileBase(
            r,
            c,
            energyRow,
            nextRow,
            deltaRow,
            densityRow,
            obstacleRow,
            gridRow,
            upEnergyRow,
            downEnergyRow,
            upObstacleRow,
            downObstacleRow,
            occupantRegenRow,
          );

    let processedTileCount = 0;
    let strategy = "full-scan";

    if (preferSparse) {
      const sparseColumns = this.#prepareSparseDirtyColumns(rows);
      const sparseRows = this.#getSparseDirtyRowList();

      for (const key of this.energyDirtyTiles) {
        if (!Number.isFinite(key)) continue;

        const row = Math.floor(key / cols);
        const col = key % cols;

        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;

        const columnList = sparseColumns[row];

        if (columnList.length === 0) {
          sparseRows.push(row);
        }

        columnList.push(col);
      }

      if (sparseRows.length > 0) {
        strategy = "sparse-dirty";

        sparseRows.sort((a, b) => a - b);

        if (deltaGrid) {
          for (let r = 0; r < rows; r++) {
            const deltaRow = deltaGrid[r];

            if (deltaRow) deltaRow.fill(0);
          }
        }

        for (let i = 0; i < sparseRows.length; i++) {
          const r = sparseRows[i];
          const columns = sparseColumns[r];

          if (!columns || columns.length === 0) continue;

          const energyRow = energyGrid[r];
          const nextRow = next[r];

          if (!energyRow || !nextRow) continue;

          const deltaRow = deltaGrid ? deltaGrid[r] : null;
          const densityRow = hasDensityGrid ? densityGrid[r] : null;
          const obstacleRow = obstacles[r];
          const gridRow = this.grid[r];
          const upEnergyRow = r > 0 ? energyGrid[r - 1] : null;
          const downEnergyRow = r < rows - 1 ? energyGrid[r + 1] : null;
          const upObstacleRow = r > 0 ? obstacles[r - 1] : null;
          const downObstacleRow = r < rows - 1 ? obstacles[r + 1] : null;
          const occupantRegenRow = occupantRegenGrid ? occupantRegenGrid[r] : null;

          const columnCount = columns.length;

          if (columnCount > 1) {
            columns.sort((a, b) => a - b);
          }

          if (occupantRegenRow) {
            const preferFill = columnCount * 2 >= cols;

            if (preferFill) {
              occupantRegenRow.fill(0);
            } else {
              for (let j = 0; j < columnCount; j++) {
                const targetCol = columns[j];

                if (targetCol >= 0 && targetCol < cols) {
                  occupantRegenRow[targetCol] = 0;
                }
              }
            }
          }

          const rowEvents = hasEvents
            ? eventsByRow
              ? (eventsByRow[r] ?? EMPTY_EVENT_LIST)
              : evs
            : EMPTY_EVENT_LIST;
          const rowHasEvents = hasEvents && rowEvents.length > 0;
          const useSegmentedForRow = rowHasEvents && usingSegmentedEvents;

          const segments = useSegmentedForRow ? rowEvents : null;
          const activeSegments =
            useSegmentedForRow && segments ? this.#getSegmentWindowScratch() : null;
          const columnEventsScratch =
            useSegmentedForRow && segments ? this.#getColumnEventScratch() : null;
          let nextSegmentIndex = 0;
          const collectEventsForColumn =
            useSegmentedForRow && segments && columnEventsScratch && activeSegments
              ? (column) => {
                  while (
                    nextSegmentIndex < segments.length &&
                    segments[nextSegmentIndex].startCol <= column
                  ) {
                    activeSegments.push(segments[nextSegmentIndex]);
                    nextSegmentIndex += 1;
                  }

                  let nextActiveCount = 0;

                  columnEventsScratch.length = 0;

                  for (let k = 0; k < activeSegments.length; k++) {
                    const segment = activeSegments[k];

                    if (segment.endCol > column) {
                      activeSegments[nextActiveCount] = segment;
                      nextActiveCount += 1;
                      columnEventsScratch.push(segment.event);
                    }
                  }

                  activeSegments.length = nextActiveCount;

                  return columnEventsScratch.length > 0 ? columnEventsScratch : null;
                }
              : null;
          const lastEventsCache = [];
          let lastModifiers = null;

          for (let j = 0; j < columns.length; j++) {
            const c = columns[j];

            if (c < 0 || c >= cols) continue;

            let eventsForTile = null;

            if (rowHasEvents) {
              if (collectEventsForColumn) {
                eventsForTile = collectEventsForColumn(c);
              } else if (!useSegmentedForRow) {
                eventsForTile = rowEvents;
              }
            }

            let regenMultiplier = 1;
            let regenAdd = 0;
            let drain = 0;

            if (eventsForTile && eventOptions) {
              const reuse =
                Boolean(lastModifiers) &&
                lastEventsCache.length === eventsForTile.length &&
                eventsForTile.every((event, index) => lastEventsCache[index] === event);

              if (reuse) {
                ({ regenMultiplier, regenAdd, drain } = lastModifiers);
              } else {
                const previousEvents = eventOptions.events;

                eventOptions.row = r;
                eventOptions.col = c;
                eventOptions.events = eventsForTile;

                const modifiers = accumulateEventModifiers(eventOptions);

                if (modifiers) {
                  regenMultiplier = modifiers.regenMultiplier;
                  regenAdd = modifiers.regenAdd;
                  drain = modifiers.drainAdd;
                }

                eventOptions.events = previousEvents;
                lastEventsCache.length = 0;

                for (let k = 0; k < (eventsForTile?.length ?? 0); k++) {
                  lastEventsCache.push(eventsForTile[k]);
                }

                lastModifiers = { regenMultiplier, regenAdd, drain };
              }
            } else {
              lastModifiers = null;
              lastEventsCache.length = 0;
            }

            processTileBase(
              r,
              c,
              energyRow,
              nextRow,
              deltaRow,
              densityRow,
              obstacleRow,
              gridRow,
              upEnergyRow,
              downEnergyRow,
              upObstacleRow,
              downObstacleRow,
              occupantRegenRow,
              regenMultiplier,
              regenAdd,
              drain,
            );
            processedTileCount += 1;
            energyRow[c] = nextRow[c];
          }
        }
      }
    }

    if (strategy !== "sparse-dirty") {
      processedTileCount = 0;

      for (let r = 0; r < rows; r++) {
        const energyRow = energyGrid[r];
        const nextRow = next[r];
        const deltaRow = deltaGrid ? deltaGrid[r] : null;
        const densityRow = hasDensityGrid ? densityGrid[r] : null;
        const obstacleRow = obstacles[r];
        const gridRow = this.grid[r];
        const upEnergyRow = r > 0 ? energyGrid[r - 1] : null;
        const downEnergyRow = r < rows - 1 ? energyGrid[r + 1] : null;
        const upObstacleRow = r > 0 ? obstacles[r - 1] : null;
        const downObstacleRow = r < rows - 1 ? obstacles[r + 1] : null;
        const occupantRegenRow = occupantRegenGrid ? occupantRegenGrid[r] : null;

        if (occupantRegenRow) occupantRegenRow.fill(0);

        const rowEvents = hasEvents
          ? eventsByRow
            ? (eventsByRow[r] ?? EMPTY_EVENT_LIST)
            : evs
          : EMPTY_EVENT_LIST;
        const rowHasEvents = hasEvents && rowEvents.length > 0;

        if (rowHasEvents && usingSegmentedEvents) {
          const segments = rowEvents;

          const activeSegments = this.#getSegmentWindowScratch();
          const columnEvents = this.#getColumnEventScratch();
          const lastEventsCache = [];
          let lastModifiers = null;
          let nextSegmentIndex = 0;

          for (let c = 0; c < cols; c++) {
            const isObstacle = Boolean(obstacleRow?.[c]);

            while (
              nextSegmentIndex < segments.length &&
              segments[nextSegmentIndex].startCol <= c
            ) {
              activeSegments.push(segments[nextSegmentIndex]);
              nextSegmentIndex += 1;
            }

            let nextActiveCount = 0;

            columnEvents.length = 0;

            for (let i = 0; i < activeSegments.length; i++) {
              const segment = activeSegments[i];

              if (segment.endCol > c) {
                activeSegments[nextActiveCount] = segment;
                nextActiveCount += 1;

                if (!isObstacle) {
                  columnEvents.push(segment.event);
                }
              }
            }

            activeSegments.length = nextActiveCount;

            const eventsForTile = columnEvents.length > 0 ? columnEvents : null;

            let regenMultiplier = 1;
            let regenAdd = 0;
            let drain = 0;

            if (eventsForTile && eventOptions) {
              let reuse = false;

              if (lastModifiers && lastEventsCache.length === eventsForTile.length) {
                reuse = true;

                for (let i = 0; i < eventsForTile.length; i++) {
                  if (lastEventsCache[i] !== eventsForTile[i]) {
                    reuse = false;

                    break;
                  }
                }
              }

              if (reuse) {
                ({ regenMultiplier, regenAdd, drain } = lastModifiers);
              } else {
                const previousEvents = eventOptions.events;

                eventOptions.row = r;
                eventOptions.col = c;
                eventOptions.events = eventsForTile;

                const modifiers = accumulateEventModifiers(eventOptions);

                if (modifiers) {
                  regenMultiplier = modifiers.regenMultiplier;
                  regenAdd = modifiers.regenAdd;
                  drain = modifiers.drainAdd;
                }

                eventOptions.events = previousEvents;
                lastEventsCache.length = 0;

                for (let i = 0; i < (eventsForTile?.length ?? 0); i++) {
                  lastEventsCache.push(eventsForTile[i]);
                }

                lastModifiers = { regenMultiplier, regenAdd, drain };
              }
            } else {
              lastModifiers = null;
              lastEventsCache.length = 0;
            }

            processTileBase(
              r,
              c,
              energyRow,
              nextRow,
              deltaRow,
              densityRow,
              obstacleRow,
              gridRow,
              upEnergyRow,
              downEnergyRow,
              upObstacleRow,
              downObstacleRow,
              occupantRegenRow,
              regenMultiplier,
              regenAdd,
              drain,
            );
            processedTileCount += 1;
          }

          if (activeSegments) {
            activeSegments.length = 0;
          }

          continue;
        }

        const eventsForRow = rowHasEvents ? rowEvents : null;

        for (let c = 0; c < cols; c++) {
          processTile(
            r,
            c,
            energyRow,
            nextRow,
            deltaRow,
            densityRow,
            obstacleRow,
            gridRow,
            upEnergyRow,
            downEnergyRow,
            upObstacleRow,
            downObstacleRow,
            occupantRegenRow,
            eventsForRow,
          );
          processedTileCount += 1;
        }
      }
    }

    if (profileEnabled) {
      const totalTime = now() - startTime;
      const tileCount = strategy === "sparse-dirty" ? processedTileCount : rows * cols;

      this.stats.recordEnergyStageTimings({
        segmentation: 0,
        density: 0,
        diffusion: 0,
        total: totalTime,
        tileCount,
        strategy,
      });
    }

    if (this.energyDirtyTiles) {
      this.energyDirtyTiles.clear();
    }

    // Swap buffers so the freshly computed grid becomes the active state.
    const previous = this.energyGrid;

    this.energyGrid = next;
    this.energyNext = previous;
  }

  getCell(row, col) {
    return this.grid[row][col];
  }

  setCell(row, col, cell, options = {}) {
    if (!cell) {
      this.removeCell(row, col);

      return null;
    }

    return this.placeCell(row, col, cell, options);
  }

  clearCell(row, col) {
    this.removeCell(row, col);
  }

  placeCell(row, col, cell, options = {}) {
    if (!cell) return null;
    const current = this.grid[row][col];

    if (current === cell) return cell;
    if (current) this.removeCell(row, col);

    this.grid[row][col] = cell;
    this.#recordOccupancy(row, col);
    this.#markTileDirty(row, col);
    clearTileEnergyBuffers(this, row, col);
    this.#trackCellPosition(cell, row, col);
    this.activeCells.add(cell);
    this.#applyDensityDelta(row, col, 1);

    const absorbTileEnergy = Boolean(options?.absorbTileEnergy);

    if (absorbTileEnergy) {
      this.#applyEnergyExclusivityAt(row, col, cell, {
        previousEnergyGrid: this.energyNext,
      });
    }

    return cell;
  }

  removeCell(row, col) {
    const current = this.grid[row]?.[col];

    if (!current) return null;

    this.grid[row][col] = null;
    this.#releaseOccupancy(row, col);
    this.#markTileDirty(row, col);
    this.activeCells.delete(current);
    this.#untrackCell(current);
    this.#applyDensityDelta(row, col, -1);
    this.markEnergyDirty(row, col, { radius: 1 });

    return current;
  }

  registerDeath(cell, details = {}) {
    if (!cell || typeof cell !== "object") return;

    const provided = details && typeof details === "object" ? details : {};
    let row = Number.isInteger(provided.row) ? provided.row : null;
    let col = Number.isInteger(provided.col) ? provided.col : null;

    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      if (this.#ensureTrackedCell(cell)) {
        const tracked = this.cellPositions.get(cell);

        if (tracked) {
          row = tracked.row;
          col = tracked.col;
        }
      }

      if (!Number.isInteger(row) || !Number.isInteger(col)) {
        if (Number.isInteger(cell.row) && Number.isInteger(cell.col)) {
          row = cell.row;
          col = cell.col;
        }
      }
    }

    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return;
    }

    this.#enqueueDecay(row, col, cell);

    if (this.stats?.onDeath) {
      const metadata = { ...provided, row, col };

      this.stats.onDeath(cell, metadata);
    }
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    if (fromRow === toRow && fromCol === toCol) return true;

    if (
      !Number.isInteger(fromRow) ||
      !Number.isInteger(fromCol) ||
      !Number.isInteger(toRow) ||
      !Number.isInteger(toCol)
    ) {
      return false;
    }

    if (
      GridManager.#isOutOfBounds(fromRow, fromCol, this.rows, this.cols) ||
      GridManager.#isOutOfBounds(toRow, toCol, this.rows, this.cols)
    ) {
      return false;
    }

    const rowDelta = Math.abs(toRow - fromRow);
    const colDelta = Math.abs(toCol - fromCol);

    if (rowDelta > 1 || colDelta > 1 || (rowDelta === 0 && colDelta === 0)) {
      return false;
    }
    const moving = this.grid[fromRow]?.[fromCol];

    if (!moving) return false;
    if (this.grid[toRow]?.[toCol]) return false;

    this.grid[toRow][toCol] = moving;
    this.grid[fromRow][fromCol] = null;
    this.#markTileDirty(fromRow, fromCol);
    this.#markTileDirty(toRow, toCol);
    clearTileEnergyBuffers(this, toRow, toCol, { preserveCurrent: true });
    this.#trackCellPosition(moving, toRow, toCol);
    this.#applyDensityDelta(fromRow, fromCol, -1);
    this.#applyDensityDelta(toRow, toCol, 1);
    this.#applyEnergyExclusivityAt(toRow, toCol, moving, {
      previousEnergyGrid: this.energyNext,
    });

    return true;
  }

  #handleCellMoved({ fromRow, fromCol, toRow, toCol }) {
    this.#markTileDirty(fromRow, fromCol);
    this.#markTileDirty(toRow, toCol);
    this.#applyDensityDelta(fromRow, fromCol, -1);
    this.#applyDensityDelta(toRow, toCol, 1);
  }

  #applyDensityDelta(row, col, delta, radius = this.densityRadius) {
    if (!this.densityCounts) return;

    const totals = this.densityTotals;
    const liveGrid = this.densityLiveGrid;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        const countsRow = this.densityCounts[rr];
        const nextCount = (countsRow[cc] || 0) + delta;

        countsRow[cc] = nextCount;

        if (!liveGrid || !totals) continue;

        const total = totals[rr]?.[cc] ?? 0;
        const nextDensity = total > 0 ? clamp(nextCount / total, 0, 1) : 0;

        if (liveGrid[rr][cc] !== nextDensity) {
          liveGrid[rr][cc] = nextDensity;
          this.#markDensityDirty(rr, cc);
        }
      }
    }
  }

  #buildDensityTotals(radius = this.densityRadius) {
    const rows = Math.max(0, Math.floor(this.rows));
    const cols = Math.max(0, Math.floor(this.cols));

    if (rows === 0 || cols === 0) {
      return [];
    }

    const normalizedRadius = Math.max(
      0,
      Math.floor(Number.isFinite(radius) ? radius : (this.densityRadius ?? 0)),
    );

    if (normalizedRadius === 0) {
      return Array.from({ length: rows }, () => Array(cols).fill(0));
    }

    const rowSpans = new Array(rows);

    for (let r = 0; r < rows; r++) {
      const minRow = r - normalizedRadius < 0 ? 0 : r - normalizedRadius;
      const maxRow = r + normalizedRadius >= rows ? rows - 1 : r + normalizedRadius;

      rowSpans[r] = maxRow - minRow + 1;
    }

    const colSpans = new Array(cols);

    for (let c = 0; c < cols; c++) {
      const minCol = c - normalizedRadius < 0 ? 0 : c - normalizedRadius;
      const maxCol = c + normalizedRadius >= cols ? cols - 1 : c + normalizedRadius;

      colSpans[c] = maxCol - minCol + 1;
    }

    return Array.from({ length: rows }, (_, r) => {
      const span = rowSpans[r];
      const totals = new Array(cols);

      for (let c = 0; c < cols; c++) {
        const neighbors = span * colSpans[c] - 1;

        totals[c] = neighbors > 0 ? neighbors : 0;
      }

      return totals;
    });
  }

  #markDensityDirty(row, col) {
    if (!this.densityDirtyTiles) this.densityDirtyTiles = new Set();

    this.densityDirtyTiles.add(row * this.cols + col);
  }

  #markEnergyDirty(row, col, options = {}) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    const targetSet =
      options?.targetSet instanceof Set ? options.targetSet : this.energyDirtyTiles;

    if (!targetSet) return;

    const radius = Math.max(0, Math.floor(options?.radius ?? 0));

    const add = (r, c) => targetSet.add(r * this.cols + c);

    if (radius <= 0) {
      add(row, col);

      return;
    }

    for (let rr = row - radius; rr <= row + radius; rr++) {
      if (rr < 0 || rr >= this.rows) continue;

      for (let cc = col - radius; cc <= col + radius; cc++) {
        if (cc < 0 || cc >= this.cols) continue;

        add(rr, cc);
      }
    }
  }

  #markTileDirty(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    if (!this.renderDirtyTiles) {
      this.renderDirtyTiles = new Set();
    }

    this.renderDirtyTiles.add(row * this.cols + col);
  }

  markEnergyDirty(row, col, options = {}) {
    if (!this.energyDirtyTiles) {
      this.energyDirtyTiles = new Set();
    }

    this.#markEnergyDirty(row, col, options);
  }

  #markAllTilesDirty() {
    if (!this.renderDirtyTiles) {
      this.renderDirtyTiles = new Set();
    } else {
      this.renderDirtyTiles.clear();
    }

    this.#imageDataNeedsFullRefresh = true;
  }

  #resetImageDataBuffer() {
    this.#imageDataCanvas = null;
    this.#imageDataCtx = null;
    this.#imageData = null;
    this.#imageData32 = null;
    this.#imageDataNeedsFullRefresh = true;
    this.renderDirtyTiles = new Set();
  }

  #syncDensitySnapshot(force = false) {
    const liveGrid = this.densityLiveGrid;

    if (!liveGrid) return;

    if (!this.densityGrid || this.densityGrid.length !== this.rows) {
      this.densityGrid = Array.from({ length: this.rows }, () =>
        Array(this.cols).fill(0),
      );
    }

    if (force) {
      for (let r = 0; r < this.rows; r++) {
        const destRow = this.densityGrid[r];
        const srcRow = liveGrid[r];

        for (let c = 0; c < this.cols; c++) destRow[c] = srcRow[c];
      }

      if (this.densityDirtyTiles) this.densityDirtyTiles.clear();

      return;
    }

    if (!this.densityDirtyTiles || this.densityDirtyTiles.size === 0) return;

    for (const key of this.densityDirtyTiles) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      this.densityGrid[row][col] = liveGrid[row][col];
    }

    this.densityDirtyTiles.clear();
  }

  recalculateDensityCounts(radius = this.densityRadius) {
    const normalizedRadius = Math.max(0, Math.floor(radius));
    const targetRadius = normalizedRadius > 0 ? normalizedRadius : this.densityRadius;

    if (!this.densityCounts) {
      this.densityCounts = Array.from({ length: this.rows }, () =>
        Array(this.cols).fill(0),
      );
    }

    if (!this.densityLiveGrid) {
      this.densityLiveGrid = Array.from({ length: this.rows }, () =>
        Array(this.cols).fill(0),
      );
    }

    if (!this.densityGrid) {
      this.densityGrid = Array.from({ length: this.rows }, () =>
        Array(this.cols).fill(0),
      );
    }

    if (!this.densityDirtyTiles) {
      this.densityDirtyTiles = new Set();
    }

    if (targetRadius !== this.densityRadius) {
      this.densityRadius = targetRadius;
      this.densityTotals = this.#buildDensityTotals(this.densityRadius);
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityCounts[r][c] = 0;
    }

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.densityLiveGrid[r][c] = 0;
    }

    this.densityDirtyTiles.clear();

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c]) this.#applyDensityDelta(r, c, 1);
      }
    }

    this.#syncDensitySnapshot(true);
  }

  rebuildActiveCells() {
    this.activeCells.clear();
    this.#clearTrackedPositions();
    this.#resetOccupancyTracking();
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const cell = this.grid[row][col];

        if (!cell) continue;

        this.activeCells.add(cell);
        this.#trackCellPosition(cell, row, col);
        this.#recordOccupancy(row, col);
      }
    }
  }

  spawnCell(
    row,
    col,
    { dna = DNA.random(() => this.#random()), spawnEnergy, recordBirth = false } = {},
  ) {
    if (this.isObstacle(row, col)) return null;
    const availableEnergy = Math.max(0, this.energyGrid?.[row]?.[col] ?? 0);
    const requestedEnergy = spawnEnergy ?? availableEnergy;
    const energy = Math.min(this.maxTileEnergy, requestedEnergy, availableEnergy);
    const cell = new Cell(row, col, dna, energy);

    this.setCell(row, col, cell, { absorbTileEnergy: false });

    const residualEnergy = availableEnergy - energy;

    if (residualEnergy > 0) {
      this.#redistributeEnergyToNeighbors(row, col, residualEnergy, {
        previousEnergyGrid: this.energyNext,
      });
    }

    if (recordBirth) {
      this.stats?.onBirth?.(cell, {
        row,
        col,
        energy,
        cause: "seed",
      });
    }

    return cell;
  }

  getDensityAt(row, col) {
    if (this.densityGrid?.[row]?.[col] != null) {
      return this.densityGrid[row][col];
    }

    return this.localDensity(row, col, this.densityRadius);
  }

  // Precompute density for all tiles (fraction of occupied neighbors)
  #countNeighbors(row, col, radius = GridManager.DENSITY_RADIUS) {
    let count = 0;
    let total = 0;

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (dx === 0 && dy === 0) continue;
        const rr = row + dy;
        const cc = col + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        total++;
        if (this.grid[rr][cc]) count++;
      }
    }

    return { count, total };
  }

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    const useCache =
      radius === this.densityRadius &&
      this.densityCounts &&
      this.densityTotals &&
      this.densityLiveGrid;

    if (useCache) {
      this.#syncDensitySnapshot();

      return this.densityGrid.map((row) => row.slice());
    }

    const out = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const { count, total } = this.#countNeighbors(row, col, radius);

        out[row][col] = total > 0 ? count / total : 0;
      }
    }

    return out;
  }

  localDensity(row, col, radius = 1) {
    if (radius === this.densityRadius && this.densityCounts && this.densityTotals) {
      const total = this.densityTotals[row]?.[col] ?? 0;

      if (total <= 0) return 0;

      const count = this.densityCounts[row]?.[col] ?? 0;

      return Math.max(0, Math.min(1, count / total));
    }

    const { count, total } = this.#countNeighbors(row, col, radius);

    return total > 0 ? count / total : 0;
  }

  #ensureImageDataBuffer() {
    const width = Math.max(0, Math.floor(this.cols));
    const height = Math.max(0, Math.floor(this.rows));

    if (width === 0 || height === 0) {
      return false;
    }

    const existingCanvas = this.#imageDataCanvas;
    const needsRebuild =
      !existingCanvas ||
      existingCanvas.width !== width ||
      existingCanvas.height !== height ||
      !this.#imageDataCtx ||
      !this.#imageData;

    if (!needsRebuild) {
      return true;
    }

    let canvas = existingCanvas;

    if (!canvas || canvas.width !== width || canvas.height !== height) {
      if (typeof OffscreenCanvas === "function") {
        canvas = new OffscreenCanvas(width, height);
      } else if (
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
      ) {
        canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
      } else {
        this.#resetImageDataBuffer();

        return false;
      }
    } else {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }

    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (!context || typeof context.createImageData !== "function") {
      this.#resetImageDataBuffer();

      return false;
    }

    this.#imageDataCanvas = canvas;
    this.#imageDataCtx = context;
    this.#imageData = context.createImageData(width, height);
    const imageDataBuffer = this.#imageData?.data;

    if (
      PACK_RGBA32 &&
      imageDataBuffer &&
      imageDataBuffer.byteOffset % 4 === 0 &&
      imageDataBuffer.length % 4 === 0
    ) {
      this.#imageData32 = new Uint32Array(
        imageDataBuffer.buffer,
        imageDataBuffer.byteOffset,
        imageDataBuffer.length / 4,
      );
    } else {
      this.#imageData32 = null;
    }
    this.#imageDataNeedsFullRefresh = true;

    return true;
  }

  #populateImageDataFull() {
    if (!this.#imageData || !this.#imageDataCtx) return;

    const { data } = this.#imageData;
    const rows = this.rows;
    const cols = this.cols;
    const data32 = this.#imageData32;
    const canUsePacked = Boolean(data32) && data32.length === data.length / 4;

    if (canUsePacked && data32) {
      let index = 0;

      for (let row = 0; row < rows; row++) {
        const gridRow = this.grid[row];

        for (let col = 0; col < cols; col++) {
          const cell = gridRow ? gridRow[col] : null;
          const record = cell ? resolveCellColorRecord(cell) : EMPTY_COLOR_RECORD;

          data32[index] = record.packed;
          index += 1;
        }
      }
    } else {
      let offset = 0;

      for (let row = 0; row < rows; row++) {
        const gridRow = this.grid[row];

        for (let col = 0; col < cols; col++) {
          const cell = gridRow ? gridRow[col] : null;
          const record = cell ? resolveCellColorRecord(cell) : EMPTY_COLOR_RECORD;
          const rgba = record.rgba;

          data[offset] = rgba[0];
          data[offset + 1] = rgba[1];
          data[offset + 2] = rgba[2];
          data[offset + 3] = rgba[3];
          offset += 4;
        }
      }
    }

    this.#imageDataCtx.putImageData(this.#imageData, 0, 0);
    this.#imageDataNeedsFullRefresh = false;
  }

  #applyDirtyTilesToImageData(dirtyTiles) {
    if (!this.#imageData || !this.#imageDataCtx) {
      return null;
    }

    const { data } = this.#imageData;
    const cols = this.cols;
    const rows = this.rows;
    const data32 = this.#imageData32;
    const canUsePacked = Boolean(data32) && data32.length === data.length / 4;
    let minRow = rows;
    let minCol = cols;
    let maxRow = -1;
    let maxCol = -1;

    for (const key of dirtyTiles) {
      const row = Math.floor(key / cols);
      const col = key % cols;

      if (row < 0 || row >= rows || col < 0 || col >= cols) continue;

      const cell = this.grid[row]?.[col] ?? null;
      const record = cell ? resolveCellColorRecord(cell) : EMPTY_COLOR_RECORD;
      const baseIndex = row * cols + col;

      if (canUsePacked && data32) {
        data32[baseIndex] = record.packed;
      } else {
        const index = baseIndex * 4;
        const rgba = record.rgba;

        data[index] = rgba[0];
        data[index + 1] = rgba[1];
        data[index + 2] = rgba[2];
        data[index + 3] = rgba[3];
      }

      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
    }

    if (maxRow >= minRow && maxCol >= minCol) {
      const dirtyWidth = maxCol - minCol + 1;
      const dirtyHeight = maxRow - minRow + 1;

      this.#imageDataCtx.putImageData(
        this.#imageData,
        0,
        0,
        minCol,
        minRow,
        dirtyWidth,
        dirtyHeight,
      );
      this.#imageDataNeedsFullRefresh = false;
    }

    return { minRow, minCol, maxRow, maxCol };
  }

  #resetObstacleRenderCache() {
    this.obstacleRenderCache = {
      revision: 0,
      caches: new Map(),
      lastBasePaint: null,
    };
  }

  #markObstacleRenderDirty() {
    if (!this.obstacleRenderCache) {
      this.#resetObstacleRenderCache();
    }

    this.obstacleRenderCache.revision += 1;
    this.obstacleRenderCache.lastBasePaint = null;

    for (const cache of this.obstacleRenderCache.caches.values()) {
      cache.dirty = true;
    }
  }

  #createObstacleSurface(width, height) {
    let canvas = null;

    if (typeof OffscreenCanvas === "function") {
      canvas = new OffscreenCanvas(width, height);
    } else if (
      typeof document !== "undefined" &&
      typeof document.createElement === "function"
    ) {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
    }

    if (!canvas) {
      return null;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return null;
    }

    if (ctx.imageSmoothingEnabled != null) {
      ctx.imageSmoothingEnabled = false;
    }

    return { canvas, ctx };
  }

  #ensureObstacleSurface(surface, width, height) {
    if (!surface || !surface.canvas || !surface.ctx) {
      return null;
    }

    if (surface.canvas.width !== width) {
      surface.canvas.width = width;
      surface.ctx = surface.canvas.getContext("2d");
    }

    if (surface.canvas.height !== height) {
      surface.canvas.height = height;
      surface.ctx = surface.canvas.getContext("2d");
    }

    if (surface.ctx?.imageSmoothingEnabled != null) {
      surface.ctx.imageSmoothingEnabled = false;
    }

    return surface;
  }

  #getObstacleBitmapEntry(cellSize, lineWidthScale = 0.1) {
    if (!Array.isArray(this.obstacles)) {
      return null;
    }

    if (!this.obstacleRenderCache) {
      this.#resetObstacleRenderCache();
    }

    const width = Math.max(1, Math.round(this.cols * cellSize));
    const height = Math.max(1, Math.round(this.rows * cellSize));

    if (!(width > 0) || !(height > 0)) {
      return null;
    }

    const key = Number.isFinite(lineWidthScale) ? lineWidthScale.toFixed(4) : "default";
    let entry = this.obstacleRenderCache.caches.get(key);

    if (!entry) {
      const fillSurface = this.#createObstacleSurface(width, height);
      const strokeSurface = this.#createObstacleSurface(width, height);

      if (!fillSurface || !strokeSurface) {
        return null;
      }

      entry = {
        fill: fillSurface,
        stroke: strokeSurface,
        width,
        height,
        cellSize,
        lineWidthScale: Number.isFinite(lineWidthScale) ? lineWidthScale : 0.1,
        revision: -1,
        dirty: true,
        hasAny: false,
      };
      this.obstacleRenderCache.caches.set(key, entry);
    } else {
      entry.lineWidthScale = Number.isFinite(lineWidthScale)
        ? lineWidthScale
        : entry.lineWidthScale;

      entry.fill = this.#ensureObstacleSurface(entry.fill, width, height);
      entry.stroke = this.#ensureObstacleSurface(entry.stroke, width, height);

      if (!entry.fill || !entry.stroke) {
        this.obstacleRenderCache.caches.delete(key);

        return null;
      }
    }

    if (
      entry.dirty ||
      entry.revision !== this.obstacleRenderCache.revision ||
      entry.cellSize !== cellSize ||
      entry.width !== width ||
      entry.height !== height
    ) {
      const fillCtx = entry.fill.ctx;
      const strokeCtx = entry.stroke.ctx;

      if (!fillCtx || !strokeCtx) {
        return null;
      }

      fillCtx.clearRect(0, 0, width, height);
      strokeCtx.clearRect(0, 0, width, height);

      fillCtx.fillStyle = "rgb(40,40,55)";
      strokeCtx.strokeStyle = "rgb(200,200,255)";
      strokeCtx.lineWidth = Math.max(1, cellSize * entry.lineWidthScale);

      let hasAny = false;

      for (let row = 0; row < this.rows; row++) {
        const maskRow = this.obstacles[row];

        if (!maskRow) continue;

        for (let col = 0; col < this.cols; col++) {
          if (!maskRow[col]) continue;

          const x = col * cellSize;
          const y = row * cellSize;

          fillCtx.fillRect(x, y, cellSize, cellSize);
          strokeCtx.strokeRect(x + 0.5, y + 0.5, cellSize - 1, cellSize - 1);
          hasAny = true;
        }
      }

      entry.width = width;
      entry.height = height;
      entry.cellSize = cellSize;
      entry.revision = this.obstacleRenderCache.revision;
      entry.dirty = false;
      entry.hasAny = hasAny;
    }

    return entry;
  }

  #blitObstacleCanvas(ctx, canvas, alpha = 1) {
    if (!ctx || !canvas || typeof ctx.drawImage !== "function") {
      return false;
    }

    const normalizedAlpha = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    const hasSave = typeof ctx.save === "function";
    const hadAlpha = ctx.globalAlpha !== undefined;
    const previousAlpha = hadAlpha ? ctx.globalAlpha : undefined;

    if (hasSave) ctx.save();

    if (hadAlpha) {
      ctx.globalAlpha = normalizedAlpha;
    }

    ctx.drawImage(canvas, 0, 0);

    if (hasSave) {
      ctx.restore();
    } else if (hadAlpha) {
      ctx.globalAlpha = previousAlpha;
    }

    return true;
  }

  #drawCellsWithCanvas(ctx, cellSize) {
    let paintedCells = 0;
    const totalTiles = this.rows * this.cols;

    for (let row = 0; row < this.rows; row++) {
      const gridRow = this.grid[row];

      if (!gridRow) continue;

      const y = row * cellSize;
      let spanColor = null;
      let spanStart = -1;
      let spanLength = 0;

      for (let col = 0; col < this.cols; col++) {
        const cell = gridRow[col];
        const color = cell ? cell.color : null;

        if (color) {
          paintedCells++;

          if (color === spanColor) {
            spanLength += 1;
            continue;
          }

          if (spanLength > 0 && spanColor) {
            if (ctx.fillStyle !== spanColor) {
              ctx.fillStyle = spanColor;
            }
            ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
          }

          spanColor = color;
          spanStart = col;
          spanLength = 1;
        } else if (spanLength > 0 && spanColor) {
          if (ctx.fillStyle !== spanColor) {
            ctx.fillStyle = spanColor;
          }
          ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
          spanColor = null;
          spanStart = -1;
          spanLength = 0;
        }
      }

      if (spanLength > 0 && spanColor) {
        if (ctx.fillStyle !== spanColor) {
          ctx.fillStyle = spanColor;
        }
        ctx.fillRect(spanStart * cellSize, y, spanLength * cellSize, cellSize);
      }
    }

    if (this.renderDirtyTiles) {
      this.renderDirtyTiles.clear();
    }
    this.#imageDataNeedsFullRefresh = true;

    return {
      processedTiles: totalTiles,
      paintedCells,
      dirtyCount: totalTiles,
      refreshType: "canvas",
    };
  }

  #drawCellsWithImageData(ctx) {
    if (!this.#ensureImageDataBuffer()) {
      return null;
    }

    const totalTiles = this.rows * this.cols;
    const dirtyTiles = this.renderDirtyTiles ?? new Set();
    let dirtyCount = dirtyTiles.size;
    let processedTiles = 0;
    let refreshType = "cached";

    if (this.#imageDataNeedsFullRefresh || dirtyCount >= totalTiles * 0.6) {
      this.#populateImageDataFull();
      processedTiles = totalTiles;
      dirtyCount = totalTiles;
      refreshType = "full";
    } else if (dirtyCount > 0) {
      this.#applyDirtyTilesToImageData(dirtyTiles);
      processedTiles = dirtyCount;
      refreshType = "partial";
    }

    if (this.renderDirtyTiles) {
      this.renderDirtyTiles.clear();
    }

    const previousSmoothing = ctx.imageSmoothingEnabled;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.#imageDataCanvas,
      0,
      0,
      this.cols,
      this.rows,
      0,
      0,
      this.cols * this.cellSize,
      this.rows * this.cellSize,
    );
    ctx.imageSmoothingEnabled = previousSmoothing;

    return {
      processedTiles,
      paintedCells: this.activeCells?.size ?? 0,
      dirtyCount,
      refreshType,
    };
  }

  #updateRenderStats({
    total,
    cellLoopMs,
    obstacleLoopMs,
    mode,
    processedTiles = 0,
    paintedCells = 0,
    dirtyCount = 0,
    refreshType = "none",
  }) {
    if (!this.renderStats) {
      this.renderStats = {
        frameCount: 0,
        lastFrameMs: 0,
        avgFrameMs: 0,
        lastCellLoopMs: 0,
        avgCellLoopMs: 0,
        lastObstacleLoopMs: 0,
        avgObstacleLoopMs: 0,
        fps: 0,
        mode: mode ?? "canvas",
        lastDirtyTileCount: 0,
        lastProcessedTiles: 0,
        lastPaintedCells: 0,
        refreshType: "none",
        timestamp: 0,
      };
    }

    const stats = this.renderStats;

    stats.frameCount += 1;
    stats.lastFrameMs = total;
    stats.lastCellLoopMs = cellLoopMs;
    stats.lastObstacleLoopMs = obstacleLoopMs;
    stats.mode = mode;
    stats.lastProcessedTiles = processedTiles;
    stats.lastPaintedCells = paintedCells;
    stats.lastDirtyTileCount = dirtyCount;
    stats.refreshType = refreshType;
    stats.timestamp = TIMESTAMP_NOW();

    const smoothingWindow = Math.min(stats.frameCount, 60);

    stats.avgFrameMs += (total - stats.avgFrameMs) / smoothingWindow;
    stats.avgCellLoopMs += (cellLoopMs - stats.avgCellLoopMs) / smoothingWindow;
    stats.avgObstacleLoopMs +=
      (obstacleLoopMs - stats.avgObstacleLoopMs) / smoothingWindow;
    stats.fps = stats.avgFrameMs > 0 ? 1000 / stats.avgFrameMs : 0;

    return stats;
  }

  getRenderStats() {
    if (!this.renderStats) {
      return null;
    }

    return { ...this.renderStats };
  }

  draw(options = {}) {
    const ctx = this.ctx;
    const cellSize = this.cellSize;
    const { showObstacles = true, renderStrategy } = options ?? {};
    const preferredStrategy =
      typeof renderStrategy === "string"
        ? renderStrategy
        : (this.renderStrategy ?? "auto");

    if (typeof renderStrategy === "string") {
      this.renderStrategy = renderStrategy;
    }

    const frameStart = TIMESTAMP_NOW();
    let obstacleLoopMs = 0;
    let cellLoopMs = 0;
    let modeUsed = "canvas";
    let cellStats = {
      processedTiles: 0,
      paintedCells: this.activeCells?.size ?? 0,
      dirtyCount: this.renderDirtyTiles?.size ?? 0,
      refreshType: "none",
    };

    if (!ctx) {
      this.#updateRenderStats({
        total: 0,
        cellLoopMs: 0,
        obstacleLoopMs: 0,
        mode: "headless",
        processedTiles: cellStats.processedTiles,
        paintedCells: cellStats.paintedCells,
        dirtyCount: cellStats.dirtyCount,
        refreshType: cellStats.refreshType,
      });

      return this.getRenderStats();
    }

    ctx.clearRect(0, 0, this.cols * cellSize, this.rows * cellSize);

    if (showObstacles && this.obstacles) {
      const obstacleStart = TIMESTAMP_NOW();
      const cacheEntry = this.#getObstacleBitmapEntry(cellSize, 0.1);

      let drewWithCache = false;

      if (cacheEntry && cacheEntry.fill?.canvas && cacheEntry.stroke?.canvas) {
        let success = true;

        if (cacheEntry.hasAny) {
          const fillOk = this.#blitObstacleCanvas(ctx, cacheEntry.fill.canvas, 0.9);
          const strokeOk = this.#blitObstacleCanvas(
            ctx,
            cacheEntry.stroke.canvas,
            0.25,
          );

          success = fillOk && strokeOk;
        }

        if (success) {
          drewWithCache = true;

          if (this.obstacleRenderCache) {
            this.obstacleRenderCache.lastBasePaint = {
              revision: cacheEntry.revision,
              cellSize,
              lineWidthScale: cacheEntry.lineWidthScale,
            };
          }
        }
      }

      if (!drewWithCache) {
        ctx.fillStyle = "rgba(40,40,55,0.9)";
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            if (!this.obstacles[row][col]) continue;
            ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
          }
        }
        ctx.strokeStyle = "rgba(200,200,255,0.25)";
        ctx.lineWidth = Math.max(1, cellSize * 0.1);
        for (let row = 0; row < this.rows; row++) {
          for (let col = 0; col < this.cols; col++) {
            if (!this.obstacles[row][col]) continue;
            ctx.strokeRect(
              col * cellSize + 0.5,
              row * cellSize + 0.5,
              cellSize - 1,
              cellSize - 1,
            );
          }
        }

        if (this.obstacleRenderCache) {
          this.obstacleRenderCache.lastBasePaint = {
            revision: this.obstacleRenderCache.revision,
            cellSize,
            lineWidthScale: 0.1,
          };
        }
      }

      obstacleLoopMs = TIMESTAMP_NOW() - obstacleStart;
    } else if (this.obstacleRenderCache) {
      this.obstacleRenderCache.lastBasePaint = null;
    }

    const tryImageData = preferredStrategy !== "canvas";

    if (tryImageData) {
      const imageStart = TIMESTAMP_NOW();
      const imageStats = this.#drawCellsWithImageData(ctx);

      cellLoopMs += TIMESTAMP_NOW() - imageStart;

      if (imageStats) {
        modeUsed = "image-data";
        cellStats = imageStats;
      } else {
        const fallbackStart = TIMESTAMP_NOW();

        cellStats = this.#drawCellsWithCanvas(ctx, cellSize);
        cellLoopMs += TIMESTAMP_NOW() - fallbackStart;
        modeUsed = "canvas";
      }
    } else {
      const canvasStart = TIMESTAMP_NOW();

      cellStats = this.#drawCellsWithCanvas(ctx, cellSize);
      cellLoopMs = TIMESTAMP_NOW() - canvasStart;
      modeUsed = "canvas";
    }

    const total = TIMESTAMP_NOW() - frameStart;

    this.#updateRenderStats({
      total,
      cellLoopMs,
      obstacleLoopMs,
      mode: modeUsed,
      processedTiles: cellStats.processedTiles,
      paintedCells: cellStats.paintedCells,
      dirtyCount: cellStats.dirtyCount,
      refreshType: cellStats.refreshType,
    });

    return this.getRenderStats();
  }

  getObstacleRenderSurface(cellSize = this.cellSize, options = {}) {
    const normalizedSize = Number.isFinite(cellSize) ? cellSize : this.cellSize;
    const lineWidthScale = Number.isFinite(options?.lineWidthScale)
      ? options.lineWidthScale
      : 0.12;
    const entry = this.#getObstacleBitmapEntry(normalizedSize, lineWidthScale);

    if (!entry || !entry.fill?.canvas || !entry.stroke?.canvas) {
      return null;
    }

    const lastPaint = this.obstacleRenderCache?.lastBasePaint ?? null;

    return {
      fillCanvas: entry.fill.canvas,
      strokeCanvas: entry.stroke.canvas,
      width: entry.width,
      height: entry.height,
      lineWidthScale: entry.lineWidthScale,
      revision: entry.revision,
      hasAny: entry.hasAny,
      lastBasePaintRevision: lastPaint?.revision ?? null,
      lastBasePaintCellSize: lastPaint?.cellSize ?? null,
      lastBasePaintLineWidthScale: lastPaint?.lineWidthScale ?? null,
    };
  }

  prepareTick({
    eventManager,
    eventStrengthMultiplier,
    energyRegenRate,
    energyDiffusionRate,
    densityEffectMultiplier = 1,
  }) {
    this.#syncDensitySnapshot();

    this.#processDecay();

    const densityGrid = this.densityGrid;

    this.regenerateEnergyGrid(
      eventManager.activeEvents || [],
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityGrid,
      densityEffectMultiplier,
    );

    this.#applyDecayDeltas();

    return { densityGrid };
  }

  processCell(
    row,
    col,
    {
      stats,
      eventManager,
      densityGrid,
      processed,
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
      eventStrengthMultiplier,
      mutationMultiplier,
      combatEdgeSharpness,
      combatTerritoryEdgeFactor,
    },
  ) {
    const cell = this.grid[row][col];

    if (!cell || processed.has(cell)) return;
    processed.add(cell);
    cell.age++;
    if (typeof cell.tickReproductionCooldown === "function") {
      cell.tickReproductionCooldown();
    } else if (cell.reproductionCooldown > 0) {
      cell.reproductionCooldown = Math.max(0, cell.reproductionCooldown - 1);
    }
    const densityValue = densityGrid?.[row]?.[col];
    const localDensity = clamp(Number.isFinite(densityValue) ? densityValue : 0, 0, 1);
    const energyCap =
      this.maxTileEnergy > 0 ? this.maxTileEnergy : MAX_TILE_ENERGY || 1;
    const energyFraction = clamp(
      Number.isFinite(cell.energy) ? cell.energy / energyCap : 0,
      0,
      1,
    );
    const scarcitySignal = clamp(this.populationScarcitySignal ?? 0, 0, 1);
    const scarcityEnergyFactor = clamp(0.25 + energyFraction * 0.75, 0.25, 1);
    const scarcityRelief = clamp(
      scarcityEnergyFactor * (1 - scarcitySignal * 0.75),
      0.05,
      1,
    );
    const fallbackAgeFraction =
      Number.isFinite(cell.lifespan) && cell.lifespan > 0
        ? cell.age / cell.lifespan
        : 0;
    const senescenceAgeFraction =
      typeof cell.getSenescenceAgeFraction === "function"
        ? cell.getSenescenceAgeFraction()
        : fallbackAgeFraction;
    const rawAgeFraction = Number.isFinite(senescenceAgeFraction)
      ? senescenceAgeFraction
      : fallbackAgeFraction;

    if (typeof cell.updateSenescenceDebt === "function") {
      cell.updateSenescenceDebt({
        ageFraction: rawAgeFraction,
        energyFraction,
        localDensity,
        scarcitySignal,
        eventPressure: cell.lastEventPressure ?? 0,
      });
    }
    let ageFractionLimit = 3;

    if (typeof cell.resolveSenescenceElasticity === "function") {
      const elasticity = cell.resolveSenescenceElasticity({
        localDensity,
        energyFraction,
        scarcitySignal,
      });

      if (Number.isFinite(elasticity)) {
        ageFractionLimit = Math.max(1.2, elasticity);
      }
    }
    const ageFraction = clamp(rawAgeFraction, 0, ageFractionLimit);
    let senescenceHazard = null;
    let senescenceDeath = false;

    if (typeof cell.computeSenescenceHazard === "function") {
      const context = {
        ageFraction,
        energyFraction,
        localDensity,
        densityEffectMultiplier,
        eventPressure: cell.lastEventPressure ?? 0,
        scarcitySignal,
      };

      senescenceHazard = cell.computeSenescenceHazard(context);

      if (Number.isFinite(senescenceHazard)) {
        if (senescenceHazard >= 1) {
          senescenceDeath = true;
        } else if (senescenceHazard > 0) {
          const hazardRng =
            typeof cell.resolveRng === "function"
              ? cell.resolveRng("senescenceHazard", () => this.#random())
              : () => this.#random();
          const roll = Number(hazardRng());

          if (Number.isFinite(roll) && roll < senescenceHazard) {
            senescenceDeath = true;
          }
        }
      } else {
        senescenceHazard = null;
      }
    }

    if (!senescenceDeath && senescenceHazard == null && cell.age >= cell.lifespan) {
      senescenceDeath = true;
    }

    if (senescenceDeath) {
      const removed = this.removeCell(row, col);

      if (removed) {
        this.registerDeath(removed, {
          row,
          col,
          cause: "senescence",
          hazard: senescenceHazard != null ? clamp(senescenceHazard, 0, 1) : undefined,
        });
      }

      return;
    }

    let pendingRegen = 0;

    if (this.pendingOccupantRegen) {
      const regenRow = this.pendingOccupantRegen[row];

      if (regenRow && Number.isFinite(regenRow[col]) && regenRow[col] > 0) {
        pendingRegen = regenRow[col];
        regenRow[col] = 0;
      }
    }

    if (pendingRegen > 0) {
      const energyRow = this.energyGrid?.[row];

      if (energyRow) {
        const currentTileEnergy = Number.isFinite(energyRow[col]) ? energyRow[col] : 0;

        energyRow[col] = currentTileEnergy + pendingRegen;
      }
    }

    const events = eventManager.activeEvents || [];

    for (const ev of events) {
      cell.applyEventEffects(
        row,
        col,
        ev,
        eventStrengthMultiplier,
        this.maxTileEnergy,
        {
          eventContext: this.eventContext,
          effectCache: this.eventEffectCache,
        },
      );
    }

    this.consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier);

    const starved = cell.manageEnergy(row, col, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
      scarcityRelief,
    });

    if (starved || cell.energy <= 0) {
      const removed = this.removeCell(row, col);

      if (removed) {
        this.registerDeath(removed, {
          row,
          col,
          cause: starved ? "starvation" : "energy-collapse",
        });
      }

      return;
    }

    const act =
      typeof cell.dna.activityRate === "function" ? cell.dna.activityRate() : 1;

    if (act <= 0) {
      return;
    }

    const targets = this.findTargets(row, col, cell, {
      densityEffectMultiplier,
      societySimilarity,
      enemySimilarity,
    });

    try {
      if (
        this.handleReproduction(row, col, cell, targets, {
          stats,
          densityGrid,
          densityEffectMultiplier,
          mutationMultiplier,
        })
      ) {
        return;
      }

      if (this.#random() > act) {
        return;
      }

      if (
        this.handleCombat(row, col, cell, targets, {
          stats,
          densityEffectMultiplier,
          densityGrid,
          combatEdgeSharpness,
          combatTerritoryEdgeFactor,
        })
      ) {
        return;
      }

      this.handleMovement(row, col, cell, targets, {
        densityGrid,
        densityEffectMultiplier,
      });
    } finally {
      this.#endTargetScan();
    }
  }

  #computeLowDiversityPenaltyMultiplier({
    parentA,
    parentB,
    diversity,
    diversityThreshold,
    localDensity = 0,
    tileEnergy = 0.5,
    tileEnergyDelta = 0,
    baseProbability = 1,
    floor = 0,
    diversityPressure = 0,
    behaviorEvenness = 0,
    behaviorComplementarity = 0,
    strategyPressure = 0,
    scarcity = 0,
  } = {}) {
    const sliderFloor = clamp(Number.isFinite(floor) ? floor : 0, 0, 1);

    if (!(diversityThreshold > 0)) {
      return clamp(1, sliderFloor, 1);
    }

    const diversityShortfall = clamp(1 - diversity / diversityThreshold, 0, 1);
    const closeness = diversityShortfall > 0 ? Math.pow(diversityShortfall, 0.35) : 0;
    const driveA = GridManager.#resolveDiversityDrive(parentA, {
      localDensity,
      tileEnergy,
      tileEnergyDelta,
    });
    const driveB = GridManager.#resolveDiversityDrive(parentB, {
      localDensity,
      tileEnergy,
      tileEnergyDelta,
    });
    const combinedDrive = clamp((driveA + driveB) / 2, 0, 1);
    const environmentDriver = clamp(
      0.5 * clamp(localDensity ?? 0, 0, 1) +
        0.3 * clamp(1 - (tileEnergy ?? 0), 0, 1) +
        0.2 * clamp(-(tileEnergyDelta ?? 0), 0, 1),
      0,
      1,
    );
    const probabilitySlack = clamp(1 - (baseProbability ?? 0), 0, 1);
    const kinPreference = clamp(
      ((parentA?.matePreferenceBias ?? 0) + (parentB?.matePreferenceBias ?? 0)) / 2,
      -1,
      1,
    );
    const kinComfort = clamp(0.5 + 0.5 * kinPreference, 0, 1);
    const evenness = clamp(
      Number.isFinite(behaviorEvenness) ? behaviorEvenness : 0,
      0,
      1,
    );
    const evennessDrag = clamp(1 - evenness, 0, 1);
    const complementarity = clamp(
      Number.isFinite(behaviorComplementarity) ? behaviorComplementarity : 0,
      0,
      1,
    );

    const pressure = clamp(
      Number.isFinite(diversityPressure) ? diversityPressure : 0,
      0,
      1,
    );
    const scarcitySignal = clamp(Number.isFinite(scarcity) ? scarcity : 0, 0, 1);
    const strategyPressureValue = clamp(
      Number.isFinite(strategyPressure) ? strategyPressure : 0,
      0,
      1,
    );
    let severity =
      closeness * 0.35 +
      closeness * combinedDrive * (0.4 + 0.2 * probabilitySlack) +
      closeness * environmentDriver * (0.25 + 0.25 * probabilitySlack) +
      closeness * probabilitySlack * 0.1;

    severity *= clamp(1 - kinComfort * 0.6, 0.3, 1);
    severity *= 1 + pressure * 0.75;
    severity *= 1 + evennessDrag * (0.35 + 0.25 * combinedDrive);
    severity *= 1 + strategyPressureValue * evennessDrag * (0.25 + closeness * 0.2);

    if (complementarity > 0 && evennessDrag > 0) {
      const reliefScale =
        0.25 + evennessDrag * 0.4 + combinedDrive * 0.25 + pressure * 0.2;
      const relief = clamp(complementarity * reliefScale, 0, 0.8);

      severity *= clamp(1 - relief, 0.25, 1);
      severity -= complementarity * evennessDrag * 0.12;
    }

    severity = clamp(severity, 0, 1);
    if (scarcitySignal > 0) {
      severity *= clamp(1 - scarcitySignal * 0.65, 0.15, 1);
    }
    const evennessReliefFactor = clamp(evenness * (0.25 + pressure * 0.2), 0, 0.45);

    if (evennessReliefFactor > 0) {
      severity *= clamp(1 - evennessReliefFactor, 0.25, 1);
    }

    return clamp(1 - severity, sliderFloor, 1);
  }

  #prioritizeMateCandidates(candidates, parentRow, parentCol, limit = 12) {
    if (!Array.isArray(candidates) || candidates.length <= limit) {
      return candidates;
    }

    const annotated = candidates.map((candidate) => {
      const targetRow = Number.isFinite(candidate?.row)
        ? candidate.row
        : Number.isFinite(candidate?.target?.row)
          ? candidate.target.row
          : parentRow;
      const targetCol = Number.isFinite(candidate?.col)
        ? candidate.col
        : Number.isFinite(candidate?.target?.col)
          ? candidate.target.col
          : parentCol;
      const separation = Math.max(
        Math.abs(targetRow - parentRow),
        Math.abs(targetCol - parentCol),
      );

      return {
        candidate,
        separation: Number.isFinite(separation) ? separation : Number.POSITIVE_INFINITY,
      };
    });

    annotated.sort((a, b) => a.separation - b.separation);

    return annotated
      .slice(0, Math.min(limit, annotated.length))
      .map((entry) => entry.candidate);
  }

  handleReproduction(
    row,
    col,
    cell,
    { mates = EMPTY_TARGET_LIST, society = EMPTY_TARGET_LIST },
    { stats, densityGrid, densityEffectMultiplier, mutationMultiplier },
  ) {
    // findTargets sorts potential partners into neutral mates and allies; fall back
    // to the allied list so strongly kin-seeking genomes still have options.
    const baseMatePool = mates.length > 0 ? mates : society;
    const totalMateCandidates = Array.isArray(baseMatePool) ? baseMatePool.length : 0;
    const matePool = this.#prioritizeMateCandidates(baseMatePool, row, col);

    if (matePool.length === 0) return false;

    const energyRow = this.energyGrid?.[row];
    const energyValue = energyRow ? energyRow[col] : 0;
    const parentEnergyCap = this.maxTileEnergy > 0 ? this.maxTileEnergy : 1;
    const parentTileEnergy =
      parentEnergyCap > 0 ? clamp(energyValue / parentEnergyCap, 0, 1) : 0;
    const parentTileEnergyDelta = this.energyDeltaGrid?.[row]?.[col] ?? 0;
    let parentLocalDensity = densityGrid?.[row]?.[col];

    if (parentLocalDensity == null) {
      parentLocalDensity = this.getDensityAt(row, col);
    }

    const reproductionContext = {
      localDensity: clamp(parentLocalDensity ?? 0, 0, 1),
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
      tileEnergy: parentTileEnergy,
      tileEnergyDelta: parentTileEnergyDelta,
      parentRow: row,
      parentCol: col,
    };

    const selection = cell.selectMateWeighted
      ? cell.selectMateWeighted(matePool, reproductionContext)
      : null;
    const selectedMate = selection?.chosen ?? null;
    const evaluated = Array.isArray(selection?.evaluated)
      ? selection.evaluated
      : EMPTY_TARGET_LIST;
    const selectionMode = selection?.mode ?? "preference";

    let bestMate = selectedMate;

    if (!bestMate || !bestMate.target) {
      bestMate = cell.findBestMate(matePool, reproductionContext);

      if (!bestMate) return false;
    }

    const similarity =
      typeof bestMate.similarity === "number"
        ? bestMate.similarity
        : cell.similarityTo(bestMate.target);
    const diversity =
      typeof bestMate.diversity === "number" ? bestMate.diversity : 1 - similarity;
    const diversityThresholdBaseline =
      typeof this.matingDiversityThreshold === "number"
        ? this.matingDiversityThreshold
        : 0;
    const diversityPressureSource =
      typeof stats?.getDiversityPressure === "function"
        ? stats.getDiversityPressure()
        : Number.isFinite(stats?.diversityPressure)
          ? stats.diversityPressure
          : 0;
    const diversityPressure = clamp(diversityPressureSource, 0, 1);
    const behaviorEvennessSource =
      typeof stats?.getBehavioralEvenness === "function"
        ? stats.getBehavioralEvenness()
        : Number.isFinite(stats?.behavioralEvenness)
          ? stats.behavioralEvenness
          : 0;
    const behaviorEvenness = clamp(behaviorEvennessSource, 0, 1);
    const behaviorComplementarity = computeBehaviorComplementarity(
      cell,
      bestMate.target,
    );
    const strategyPressureSource =
      typeof stats?.getStrategyPressure === "function"
        ? stats.getStrategyPressure()
        : Number.isFinite(stats?.strategyPressure)
          ? stats.strategyPressure
          : 0;
    const strategyPressure = clamp(strategyPressureSource, 0, 1);
    const penaltyFloor =
      typeof this.lowDiversityReproMultiplier === "number"
        ? clamp(this.lowDiversityReproMultiplier, 0, 1)
        : 0;
    let diversityPenaltyMultiplier = 1;
    let strategyPenaltyMultiplier = 1;
    let penaltyMultiplier = 1;
    let penalizedForSimilarity = false;

    const originalParentRow = cell.row;
    const originalParentCol = cell.col;
    const moveSucceeded = this.boundMoveToTarget(
      this.grid,
      row,
      col,
      bestMate.row,
      bestMate.col,
      this.rows,
      this.cols,
    );
    const parentRow = cell.row;
    const parentCol = cell.col;
    const mateRow = bestMate.target.row;
    const mateCol = bestMate.target.col;

    const densitySourceRow = moveSucceeded ? parentRow : originalParentRow;
    const densitySourceCol = moveSucceeded ? parentCol : originalParentCol;
    let localDensity = densityGrid?.[densitySourceRow]?.[densitySourceCol];

    if (localDensity == null) {
      localDensity = this.getDensityAt(densitySourceRow, densitySourceCol);
    }
    const energyDenominator = this.maxTileEnergy > 0 ? this.maxTileEnergy : 1;
    const tileEnergy = this.energyGrid[parentRow][parentCol] / energyDenominator;
    const tileEnergyDelta = this.energyDeltaGrid?.[parentRow]?.[parentCol] ?? 0;
    const baseProb = cell.computeReproductionProbability(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    });
    const { probability: reproProb } = cell.decideReproduction(bestMate.target, {
      localDensity,
      densityEffectMultiplier,
      maxTileEnergy: this.maxTileEnergy,
      baseProbability: baseProb,
      tileEnergy,
      tileEnergyDelta,
    });
    const scarcitySignal = clamp(this.populationScarcitySignal ?? 0, 0, 1);

    const pairDiversityThreshold = GridManager.#computePairDiversityThreshold({
      parentA: cell,
      parentB: bestMate.target,
      baseThreshold: diversityThresholdBaseline,
      localDensity,
      tileEnergy,
      behaviorComplementarity,
      scarcity: scarcitySignal,
      tileEnergyDelta,
      diversityPressure,
    });

    let effectiveReproProb = clamp(reproProb ?? 0, 0, 1);
    let scarcityMultiplier = 1;

    if (diversity < pairDiversityThreshold) {
      penalizedForSimilarity = true;
      diversityPenaltyMultiplier = this.#computeLowDiversityPenaltyMultiplier({
        parentA: cell,
        parentB: bestMate.target,
        diversity,
        diversityThreshold: pairDiversityThreshold,
        localDensity,
        tileEnergy,
        tileEnergyDelta,
        baseProbability: effectiveReproProb,
        floor: penaltyFloor,
        diversityPressure,
        behaviorEvenness,
        behaviorComplementarity,
        strategyPressure,
        scarcity: scarcitySignal,
      });

      diversityPenaltyMultiplier = clamp(diversityPenaltyMultiplier, 0, 1);

      if (diversityPenaltyMultiplier <= 0) {
        effectiveReproProb = 0;
      } else {
        effectiveReproProb = clamp(
          effectiveReproProb * diversityPenaltyMultiplier,
          0,
          1,
        );
      }
    } else if (diversityPressure > 0 && pairDiversityThreshold < 1) {
      const normalizedExcess = clamp(
        (diversity - pairDiversityThreshold) / (1 - pairDiversityThreshold),
        0,
        1,
      );

      if (normalizedExcess > 0) {
        const bonusScale = 0.3 + diversityPressure * 0.3;
        const bonus = 1 + normalizedExcess * bonusScale;

        effectiveReproProb = clamp(effectiveReproProb * bonus, 0, 1);
      }
    }

    if (strategyPressure > 0 && effectiveReproProb > 0) {
      const evennessGap = clamp(1 - behaviorEvenness, 0, 1);
      const complementarityClamped = clamp(behaviorComplementarity, 0, 1);
      const complementGap = clamp(1 - complementarityClamped, 0, 1);
      const similarityPull = clamp(similarity, 0, 1);
      let monotonySeverity =
        strategyPressure *
        evennessGap *
        (0.45 + 0.35 * similarityPull) *
        (0.4 + 0.6 * complementGap);

      if (diversity < pairDiversityThreshold) {
        const diversityGap = clamp(pairDiversityThreshold - diversity, 0, 1);

        monotonySeverity *= 1 + diversityGap * 0.35;
      }

      monotonySeverity = clamp(monotonySeverity, 0, 0.55);

      if (monotonySeverity > 0.001) {
        const floor = penaltyFloor > 0 ? penaltyFloor : 0;

        strategyPenaltyMultiplier = clamp(1 - monotonySeverity, floor, 1);

        if (strategyPenaltyMultiplier < 1) {
          penalizedForSimilarity = true;
          effectiveReproProb = clamp(
            effectiveReproProb * strategyPenaltyMultiplier,
            0,
            1,
          );
        }
      }
    }

    penaltyMultiplier = clamp(
      diversityPenaltyMultiplier * strategyPenaltyMultiplier,
      0,
      1,
    );

    if (behaviorComplementarity > 0) {
      const complementPressure = clamp(1 - behaviorEvenness, 0, 1);

      if (complementPressure > 0) {
        const complementBonus =
          1 +
          behaviorComplementarity *
            complementPressure *
            (0.18 + diversityPressure * 0.22);

        effectiveReproProb = clamp(effectiveReproProb * complementBonus, 0, 1);
      }
    }

    if (scarcitySignal > 0 && effectiveReproProb > 0) {
      const scarcityResult = resolvePopulationScarcityMultiplier({
        parentA: cell,
        parentB: bestMate.target,
        scarcity: scarcitySignal,
        baseProbability: effectiveReproProb,
        minPopulation: this.minPopulation,
        population: this.activeCells?.size ?? 0,
      });

      const resolvedMultiplier = scarcityResult?.multiplier;

      if (Number.isFinite(resolvedMultiplier) && resolvedMultiplier > 0) {
        scarcityMultiplier = clamp(resolvedMultiplier, 0.25, 2);
        effectiveReproProb = clamp(effectiveReproProb * scarcityMultiplier, 0, 1);
      } else {
        scarcityMultiplier = 1;
      }
    }

    const thrFracA =
      typeof cell.dna.reproductionThresholdFrac === "function"
        ? cell.dna.reproductionThresholdFrac()
        : 0.4;
    const thrFracB =
      typeof bestMate.target.dna.reproductionThresholdFrac === "function"
        ? bestMate.target.dna.reproductionThresholdFrac()
        : 0.4;
    const thrA = thrFracA * this.maxTileEnergy;
    const thrB = thrFracB * this.maxTileEnergy;
    const appetite = cell.diversityAppetite ?? 0;
    const bias = cell.matePreferenceBias ?? 0;
    const evaluatedPoolSize = evaluated.length > 0 ? evaluated.length : matePool.length;
    const selectionKind =
      selectedMate && selectedMate.target ? selectionMode : "legacy";

    let reproduced = false;
    const zoneParents = this.reproductionZones.validateArea({
      parentA: { row: parentRow, col: parentCol },
      parentB: { row: mateRow, col: mateCol },
    });

    let blockedInfo = null;

    if (!zoneParents.allowed) {
      blockedInfo = {
        reason: zoneParents.reason,
        parentA: { row: parentRow, col: parentCol },
        parentB: { row: mateRow, col: mateCol },
      };
    }

    let mateLocalDensity = densityGrid?.[mateRow]?.[mateCol];

    if (mateLocalDensity == null) {
      mateLocalDensity = this.getDensityAt(mateRow, mateCol);
    }

    const mateEnergyRaw = this.energyGrid?.[mateRow]?.[mateCol] ?? 0;
    const mateTileEnergy = mateEnergyRaw / energyDenominator;
    const mateTileEnergyDelta = this.energyDeltaGrid?.[mateRow]?.[mateCol] ?? 0;
    const rowDelta = Math.abs(parentRow - mateRow);
    const colDelta = Math.abs(parentCol - mateCol);
    const separation = Math.max(rowDelta, colDelta);
    const parentReach =
      typeof cell.getReproductionReach === "function"
        ? cell.getReproductionReach({
            localDensity,
            tileEnergy,
            tileEnergyDelta,
            partner: bestMate.target,
            partnerSimilarity: similarity,
          })
        : 1;
    const mateReach =
      typeof bestMate.target.getReproductionReach === "function"
        ? bestMate.target.getReproductionReach({
            localDensity: mateLocalDensity,
            tileEnergy: mateTileEnergy,
            tileEnergyDelta: mateTileEnergyDelta,
            partner: cell,
            partnerSimilarity: similarity,
          })
        : 1;
    const averageReach = clamp((parentReach + mateReach) / 2, 0, 4);
    const effectiveReach = Math.max(1, averageReach);

    if (!blockedInfo) {
      if (separation === 0) {
        blockedInfo = {
          reason: "Parents out of reach",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach },
        };
      } else if (separation > 1) {
        blockedInfo = {
          reason: "Parents must be adjacent",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach, required: 1 },
        };
      } else if (separation > effectiveReach) {
        blockedInfo = {
          reason: "Parents out of reach",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach },
        };
      }
    }

    const parentCooldownRemaining =
      typeof cell.getReproductionCooldown === "function"
        ? cell.getReproductionCooldown()
        : Math.max(0, cell.reproductionCooldown || 0);
    const mateCooldownRemaining =
      typeof bestMate.target?.getReproductionCooldown === "function"
        ? bestMate.target.getReproductionCooldown()
        : Math.max(0, bestMate.target?.reproductionCooldown || 0);

    if (!blockedInfo && (parentCooldownRemaining > 0 || mateCooldownRemaining > 0)) {
      blockedInfo = {
        reason: "Reproduction cooldown active",
        parentA: {
          row: parentRow,
          col: parentCol,
          cooldown: parentCooldownRemaining,
        },
        parentB: {
          row: mateRow,
          col: mateCol,
          cooldown: mateCooldownRemaining,
        },
      };
    }

    const reproductionRng =
      typeof cell.resolveSharedRng === "function"
        ? cell.resolveSharedRng(bestMate.target, "reproductionRoll")
        : Math.random;

    if (
      !blockedInfo &&
      reproductionRng() < effectiveReproProb &&
      cell.energy >= thrA &&
      bestMate.target.energy >= thrB
    ) {
      const { list: candidates, set: candidateSet } = this.#acquireSpawnScratch();
      const rowsCount = this.rows;
      const colsCount = this.cols;
      const grid = this.grid;
      const obstacles = this.obstacles; // Cache to avoid repeated property walks in the hot path.
      const addCandidate = (r, c) => {
        if (r < 0 || r >= rowsCount || c < 0 || c >= colsCount) return;

        const key = r * colsCount + c;

        if (candidateSet.has(key)) return;
        candidateSet.add(key);

        const rowCells = grid[r];
        const obstacleRow = obstacles?.[r];

        if (!rowCells || rowCells[c] || (obstacleRow && obstacleRow[c])) {
          return;
        }

        candidates.push({ r, c });
      };
      const addNeighbors = (baseRow, baseCol) => {
        for (const [dr, dc] of NEIGHBOR_OFFSETS) {
          addCandidate(baseRow + dr, baseCol + dc);
        }
      };

      addCandidate(originalParentRow, originalParentCol);
      if (moveSucceeded) addNeighbors(originalParentRow, originalParentCol);
      addCandidate(parentRow, parentCol);
      addCandidate(mateRow, mateCol);
      addNeighbors(parentRow, parentCol);
      addNeighbors(mateRow, mateCol);

      if (candidates.length > 0) {
        const restrictedSlots =
          this.reproductionZones.filterSpawnCandidates(candidates);
        const slotPool = restrictedSlots.length > 0 ? restrictedSlots : candidates;

        if (slotPool.length > 0) {
          const spawn = this.#chooseSpawnCandidate(slotPool, {
            parentA: cell,
            parentB: bestMate.target,
            densityGrid,
            densityEffectMultiplier,
          });

          if (spawn) {
            const zoneCheck = this.reproductionZones.validateArea({
              parentA: { row: parentRow, col: parentCol },
              parentB: { row: mateRow, col: mateCol },
              spawn: { row: spawn.r, col: spawn.c },
            });

            if (!zoneCheck.allowed) {
              blockedInfo = {
                reason: zoneCheck.reason,
                parentA: { row: parentRow, col: parentCol },
                parentB: { row: mateRow, col: mateCol },
                spawn: { row: spawn.r, col: spawn.c },
              };
            } else {
              const offspring = Cell.breed(cell, bestMate.target, mutationMultiplier, {
                maxTileEnergy: this.maxTileEnergy,
              });

              if (offspring) {
                offspring.row = spawn.r;
                offspring.col = spawn.c;
                this.setCell(spawn.r, spawn.c, offspring, {
                  absorbTileEnergy: true,
                });
                const parentColors = [];

                if (typeof cell?.dna?.toColor === "function") {
                  parentColors.push(cell.dna.toColor());
                }
                if (typeof bestMate.target?.dna?.toColor === "function") {
                  parentColors.push(bestMate.target.dna.toColor());
                }

                stats.onBirth(offspring, {
                  row: spawn.r,
                  col: spawn.c,
                  energy: offspring.energy,
                  cause: "reproduction",
                  mutationMultiplier,
                  parents: parentColors,
                });
                reproduced = true;
              }
            }
          }
        }
      }
    }

    if (blockedInfo && stats?.recordReproductionBlocked) {
      stats.recordReproductionBlocked(blockedInfo);
    }

    const parentNovelty =
      typeof cell.getMateNoveltyPressure === "function"
        ? cell.getMateNoveltyPressure()
        : undefined;
    const mateNovelty =
      bestMate.target && typeof bestMate.target.getMateNoveltyPressure === "function"
        ? bestMate.target.getMateNoveltyPressure()
        : undefined;
    const noveltyNumerator =
      (Number.isFinite(parentNovelty) ? parentNovelty : 0) +
      (Number.isFinite(mateNovelty) ? mateNovelty : 0);
    const noveltyDenominator =
      (Number.isFinite(parentNovelty) ? 1 : 0) + (Number.isFinite(mateNovelty) ? 1 : 0);
    const combinedNovelty =
      noveltyDenominator > 0 ? noveltyNumerator / noveltyDenominator : undefined;

    if (stats?.recordMateChoice) {
      stats.recordMateChoice({
        similarity,
        diversity,
        appetite,
        bias,
        selectionMode: selectionKind,
        poolSize: totalMateCandidates > 0 ? totalMateCandidates : evaluatedPoolSize,
        evaluatedPoolSize,
        success: reproduced,
        penalized: penalizedForSimilarity,
        penaltyMultiplier,
        behaviorComplementarity,
        strategyPenaltyMultiplier,
        strategyPressure,
        threshold: pairDiversityThreshold,
        populationScarcityMultiplier: scarcityMultiplier,
        noveltyPressure: combinedNovelty,
      });
    }

    const recordOutcome = (organism) => {
      if (typeof organism?.recordMatingOutcome === "function") {
        organism.recordMatingOutcome({
          diversity,
          success: reproduced,
          penalized: penalizedForSimilarity,
          penaltyMultiplier,
          behaviorComplementarity,
          strategyPenaltyMultiplier,
          populationScarcityMultiplier: scarcityMultiplier,
        });
      }
    };

    recordOutcome(cell);
    recordOutcome(bestMate.target);

    if (reproduced && scarcitySignal > 0) {
      const reliefAmount = Math.max(0, Math.round(1 + scarcitySignal * 2));

      if (reliefAmount > 0) {
        if (typeof cell.reduceReproductionCooldown === "function") {
          cell.reduceReproductionCooldown(reliefAmount);
        }
        if (
          bestMate.target &&
          typeof bestMate.target.reduceReproductionCooldown === "function"
        ) {
          bestMate.target.reduceReproductionCooldown(reliefAmount);
        }
      }
    }

    return reproduced;
  }

  handleCombat(
    row,
    col,
    cell,
    targetGroups,
    {
      stats,
      densityEffectMultiplier,
      densityGrid,
      combatEdgeSharpness,
      combatTerritoryEdgeFactor,
    },
  ) {
    const enemies = targetGroups?.enemies ?? EMPTY_TARGET_LIST;

    if (enemies.length === 0) return false;

    const allies = targetGroups?.society ?? EMPTY_TARGET_LIST;

    const targetEnemy =
      typeof cell.chooseEnemyTarget === "function"
        ? cell.chooseEnemyTarget(enemies, { maxTileEnergy: this.maxTileEnergy })
        : enemies[Math.floor(randomRange(0, enemies.length))];
    const localDensity = densityGrid?.[row]?.[col] ?? this.getDensityAt(row, col);
    const energyDenominator = this.maxTileEnergy > 0 ? this.maxTileEnergy : 1;
    const tileEnergy = this.energyGrid[row][col] / energyDenominator;
    const tileEnergyDelta = this.energyDeltaGrid?.[row]?.[col] ?? 0;
    const action = cell.chooseInteractionAction({
      localDensity,
      densityEffectMultiplier,
      enemies,
      allies,
      maxTileEnergy: this.maxTileEnergy,
      tileEnergy,
      tileEnergyDelta,
    });

    if (action === "avoid") {
      this.boundMoveAwayFromTarget(
        this.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        this.rows,
        this.cols,
      );

      return true;
    }

    const dist = Math.max(
      Math.abs(targetEnemy.row - row),
      Math.abs(targetEnemy.col - col),
    );

    if (action === "fight") {
      if (dist <= 1) {
        const intent = cell.createFightIntent({
          attackerRow: row,
          attackerCol: col,
          targetRow: targetEnemy.row,
          targetCol: targetEnemy.col,
        });

        if (intent)
          this.interactionSystem.resolveIntent(intent, {
            stats,
            densityGrid,
            densityEffectMultiplier,
            combatEdgeSharpness,
            combatTerritoryEdgeFactor,
          });
      } else {
        this.boundMoveToTarget(
          this.grid,
          row,
          col,
          targetEnemy.row,
          targetEnemy.col,
          this.rows,
          this.cols,
        );
      }

      return true;
    }

    if (dist <= 1) {
      const intent = cell.createCooperationIntent({
        row,
        col,
        targetRow: targetEnemy.row,
        targetCol: targetEnemy.col,
        targetCell: targetEnemy.target,
        maxTileEnergy: this.maxTileEnergy,
      });

      if (intent)
        this.interactionSystem.resolveIntent(intent, {
          stats,
        });
    } else
      this.boundMoveToTarget(
        this.grid,
        row,
        col,
        targetEnemy.row,
        targetEnemy.col,
        this.rows,
        this.cols,
      );

    return true;
  }

  handleMovement(
    row,
    col,
    cell,
    {
      mates = EMPTY_TARGET_LIST,
      enemies = EMPTY_TARGET_LIST,
      society = EMPTY_TARGET_LIST,
    },
    { densityGrid, densityEffectMultiplier },
  ) {
    const localDensity = densityGrid[row][col];
    const energyDenominator = this.maxTileEnergy > 0 ? this.maxTileEnergy : 1;

    cell.executeMovementStrategy(this.grid, row, col, mates, enemies, society, {
      localDensity,
      densityEffectMultiplier,
      rows: this.rows,
      cols: this.cols,
      moveToTarget: this.boundMoveToTarget,
      moveAwayFromTarget: this.boundMoveAwayFromTarget,
      moveRandomly: this.boundMoveRandomly,
      tryMove: this.boundTryMove,
      getEnergyAt: (rr, cc) => this.energyGrid[rr][cc] / energyDenominator,
      getEnergyDeltaAt: (rr, cc) => this.energyDeltaGrid?.[rr]?.[cc] ?? 0,
      tileEnergy: this.energyGrid[row][col] / energyDenominator,
      tileEnergyDelta: this.energyDeltaGrid?.[row]?.[col] ?? 0,
      maxTileEnergy: this.maxTileEnergy,
      isTileBlocked: (rr, cc) => this.isTileBlocked(rr, cc),
    });
  }

  update({
    densityEffectMultiplier = 1,
    societySimilarity = 1,
    enemySimilarity = 0,
    eventStrengthMultiplier = 1,
    energyRegenRate = GridManager.energyRegenRate,
    energyDiffusionRate = GridManager.energyDiffusionRate,
    mutationMultiplier = 1,
    matingDiversityThreshold,
    lowDiversityReproMultiplier,
    combatEdgeSharpness = GridManager.combatEdgeSharpness,
    combatTerritoryEdgeFactor = GridManager.combatTerritoryEdgeFactor,
  } = {}) {
    const stats = this.stats;
    const eventManager = this.eventManager;
    const combatSharpness = Number.isFinite(combatEdgeSharpness)
      ? combatEdgeSharpness
      : GridManager.combatEdgeSharpness;
    const territoryFactor = Number.isFinite(combatTerritoryEdgeFactor)
      ? clamp(combatTerritoryEdgeFactor, 0, 1)
      : GridManager.combatTerritoryEdgeFactor;

    this.setMatingDiversityOptions({
      threshold:
        matingDiversityThreshold !== undefined
          ? matingDiversityThreshold
          : stats?.matingDiversityThreshold,
      lowDiversityMultiplier: lowDiversityReproMultiplier,
    });

    this.lastSnapshot = null;
    this.tickCount += 1;
    this.#resetTickSimilarityCache();

    this.populationScarcitySignal = this.#computePopulationScarcitySignal();

    const { densityGrid } = this.prepareTick({
      eventManager,
      eventStrengthMultiplier,
      energyRegenRate,
      energyDiffusionRate,
      densityEffectMultiplier,
    });

    this.densityGrid = densityGrid;
    const processed = new WeakSet();
    const activeSnapshot = this.#acquireActiveCellSnapshot();

    try {
      for (let index = 0; index < activeSnapshot.length; index += 1) {
        const cell = activeSnapshot[index];

        if (!cell) continue;
        const location = this.#resolveCellCoordinates(cell);

        if (!location) continue;

        const { row, col } = location;

        this.processCell(row, col, {
          stats,
          eventManager,
          densityGrid,
          processed,
          densityEffectMultiplier,
          societySimilarity,
          enemySimilarity,
          eventStrengthMultiplier,
          mutationMultiplier,
          combatEdgeSharpness: combatSharpness,
          combatTerritoryEdgeFactor: territoryFactor,
        });
      }
    } finally {
      this.#releaseActiveCellSnapshot();
    }

    this.populationScarcitySignal = this.#computePopulationScarcitySignal();
    this.#enforceEnergyExclusivity();
    this.lastSnapshot = this.buildSnapshot();

    return this.lastSnapshot;
  }

  buildSnapshot(maxTileEnergy) {
    const cap = typeof maxTileEnergy === "number" ? maxTileEnergy : this.maxTileEnergy;
    const entries = [];
    const snapshot = {
      rows: this.rows,
      cols: this.cols,
      population: 0,
      totalEnergy: 0,
      totalAge: 0,
      maxFitness: 0,
      entries,
    };
    const topBrainEntries = createRankedBuffer(
      BRAIN_SNAPSHOT_LIMIT,
      (a, b) => (b?.fitness ?? -Infinity) - (a?.fitness ?? -Infinity),
    );

    const activeCells = this.activeCells;

    if (activeCells && activeCells.size > 0) {
      for (const cell of activeCells) {
        if (!cell) continue;
        if (!this.#ensureTrackedCell(cell)) continue;

        const tracked = this.cellPositions.get(cell);

        if (!tracked) continue;

        const { row, col } = tracked;

        const energy = Number.isFinite(cell.energy) ? cell.energy : 0;
        const age = Number.isFinite(cell.age) ? cell.age : 0;
        const fitness = computeFitness(cell, cap);
        const entry = { row, col, cell, fitness };

        snapshot.population += 1;
        snapshot.totalEnergy += energy;
        snapshot.totalAge += age;
        entries.push(entry);

        if (Number.isFinite(entry.fitness)) {
          topBrainEntries.add(entry);
          if (entry.fitness > snapshot.maxFitness) {
            snapshot.maxFitness = entry.fitness;
          }
        }
      }
    }

    const ranked = topBrainEntries.getItems();
    const collector =
      this.brainSnapshotCollector ?? toBrainSnapshotCollector(GLOBAL.BrainDebugger);
    const collected = collector
      ? collector(ranked, { limit: BRAIN_SNAPSHOT_LIMIT, gridManager: this, snapshot })
      : ranked;

    snapshot.brainSnapshots = Array.isArray(collected) ? collected : ranked;
    snapshot.populationScarcity = clamp(
      Number.isFinite(this.populationScarcitySignal)
        ? this.populationScarcitySignal
        : 0,
      0,
      1,
    );

    return snapshot;
  }

  getLastSnapshot() {
    if (!this.lastSnapshot) {
      this.lastSnapshot = this.buildSnapshot();
    }

    return this.lastSnapshot;
  }

  calculatePopulationDensity() {
    const rows = Number.isFinite(this.rows) ? this.rows : 0;
    const cols = Number.isFinite(this.cols) ? this.cols : 0;
    const population = this.activeCells?.size ?? 0;
    const area = rows * cols;

    if (population <= 0 || area <= 0) {
      return 0;
    }

    return clamp(population / area, 0, 1);
  }

  #acquireTargetDescriptor() {
    const descriptor = this.#targetDescriptorPool.pop();

    if (descriptor) {
      return descriptor;
    }

    return {
      row: 0,
      col: 0,
      target: null,
      classification: "",
      precomputedSimilarity: 0,
    };
  }

  #resetTargetDescriptor(descriptor) {
    descriptor.row = 0;
    descriptor.col = 0;
    descriptor.target = null;
    descriptor.classification = "";
    descriptor.precomputedSimilarity = 0;

    descriptor.similarity = 0;

    for (const key in descriptor) {
      if (!TARGET_DESCRIPTOR_BASE_KEYS.has(key)) {
        descriptor[key] = undefined;
      }
    }

    return descriptor;
  }

  #flushTargetList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const descriptor = list[i];

      if (!descriptor) continue;

      this.#targetDescriptorPool.push(this.#resetTargetDescriptor(descriptor));
      list[i] = null;
    }

    list.length = 0;
  }

  #beginTargetScan() {
    const scratch = this.#targetScratch;

    this.#flushTargetList(scratch.mates);
    this.#flushTargetList(scratch.enemies);
    this.#flushTargetList(scratch.society);

    return scratch;
  }

  #endTargetScan() {
    const scratch = this.#targetScratch;

    this.#flushTargetList(scratch.mates);
    this.#flushTargetList(scratch.enemies);
    this.#flushTargetList(scratch.society);
  }

  #resetTickSimilarityCache() {
    this.#tickSimilarityCache = new WeakMap();
    this.#tickSimilarityVersion = this.tickCount;
  }

  #ensureTickSimilarityCache() {
    if (!this.#tickSimilarityCache || this.#tickSimilarityVersion !== this.tickCount) {
      this.#resetTickSimilarityCache();
    }

    return this.#tickSimilarityCache;
  }

  #resolveTargetSimilarity(cellA, cellB) {
    if (!cellA || !cellB) return 0;

    const cache = this.#ensureTickSimilarityCache();
    let mapForA = cache.get(cellA);

    if (mapForA && mapForA.has(cellB)) {
      return mapForA.get(cellB);
    }

    const mapForB = cache.get(cellB);

    if (mapForB && mapForB.has(cellA)) {
      const value = mapForB.get(cellA);

      if (!mapForA) {
        mapForA = new WeakMap();
        cache.set(cellA, mapForA);
      }

      mapForA.set(cellB, value);

      return value;
    }

    const value = getPairSimilarity(cellA, cellB);

    if (!mapForA) {
      mapForA = new WeakMap();
      cache.set(cellA, mapForA);
    }

    mapForA.set(cellB, value);

    if (cellA !== cellB) {
      let reverseMap = mapForB;

      if (!reverseMap) {
        reverseMap = new WeakMap();
        cache.set(cellB, reverseMap);
      }

      reverseMap.set(cellA, value);
    }

    return value;
  }

  findTargets(
    row,
    col,
    cell,
    { densityEffectMultiplier = 1, societySimilarity = 1, enemySimilarity = 0 } = {},
  ) {
    const { mates, enemies, society } = this.#beginTargetScan();
    const d =
      this.densityGrid?.[row]?.[col] ??
      this.localDensity(row, col, GridManager.DENSITY_RADIUS);
    const effD = clamp(d * densityEffectMultiplier, 0, 1);
    let enemyBias = lerp(cell.density.enemyBias.min, cell.density.enemyBias.max, effD);
    // Modulate random enemy bias by dynamic risk tolerance
    const riskSource =
      typeof cell?.getRiskTolerance === "function"
        ? cell.getRiskTolerance()
        : typeof cell?.dna?.riskTolerance === "function"
          ? cell.dna.riskTolerance()
          : 0.5;
    const risk = clamp(Number.isFinite(riskSource) ? riskSource : 0.5, 0, 1);

    enemyBias = Math.max(0, enemyBias * (0.4 + 0.8 * risk));
    const allyT =
      typeof cell.dna.allyThreshold === "function"
        ? cell.dna.allyThreshold()
        : societySimilarity;
    const enemyT =
      typeof cell.dna.enemyThreshold === "function"
        ? cell.dna.enemyThreshold()
        : enemySimilarity;

    const grid = this.grid;
    const sight = Math.max(0, Math.floor(Number.isFinite(cell.sight) ? cell.sight : 0));
    const minRow = Math.max(0, row - sight);
    const maxRow = Math.min(this.rows - 1, row + sight);
    const minCol = Math.max(0, col - sight);
    const maxCol = Math.min(this.cols - 1, col + sight);
    const hasSharedRng = typeof cell.resolveSharedRng === "function";
    const resolveHostilityRng = hasSharedRng
      ? (other) => cell.resolveSharedRng(other, "hostilityGate")
      : null;
    const defaultHostilityRng = Math.random;
    const shouldSampleEnemyBias = enemyBias > 0;
    const occupancyRows = this.#rowOccupancy;

    if (sight <= 0) {
      return this.#targetGroupsView;
    }

    const processCandidate = (targetRow, targetCol, bucket) => {
      if (targetRow === row && targetCol === col) return;

      const gridRow = grid[targetRow];

      if (!gridRow) {
        bucket?.delete?.(targetCol);

        return;
      }

      const target = gridRow[targetCol];

      if (!target) {
        bucket?.delete?.(targetCol);

        return;
      }

      const similarity = this.#resolveTargetSimilarity(cell, target);

      if (similarity >= allyT) {
        const descriptor = this.#acquireTargetDescriptor();

        descriptor.row = targetRow;
        descriptor.col = targetCol;
        descriptor.target = target;
        descriptor.classification = "society";
        descriptor.precomputedSimilarity = similarity;
        descriptor.similarity = similarity;

        society.push(descriptor);

        return;
      }

      let classifyAsEnemy = similarity <= enemyT;

      if (!classifyAsEnemy && shouldSampleEnemyBias) {
        const hostilityRng = resolveHostilityRng
          ? resolveHostilityRng(target)
          : defaultHostilityRng;

        if (typeof hostilityRng === "function" && hostilityRng() < enemyBias) {
          classifyAsEnemy = true;
        }
      }

      if (classifyAsEnemy) {
        const descriptor = this.#acquireTargetDescriptor();

        descriptor.row = targetRow;
        descriptor.col = targetCol;
        descriptor.target = target;
        descriptor.classification = "enemy";
        descriptor.precomputedSimilarity = similarity;
        descriptor.similarity = similarity;

        enemies.push(descriptor);

        return;
      }

      const descriptor = this.#acquireTargetDescriptor();

      descriptor.row = targetRow;
      descriptor.col = targetCol;
      descriptor.target = target;
      descriptor.classification = "mate";
      descriptor.precomputedSimilarity = similarity;
      descriptor.similarity = similarity;

      mates.push(descriptor);
    };

    const iterateRowColumns = (targetRow, bucket, startCol, endCol) => {
      if (!bucket || startCol > endCol) return;

      const rangeLength = endCol - startCol + 1;

      if (
        bucket instanceof Set &&
        bucket.size > 0 &&
        typeof bucket.values === "function" &&
        bucket.size < rangeLength
      ) {
        for (const value of bucket.values()) {
          if (value < startCol || value > endCol) continue;

          processCandidate(targetRow, value, bucket);
        }

        return;
      }

      for (let newCol = startCol; newCol <= endCol; newCol++) {
        if (!bucket?.has?.(newCol)) continue;

        processCandidate(targetRow, newCol, bucket);
      }
    };

    for (let dist = 1; dist <= sight; dist++) {
      const topRow = row - dist;

      if (topRow >= minRow) {
        const bucket = occupancyRows?.[topRow];

        if (bucket && bucket.size > 0) {
          const startCol = Math.max(minCol, col - dist);
          const endCol = Math.min(maxCol, col + dist);

          iterateRowColumns(topRow, bucket, startCol, endCol);
        }
      }

      const bottomRow = row + dist;

      if (bottomRow <= maxRow && bottomRow !== topRow) {
        const bucket = occupancyRows?.[bottomRow];

        if (bucket && bucket.size > 0) {
          const startCol = Math.max(minCol, col - dist);
          const endCol = Math.min(maxCol, col + dist);

          iterateRowColumns(bottomRow, bucket, startCol, endCol);
        }
      }

      const leftCol = col - dist;

      if (leftCol >= minCol) {
        const startRow = Math.max(minRow, row - dist + 1);
        const endRow = Math.min(maxRow, row + dist - 1);

        for (let newRow = startRow; newRow <= endRow; newRow++) {
          const bucket = occupancyRows?.[newRow];

          if (!bucket || !bucket.has(leftCol)) continue;

          processCandidate(newRow, leftCol, bucket);
        }
      }

      const rightCol = col + dist;

      if (rightCol <= maxCol && rightCol !== leftCol) {
        const startRow = Math.max(minRow, row - dist + 1);
        const endRow = Math.min(maxRow, row + dist - 1);

        for (let newRow = startRow; newRow <= endRow; newRow++) {
          const bucket = occupancyRows?.[newRow];

          if (!bucket || !bucket.has(rightCol)) continue;

          processCandidate(newRow, rightCol, bucket);
        }
      }
    }

    return this.#targetGroupsView;
  }

  // Spawn a cluster of new cells around a center position
  burstAt(centerRow, centerCol, { count = 200, radius = 6 } = {}) {
    const coords = [];

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const rr = centerRow + dy;
        const cc = centerCol + dx;

        if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols) continue;

        coords.push({ rr, cc });
      }
    }
    // Shuffle for random fill
    for (let i = coords.length - 1; i > 0; i--) {
      const j = (this.#random() * (i + 1)) | 0;
      const t = coords[i];

      coords[i] = coords[j];
      coords[j] = t;
    }
    let placed = 0;

    for (let i = 0; i < coords.length && placed < count; i++) {
      const { rr, cc } = coords[i];

      if (!this.grid[rr][cc] && !this.isObstacle(rr, cc)) {
        const dna = DNA.random(() => this.#random());

        this.spawnCell(rr, cc, { dna, recordBirth: true });
        placed++;
      }
    }

    return placed;
  }

  // Choose a random center and burst there
  burstRandomCells(opts = {}) {
    const r = (this.#random() * this.rows) | 0;
    const c = (this.#random() * this.cols) | 0;

    return this.burstAt(r, c, opts);
  }
}
