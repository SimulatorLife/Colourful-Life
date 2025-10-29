import {
  randomRange,
  clamp,
  lerp,
  sanitizePositiveInteger,
  sanitizeUnitInterval,
} from "../utils/math.js";
import { isArrayLike } from "../utils/collections.js";
import { resolveCellColor } from "../utils/cell.js";
import { warnOnce } from "../utils/error.js";
import DNA from "../genome.js";
import Cell from "../cell.js";
import { computeFitness } from "../stats/fitness.js";
import { computeBehaviorComplementarity } from "./behaviorComplementarity.js";
import { summarizeMateDiversityOpportunity } from "./diversityOpportunity.js";
import {
  createEventContext,
  defaultEventContext,
  defaultIsEventAffecting,
} from "../events/eventContext.js";
import {
  accumulateEventModifiers,
  resolveEventContribution,
} from "../events/eventModifiers.js";
import GridInteractionAdapter from "./gridAdapter.js";
import { clearTileEnergyBuffers } from "./energyUtils.js";
import ReproductionZonePolicy from "./reproductionZonePolicy.js";
import { OBSTACLE_PRESETS, resolveObstaclePresetCatalog } from "./obstaclePresets.js";
import { resolvePopulationScarcityMultiplier } from "./populationScarcity.js";
import { resolveGridEnvironment } from "./gridEnvironment.js";
import {
  EMPTY_COLOR_RECORD,
  resolveCellColorRecord,
  supportsPackedColor,
} from "./colorRecords.js";
import {
  MAX_TILE_ENERGY,
  ENERGY_REGEN_RATE_DEFAULT,
  ENERGY_DIFFUSION_RATE_DEFAULT,
  DENSITY_RADIUS,
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  COMBAT_TERRITORY_EDGE_FACTOR,
  REGEN_DENSITY_PENALTY,
  CONSUMPTION_DENSITY_PENALTY,
  DECAY_RETURN_FRACTION,
  DECAY_IMMEDIATE_SHARE,
  DECAY_MAX_AGE,
  DECAY_RELEASE_BASE,
  DECAY_RELEASE_RATE,
  INITIAL_TILE_ENERGY_FRACTION_DEFAULT,
} from "../config.js";
const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};
const EMPTY_EVENT_LIST = Object.freeze([]);
const EMPTY_TARGET_LIST = Object.freeze([]);
const EMPTY_FLOAT64_ARRAY = Object.freeze(new Float64Array(0));
const EMPTY_UINT8_ARRAY = Object.freeze(new Uint8Array(0));

const similarityCache = new WeakMap();
// Cache crowding metrics directly on occupants to avoid repeated preference and
// energy normalization work when tiles share neighbors across regeneration
// passes. A `Symbol` key prevents collisions with consumer-defined fields while
// allowing inexpensive lookups compared to WeakMap indirection.
const CROWDING_SAMPLE_CACHE_KEY = Symbol("crowdingSampleCache");
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
const CROWDING_INV_NEIGHBOR_COUNT = Object.freeze([
  0,
  1,
  0.5,
  1 / 3,
  0.25,
  0.2,
  1 / 6,
  1 / 7,
  0.125,
]);
const DIFFUSION_INV_NEIGHBOR_COUNT = Object.freeze([0, 1, 0.5, 1 / 3, 0.25]);
const DEFAULT_CROWDING_SUMMARY = Object.freeze({
  comfort: 0.5,
  scarcity: 0,
  count: 0,
});
const CROWDING_REVISION_LIMIT = 0xffffffff;
const SEGMENTED_EVENT_CONTRIBUTION_KEY = Symbol("grid.segmentedContribution");

const NOOP_INTERACTION_SYSTEM = Object.freeze({
  resolveIntent() {
    return false;
  },
});

function normalizeInteractionSystem(candidate) {
  if (candidate && typeof candidate.resolveIntent === "function") {
    return candidate;
  }

  return NOOP_INTERACTION_SYSTEM;
}

function resolveInteractionAdapter(options, gridManager) {
  const factory = options?.interactionAdapterFactory;

  if (typeof factory === "function") {
    const adapter = factory({ gridManager, options });

    if (adapter) {
      return adapter;
    }
  }

  return new GridInteractionAdapter({ gridManager });
}

function resolveInteractionSystem(options, { gridManager, adapter }) {
  if (options?.interactionSystem) {
    return options.interactionSystem;
  }

  const factory = options?.interactionSystemFactory;

  if (typeof factory === "function") {
    return factory({ gridManager, adapter, options }) ?? null;
  }

  return null;
}

function computeReproductionDistanceScaling({
  separation,
  effectiveReach,
  parentReach,
  mateReach,
  parentTileEnergy,
  mateTileEnergy,
  parentTileEnergyDelta,
  mateTileEnergyDelta,
  parentLocalDensity,
  mateLocalDensity,
}) {
  if (!Number.isFinite(separation) || separation <= 1) {
    return { probability: 1, energy: 1 };
  }

  const reachAllowance = Math.max(0, effectiveReach - 1);

  if (reachAllowance <= 0) {
    return { probability: 0, energy: Infinity };
  }

  const normalizedDistance = clamp((separation - 1) / reachAllowance, 0, 1);
  const parentEnergy = clamp(
    Number.isFinite(parentTileEnergy) ? parentTileEnergy : 0,
    0,
    1,
  );
  const mateEnergy = clamp(
    Number.isFinite(mateTileEnergy) ? mateTileEnergy : parentEnergy,
    0,
    1,
  );
  const avgEnergy = clamp((parentEnergy + mateEnergy) / 2, 0, 1);
  const parentDensity = clamp(
    Number.isFinite(parentLocalDensity) ? parentLocalDensity : 0,
    0,
    1,
  );
  const mateDensity = clamp(
    Number.isFinite(mateLocalDensity) ? mateLocalDensity : parentDensity,
    0,
    1,
  );
  const avgDensity = clamp((parentDensity + mateDensity) / 2, 0, 1);
  const parentTrend = clamp(
    Number.isFinite(parentTileEnergyDelta) ? parentTileEnergyDelta : 0,
    -1,
    1,
  );
  const mateTrend = clamp(
    Number.isFinite(mateTileEnergyDelta) ? mateTileEnergyDelta : parentTrend,
    -1,
    1,
  );
  const avgTrend = clamp((parentTrend + mateTrend) / 2, -1, 1);
  const reachConfidence = clamp(
    (Number.isFinite(parentReach) ? parentReach : 1) +
      (Number.isFinite(mateReach) ? mateReach : 1),
    0,
    Number.POSITIVE_INFINITY,
  );
  const normalizedReachConfidence = clamp(
    reachConfidence / (2 * Math.max(effectiveReach, 1e-6)),
    0,
    1,
  );

  let environmentalSupport = 0.45 + avgEnergy * 0.4 - avgDensity * 0.3;

  if (avgTrend < 0) {
    environmentalSupport += -avgTrend * 0.25;
  }

  environmentalSupport = clamp(environmentalSupport, 0.15, 1.2);

  const penaltyStrength = clamp(
    0.3 + (1 - environmentalSupport) * 0.35 + (1 - normalizedReachConfidence) * 0.25,
    0.1,
    0.9,
  );
  const probability = clamp(1 - normalizedDistance * penaltyStrength, 0.1, 1);
  const energy = clamp(
    1 + normalizedDistance * (0.3 + (1 - environmentalSupport) * 0.4),
    1,
    1.75,
  );

  return { probability, energy };
}

function computeCrowdingFeedback({
  grid,
  row,
  col,
  rows,
  cols,
  neighborOffsets = NEIGHBOR_OFFSETS,
  maxTileEnergy = 0,
  result = null,
} = {}) {
  const out =
    result && typeof result === "object"
      ? result
      : { comfort: 0.5, scarcity: 0, count: 0 };
  const gridRows = Array.isArray(grid) ? grid : null;

  if (!gridRows || rows <= 0 || cols <= 0) {
    out.comfort = 0.5;
    out.scarcity = 0;
    out.count = 0;

    return out;
  }

  let toleranceSum = 0;
  let scarcitySum = 0;
  let count = 0;
  const useScarcity = maxTileEnergy > 0;
  const norm = useScarcity ? 1 / maxTileEnergy : 0;
  const defaultTolerance = 0.5;
  const useCustomOffsets =
    Array.isArray(neighborOffsets) && neighborOffsets !== NEIGHBOR_OFFSETS;
  const maxEnergyForCache = useScarcity ? maxTileEnergy : 0;

  const accumulateOccupant = (occupant) => {
    if (!occupant) {
      return;
    }

    const baselineCandidate = occupant.baseCrowdingTolerance;
    const baseline = Number.isFinite(baselineCandidate)
      ? baselineCandidate
      : defaultTolerance;
    let toleranceSource = occupant._crowdingTolerance;

    if (!Number.isFinite(toleranceSource)) {
      const getPreference = occupant.getCrowdingPreference;

      if (typeof getPreference === "function") {
        const resolved = getPreference.call(occupant, { fallback: baseline });

        toleranceSource = Number.isFinite(resolved) ? resolved : baseline;
      } else {
        toleranceSource = baseline;
      }
    }
    const energy = Number.isFinite(occupant.energy) ? occupant.energy : 0;
    let cached = occupant[CROWDING_SAMPLE_CACHE_KEY];

    if (
      cached &&
      cached.toleranceSource === toleranceSource &&
      cached.energy === energy &&
      cached.maxTileEnergy === maxEnergyForCache
    ) {
      toleranceSum += cached.tolerance;

      if (useScarcity) {
        scarcitySum += cached.scarcityContribution;
      }

      count += 1;

      return;
    }

    let tolerance = toleranceSource;

    if (tolerance <= 0) {
      tolerance = 0;
    } else if (tolerance >= 1) {
      tolerance = 1;
    }

    let scarcityContribution = 0;

    if (useScarcity) {
      let normalizedEnergy = energy * norm;

      if (normalizedEnergy <= 0) {
        normalizedEnergy = 0;
      } else if (normalizedEnergy >= 1) {
        normalizedEnergy = 1;
      }

      scarcityContribution = 1 - normalizedEnergy;
      scarcitySum += scarcityContribution;
    }

    toleranceSum += tolerance;
    count += 1;

    if (!cached || typeof cached !== "object") {
      cached = occupant[CROWDING_SAMPLE_CACHE_KEY] = {
        tolerance,
        toleranceSource,
        energy,
        scarcityContribution,
        maxTileEnergy: maxEnergyForCache,
      };

      return;
    }

    cached.tolerance = tolerance;
    cached.toleranceSource = toleranceSource;
    cached.energy = energy;
    cached.scarcityContribution = scarcityContribution;
    cached.maxTileEnergy = maxEnergyForCache;
  };

  if (useCustomOffsets) {
    for (let i = 0; i < neighborOffsets.length; i++) {
      const offset = neighborOffsets[i];

      if (!offset) continue;

      const offsetRow = offset[0];
      const offsetCol = offset[1];

      if (!Number.isFinite(offsetRow) || !Number.isFinite(offsetCol)) continue;

      const nr = row + offsetRow;
      const nc = col + offsetCol;

      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

      const neighborRow = gridRows[nr];

      if (!neighborRow) continue;

      accumulateOccupant(neighborRow[nc]);
    }
  } else if (row >= 0 && row < rows && col >= 0 && col < cols) {
    const lastRowIndex = rows - 1;
    const lastColIndex = cols - 1;
    const leftIndex = col > 0 ? col - 1 : -1;
    const rightIndex = col < lastColIndex ? col + 1 : -1;
    const currentRow = gridRows[row];
    const rowAbove = row > 0 ? gridRows[row - 1] : null;
    const rowBelow = row < lastRowIndex ? gridRows[row + 1] : null;

    if (rowAbove) {
      if (leftIndex !== -1) accumulateOccupant(rowAbove[leftIndex]);
      accumulateOccupant(rowAbove[col]);
      if (rightIndex !== -1) accumulateOccupant(rowAbove[rightIndex]);
    }

    if (currentRow) {
      if (leftIndex !== -1) accumulateOccupant(currentRow[leftIndex]);
      if (rightIndex !== -1) accumulateOccupant(currentRow[rightIndex]);
    }

    if (rowBelow) {
      if (leftIndex !== -1) accumulateOccupant(rowBelow[leftIndex]);
      accumulateOccupant(rowBelow[col]);
      if (rightIndex !== -1) accumulateOccupant(rowBelow[rightIndex]);
    }
  } else {
    const lastRowIndex = rows - 1;
    const lastColIndex = cols - 1;
    const startRow = row > 0 ? row - 1 : row < 0 ? 0 : row;
    const endRow = row < lastRowIndex ? row + 1 : lastRowIndex;
    const startCol = col > 0 ? col - 1 : col < 0 ? 0 : col;
    const endCol = col < lastColIndex ? col + 1 : lastColIndex;

    for (let nr = startRow; nr <= endRow; nr++) {
      const neighborRow = gridRows[nr];

      if (!neighborRow) continue;

      const sameRow = nr === row;

      for (let nc = startCol; nc <= endCol; nc++) {
        if (sameRow && nc === col) continue;

        accumulateOccupant(neighborRow[nc]);
      }
    }
  }

  if (count > 0) {
    let comfort = toleranceSum / count;

    if (comfort <= 0) {
      comfort = 0;
    } else if (comfort >= 1) {
      comfort = 1;
    }

    let scarcity = scarcitySum / count;

    if (scarcity <= 0) {
      scarcity = 0;
    } else if (scarcity >= 1) {
      scarcity = 1;
    }

    out.comfort = comfort;
    out.scarcity = useScarcity ? scarcity : 0;
    out.count = count;
  } else {
    out.comfort = 0.5;
    out.scarcity = 0;
    out.count = 0;
  }

  return out;
}

const DECAY_EPSILON = 1e-4;
const ENERGY_SPARSE_SCAN_RATIO = 0.2;
const TARGET_DESCRIPTOR_POOL_DECAY = 0.82;
const TARGET_DESCRIPTOR_POOL_MIN = 256;

function resolveInitialTileEnergyFraction(candidate) {
  const numeric = Number(candidate);

  if (!Number.isFinite(numeric)) {
    return INITIAL_TILE_ENERGY_FRACTION_DEFAULT;
  }

  return clamp(numeric, 0, 1);
}

function normalizeDimension(candidate) {
  return sanitizePositiveInteger(candidate, { fallback: 0, min: 0 });
}

function normalizeDimensions(rowCount, colCount) {
  return {
    rows: normalizeDimension(rowCount),
    cols: normalizeDimension(colCount),
  };
}

function lowerBound(sortedArray, target) {
  let low = 0;
  let high = Array.isArray(sortedArray) ? sortedArray.length : 0;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (sortedArray[mid] < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

const TARGET_DESCRIPTOR_BASE_KEYS = Object.freeze([
  "row",
  "col",
  "target",
  "classification",
  "precomputedSimilarity",
  "similarity",
]);
const TARGET_DESCRIPTOR_BASE_KEY_SET = new Set(TARGET_DESCRIPTOR_BASE_KEYS);
const TARGET_DESCRIPTOR_DYNAMIC_KEYS = new Set([
  "noveltyPressure",
  "diversity",
  "appetite",
  "mateBias",
  "curiosityBonus",
  "preferenceScore",
  "selectionWeight",
  "baseReproductionProbability",
  "neuralAffinity",
]);

const TIMESTAMP_NOW =
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

const IMAGE_DATA_SPARSE_AREA_RATIO = 12;
const IMAGE_DATA_SPARSE_MIN_TILES = 1;

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
  static DENSITY_RADIUS = DENSITY_RADIUS;
  static maxTileEnergy = MAX_TILE_ENERGY;
  static combatEdgeSharpness = COMBAT_EDGE_SHARPNESS_DEFAULT;
  static combatTerritoryEdgeFactor = COMBAT_TERRITORY_EDGE_FACTOR;
  #spawnCandidateScratch = null;
  #spawnCandidateWeightsScratch = null;
  #spawnCandidateEnergizedScratch = null;
  #segmentWindowScratch = null;
  #columnEventScratch = null;
  #eventRowsScratch = null;
  #crowdingComfortGrid = null;
  #crowdingScarcityGrid = null;
  #crowdingCountGrid = null;
  #crowdingRevisionGrid = null;
  #crowdingRevision = 0;
  #crowdingPrepared = false;
  #crowdingPreparedUseScarcity = false;
  #crowdingTouchedRows = [];
  #crowdingTouchedCols = [];
  #activeCellSnapshotScratch = null;
  #eventModifierScratch = null;
  #sparseDirtyColumnsScratch = null;
  #sparseDirtyRowsScratch = null;
  #densityPrefixScratch = null;
  #densityRowTopScratch = null;
  #densityRowBottomScratch = null;
  #densityColLeftScratch = null;
  #densityColRightScratch = null;
  #occupantRegenVersion = null;
  #occupantRegenRevision = 0;
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
  #targetDescriptorUsageAverage = 0;
  #targetUsageAccumulator = 0;
  #rowOccupancy = [];
  #columnOccupancy = [];
  #rowOccupancySorted = [];
  #columnOccupancySorted = [];
  #tickSimilarityCache = new WeakMap();
  #tickSimilarityRowsInUse = [];
  #tickSimilarityRowPool = [];
  #tickSimilarityVersion = -1;
  #populationCellsScratch = null;
  #energyDeltaDirtyTiles = null;
  #energyDeltaLastSparse = false;
  #decayActiveScratch = null;
  #crowdingFeedbackScratch = { ...DEFAULT_CROWDING_SUMMARY };
  #segmentedEventContributionCache = null;
  #segmentedEventContributionCleanup = null;
  #densityIntegral = null;
  #densityIntegralRows = 0;
  #densityIntegralCols = 0;
  #densityIntegralDirty = true;
  #densityTotalsCache = new Map();
  #renderDirtyIndices = [];
  #renderDirtyFlags = null;
  #renderDirtyPositions = null;
  #renderDirtyRevision = 1;
  #renderDirtyView = null;

  #initializeRenderDirtyTracking(rows, cols) {
    const total = Math.max(0, Math.floor(rows) * Math.floor(cols));

    this.#renderDirtyIndices = [];
    this.#renderDirtyFlags = total > 0 ? new Uint32Array(total) : null;
    this.#renderDirtyPositions = total > 0 ? new Int32Array(total).fill(-1) : null;
    this.#renderDirtyRevision = 1;

    if (!this.#renderDirtyView) {
      this.#renderDirtyView = this.#createRenderDirtyView();
      Object.defineProperty(this, "renderDirtyTiles", {
        configurable: true,
        enumerable: false,
        value: this.#renderDirtyView,
      });
    }
  }

  #ensureRenderDirtyCapacity() {
    const total = Math.max(0, Math.floor(this.rows) * Math.floor(this.cols));

    if (!this.#renderDirtyFlags || this.#renderDirtyFlags.length !== total) {
      this.#renderDirtyFlags = total > 0 ? new Uint32Array(total) : null;
      this.#renderDirtyIndices.length = 0;
      this.#renderDirtyRevision = 1;
      this.#renderDirtyPositions = total > 0 ? new Int32Array(total).fill(-1) : null;
    } else if (this.#renderDirtyPositions?.length !== total) {
      this.#renderDirtyPositions = total > 0 ? new Int32Array(total).fill(-1) : null;
    }

    return Boolean(this.#renderDirtyFlags);
  }

  #createRenderDirtyView() {
    const manager = this;

    return {
      add(value) {
        manager.#markRenderDirtyIndex(value);

        return this;
      },
      clear() {
        manager.#clearRenderDirtyTiles();
      },
      has(value) {
        return manager.#hasRenderDirtyIndex(value);
      },
      delete(value) {
        return manager.#deleteRenderDirtyIndex(value);
      },
      get size() {
        return manager.#renderDirtyIndices.length;
      },
      [Symbol.iterator]() {
        return manager.#renderDirtyIndices[Symbol.iterator]();
      },
    };
  }

  #hasRenderDirtyIndex(index) {
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }

    const flags = this.#renderDirtyFlags;

    if (!flags || index >= flags.length) {
      return false;
    }

    return flags[index] === this.#renderDirtyRevision;
  }

  #markRenderDirtyIndex(index) {
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }

    if (!this.#ensureRenderDirtyCapacity()) {
      return false;
    }

    const flags = this.#renderDirtyFlags;
    const positions = this.#renderDirtyPositions;

    if (!flags || index >= flags.length) {
      return false;
    }

    const revision = this.#renderDirtyRevision;

    if (flags[index] === revision) {
      return false;
    }

    flags[index] = revision;
    const nextPosition = this.#renderDirtyIndices.length;

    this.#renderDirtyIndices.push(index);

    if (positions && index < positions.length) {
      positions[index] = nextPosition;
    }

    return true;
  }

  #deleteRenderDirtyIndex(index) {
    if (!Number.isInteger(index) || index < 0) {
      return false;
    }

    const flags = this.#renderDirtyFlags;

    if (!flags || index >= flags.length) {
      return false;
    }

    if (flags[index] !== this.#renderDirtyRevision) {
      return false;
    }

    flags[index] = 0;

    const list = this.#renderDirtyIndices;
    const positions = this.#renderDirtyPositions;
    const last = list.length - 1;

    if (last >= 0) {
      let position = -1;

      if (positions && index < positions.length) {
        position = positions[index];
      }

      if (position < 0 || position > last) {
        for (let i = 0; i <= last; i++) {
          if (list[i] === index) {
            position = i;

            break;
          }
        }
      }

      if (position >= 0 && position <= last) {
        const lastValue = list[last];

        if (position !== last) {
          list[position] = lastValue;

          if (positions && lastValue < positions.length) {
            positions[lastValue] = position;
          }
        }

        list.length = last;
      }

      if (positions && index < positions.length) {
        positions[index] = -1;
      }
    }

    return true;
  }

  #markRenderTileDirty(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) {
      return;
    }

    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
      return;
    }

    const index = row * this.cols + col;

    this.#markRenderDirtyIndex(index);
  }

  #clearRenderDirtyTiles() {
    const indices = this.#renderDirtyIndices;
    const positions = this.#renderDirtyPositions;

    if (indices.length > 0) {
      if (positions) {
        for (let i = 0; i < indices.length; i++) {
          const tileIndex = indices[i];

          if (tileIndex < positions.length) {
            positions[tileIndex] = -1;
          }
        }
      }

      indices.length = 0;
    }

    this.#renderDirtyRevision = (this.#renderDirtyRevision + 1) >>> 0;

    if (this.#renderDirtyRevision === 0) {
      this.#renderDirtyRevision = 1;

      if (this.#renderDirtyFlags) {
        this.#renderDirtyFlags.fill(0);
      }

      if (positions) {
        positions.fill(-1);
      }
    }
  }

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
    if (!this.#isCellRecord(cell)) return 0;

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

  static #summarizeMateDiversityOpportunity(options = {}) {
    return summarizeMateDiversityOpportunity(options);
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

  #acquirePopulationCellScratch() {
    if (!Array.isArray(this.#populationCellsScratch)) {
      this.#populationCellsScratch = [];
    } else {
      this.#populationCellsScratch.length = 0;
    }

    return this.#populationCellsScratch;
  }

  #acquireDecayActiveBuffer() {
    const scratch = this.#decayActiveScratch;

    if (scratch) {
      this.#decayActiveScratch = null;
      scratch.clear();

      return scratch;
    }

    return new Set();
  }

  #recycleDecayActiveBuffer(buffer) {
    if (!buffer) {
      return;
    }

    buffer.clear();
    this.#decayActiveScratch = buffer;
  }

  #ensureTrackedCell(cell) {
    if (!GridManager.#isCellRecord(cell)) {
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
      this.#sparseDirtyColumnsScratch.forEach((column) => {
        column.length = 0;
      });
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
      this.#eventRowsScratch.forEach((rowEvents) => {
        rowEvents.length = 0;
      });
    }

    return this.#eventRowsScratch;
  }

  #prepareCrowdingFeedback(rows, cols, maxTileEnergy) {
    this.#crowdingPrepared = false;

    if (rows <= 0 || cols <= 0) {
      return false;
    }

    const comfortGrid = this.#crowdingComfortGrid;
    const scarcityGrid = this.#crowdingScarcityGrid;
    const countGrid = this.#crowdingCountGrid;
    let revisionGrid = this.#crowdingRevisionGrid;
    let revision = this.#crowdingRevision + 1;
    let forceClear = false;

    if (!Number.isFinite(revision) || revision >= CROWDING_REVISION_LIMIT) {
      revision = 1;
      forceClear = true;
    }

    const ensureRow = (grid, factory, { clear = false } = {}) => {
      if (!Array.isArray(grid) || grid.length !== rows) {
        return Array.from({ length: rows }, factory);
      }

      for (let r = 0; r < rows; r++) {
        const existing = grid[r];

        if (!existing || existing.length !== cols) {
          grid[r] = factory();
        } else if (clear) {
          existing.fill(0);
        }
      }

      return grid;
    };

    this.#crowdingComfortGrid = ensureRow(comfortGrid, () => new Float32Array(cols), {
      clear: forceClear,
    });
    this.#crowdingCountGrid = ensureRow(countGrid, () => new Uint8Array(cols), {
      clear: forceClear,
    });

    if (scarcityGrid && scarcityGrid.length === rows) {
      for (let r = 0; r < rows; r++) {
        const existing = scarcityGrid[r];

        if (!existing || existing.length !== cols) {
          this.#crowdingScarcityGrid[r] = new Float32Array(cols);
        } else if (forceClear) {
          existing.fill(0);
        }
      }
    } else {
      this.#crowdingScarcityGrid = Array.from(
        { length: rows },
        () => new Float32Array(cols),
      );
    }

    revisionGrid = ensureRow(revisionGrid, () => new Uint32Array(cols), {
      clear: forceClear,
    });
    this.#crowdingRevisionGrid = revisionGrid;
    this.#crowdingRevision = revision;

    const comfort = this.#crowdingComfortGrid;
    const scarcity = this.#crowdingScarcityGrid;
    const counts = this.#crowdingCountGrid;
    const grid = this.grid;
    const useScarcity = maxTileEnergy > 0;
    const invMaxTileEnergy = useScarcity ? 1 / maxTileEnergy : 0;
    const fillScarcity = useScarcity && Array.isArray(scarcity);

    const touchedRows = this.#crowdingTouchedRows;
    const touchedCols = this.#crowdingTouchedCols;
    const invCountLookup = CROWDING_INV_NEIGHBOR_COUNT;

    touchedRows.length = 0;
    touchedCols.length = 0;

    if (forceClear) {
      for (let r = 0; r < rows; r++) {
        const comfortRow = comfort[r];
        const countRow = counts[r];
        const revisionRow = revisionGrid[r];

        if (comfortRow) {
          comfortRow.fill(0);
        }

        if (countRow) {
          countRow.fill(0);
        }

        if (fillScarcity) {
          const scarcityRow = scarcity[r];

          if (scarcityRow) {
            scarcityRow.fill(0);
          }
        }

        if (revisionRow) {
          revisionRow.fill(0);
        }
      }
    }

    const applyCrowdingContribution = (occupant, r, c) => {
      if (!occupant) return false;

      let tolerance = Number.isFinite(occupant._crowdingTolerance)
        ? occupant._crowdingTolerance
        : Number.isFinite(occupant.baseCrowdingTolerance)
          ? occupant.baseCrowdingTolerance
          : 0.5;

      if (tolerance <= 0) {
        tolerance = 0;
      } else if (tolerance >= 1) {
        tolerance = 1;
      }

      let scarcityContribution = 0;

      if (useScarcity) {
        let normalizedEnergy = Number.isFinite(occupant.energy)
          ? occupant.energy * invMaxTileEnergy
          : 0;

        if (normalizedEnergy <= 0) {
          normalizedEnergy = 0;
        } else if (normalizedEnergy >= 1) {
          normalizedEnergy = 1;
        }

        scarcityContribution = 1 - normalizedEnergy;
      }

      for (let i = 0; i < NEIGHBOR_OFFSETS.length; i++) {
        const offset = NEIGHBOR_OFFSETS[i];

        if (!offset) continue;

        const nr = r + offset[0];
        const nc = c + offset[1];

        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const comfortRow = comfort[nr];
        const countRow = counts[nr];
        const revisionRow = revisionGrid[nr];
        const scarcityRow = useScarcity ? scarcity[nr] : null;

        if (revisionRow[nc] !== revision) {
          revisionRow[nc] = revision;
          comfortRow[nc] = 0;
          countRow[nc] = 0;

          if (scarcityRow) {
            scarcityRow[nc] = 0;
          }

          touchedRows.push(nr);
          touchedCols.push(nc);
        }

        comfortRow[nc] += tolerance;
        countRow[nc] += 1;

        if (useScarcity && scarcityRow) {
          scarcityRow[nc] += scarcityContribution;
        }
      }

      return true;
    };

    let processedViaActiveSet = false;
    const activeCells = this.activeCells;

    if (activeCells && activeCells.size > 0) {
      let processedCount = 0;

      for (const occupant of activeCells) {
        if (!occupant) continue;

        let r = Number.isInteger(occupant.row) ? occupant.row : null;
        let c = Number.isInteger(occupant.col) ? occupant.col : null;

        if (!Number.isInteger(r) || !Number.isInteger(c)) {
          const tracked = this.cellPositions?.get?.(occupant);

          if (tracked) {
            if (!Number.isInteger(r)) r = tracked.row;
            if (!Number.isInteger(c)) c = tracked.col;
          }
        }

        if (!Number.isInteger(r) || !Number.isInteger(c)) {
          continue;
        }

        if (r < 0 || r >= rows || c < 0 || c >= cols) {
          continue;
        }

        const gridRow = grid[r];

        if (!gridRow || gridRow[c] !== occupant) {
          const tracked = this.cellPositions?.get?.(occupant);

          if (tracked) {
            const { row: trackedRow, col: trackedCol } = tracked;

            if (Number.isInteger(trackedRow) && Number.isInteger(trackedCol)) {
              r = trackedRow;
              c = trackedCol;
            }
          }
        }

        if (r < 0 || r >= rows || c < 0 || c >= cols) {
          continue;
        }

        const finalRow = grid[r];

        if (!finalRow || finalRow[c] !== occupant) {
          continue;
        }

        if (applyCrowdingContribution(occupant, r, c)) {
          processedCount += 1;
        }
      }

      processedViaActiveSet = processedCount > 0;
    }

    if (!processedViaActiveSet) {
      for (let r = 0; r < rows; r++) {
        const gridRow = grid[r];

        if (!gridRow) continue;

        for (let c = 0; c < cols; c++) {
          if (!gridRow[c]) continue;

          applyCrowdingContribution(gridRow[c], r, c);
        }
      }
    }

    const touchedCount = touchedRows.length;

    for (let i = 0; i < touchedCount; i++) {
      const rr = touchedRows[i];
      const cc = touchedCols[i];
      const comfortRow = comfort[rr];
      const countRow = counts[rr];
      const scarcityRow = useScarcity ? scarcity[rr] : null;

      if (!comfortRow || !countRow) continue;

      const neighborCount = countRow[cc] ?? 0;

      if (neighborCount > 0) {
        const invCount = invCountLookup[neighborCount] ?? 1 / neighborCount;
        const normalizedComfort = comfortRow[cc] * invCount;

        comfortRow[cc] =
          normalizedComfort <= 0 ? 0 : normalizedComfort >= 1 ? 1 : normalizedComfort;

        if (scarcityRow) {
          const normalizedScarcity = scarcityRow[cc] * invCount;

          scarcityRow[cc] =
            normalizedScarcity <= 0
              ? 0
              : normalizedScarcity >= 1
                ? 1
                : normalizedScarcity;
        }
      } else {
        comfortRow[cc] = 0.5;

        if (scarcityRow) {
          scarcityRow[cc] = 0;
        }
      }
    }

    this.#crowdingPrepared = true;
    this.#crowdingPreparedUseScarcity = useScarcity;

    return true;
  }

  #ensureOccupantRegenBuffers(rowCount, colCount) {
    const { rows, cols } = normalizeDimensions(rowCount, colCount);

    if (
      !Array.isArray(this.pendingOccupantRegen) ||
      this.pendingOccupantRegen.length !== rows
    ) {
      this.pendingOccupantRegen = Array.from({ length: rows }, () =>
        Array(cols).fill(0),
      );
    } else {
      for (let r = 0; r < rows; r++) {
        const existing = this.pendingOccupantRegen[r];

        if (!existing || existing.length !== cols) {
          this.pendingOccupantRegen[r] = Array(cols).fill(0);
        }
      }
    }

    if (
      !Array.isArray(this.#occupantRegenVersion) ||
      this.#occupantRegenVersion.length !== rows
    ) {
      this.#occupantRegenVersion = Array.from(
        { length: rows },
        () => new Uint32Array(cols),
      );
    } else {
      for (let r = 0; r < rows; r++) {
        const versionRow = this.#occupantRegenVersion[r];

        if (!versionRow || versionRow.length !== cols) {
          this.#occupantRegenVersion[r] = new Uint32Array(cols);
        }
      }
    }

    if (
      !Number.isFinite(this.#occupantRegenRevision) ||
      this.#occupantRegenRevision < 0
    ) {
      this.#occupantRegenRevision = 0;
    }
  }

  #advanceOccupantRegenRevision() {
    let nextRevision = Math.trunc(this.#occupantRegenRevision) + 1;

    if (!Number.isFinite(nextRevision) || nextRevision >= 0xffffffff) {
      nextRevision = 1;
      const versionGrid = this.#occupantRegenVersion;

      if (Array.isArray(versionGrid)) {
        for (let i = 0; i < versionGrid.length; i++) {
          versionGrid[i]?.fill?.(0);
        }
      }
    }

    this.#occupantRegenRevision = nextRevision;

    return nextRevision;
  }

  #ensureDensityPrefix(rowCount, colCount) {
    const { rows, cols } = normalizeDimensions(rowCount, colCount);
    const requiredRows = rows + 1;
    const requiredCols = cols + 1;

    if (
      !this.#densityPrefixScratch ||
      this.#densityPrefixScratch.length !== requiredRows
    ) {
      this.#densityPrefixScratch = Array.from(
        { length: requiredRows },
        () => new Uint32Array(requiredCols),
      );
    } else {
      const scratch = this.#densityPrefixScratch;
      const firstRow = scratch[0];

      if (!firstRow || firstRow.length !== requiredCols) {
        scratch[0] = new Uint32Array(requiredCols);
      } else {
        firstRow.fill(0);
      }

      for (let r = 1; r < requiredRows; r++) {
        const existing = scratch[r];

        if (!existing || existing.length !== requiredCols) {
          scratch[r] = new Uint32Array(requiredCols);
        } else {
          existing[0] = 0;
        }
      }
    }

    return this.#densityPrefixScratch;
  }

  #ensureDensityBounds(rowCount, colCount, radius = 0) {
    const { rows, cols } = normalizeDimensions(rowCount, colCount);
    const normalizedRadius = Math.max(
      0,
      Math.floor(Number.isFinite(radius) ? radius : 0),
    );

    if (!this.#densityRowTopScratch || this.#densityRowTopScratch.length !== rows) {
      this.#densityRowTopScratch = new Uint32Array(rows);
      this.#densityRowBottomScratch = new Uint32Array(rows);
    }

    if (!this.#densityColLeftScratch || this.#densityColLeftScratch.length !== cols) {
      this.#densityColLeftScratch = new Uint32Array(cols);
      this.#densityColRightScratch = new Uint32Array(cols);
    }

    const rowTop = this.#densityRowTopScratch;
    const rowBottom = this.#densityRowBottomScratch;

    for (let r = 0; r < rows; r++) {
      let minRow = r - normalizedRadius;

      if (minRow < 0) minRow = 0;

      let maxRow = r + normalizedRadius + 1;

      if (maxRow > rows) maxRow = rows;

      rowTop[r] = minRow;
      rowBottom[r] = maxRow;
    }

    const colLeft = this.#densityColLeftScratch;
    const colRight = this.#densityColRightScratch;

    for (let c = 0; c < cols; c++) {
      let minCol = c - normalizedRadius;

      if (minCol < 0) minCol = 0;

      let maxCol = c + normalizedRadius + 1;

      if (maxCol > cols) maxCol = cols;

      colLeft[c] = minCol;
      colRight[c] = maxCol;
    }

    return { rowTop, rowBottom, colLeft, colRight };
  }

  #resetDensityIntegral() {
    this.#densityIntegral = null;
    this.#densityIntegralRows = 0;
    this.#densityIntegralCols = 0;
    this.#densityIntegralDirty = true;
    this.#densityTotalsCache.clear();
  }

  #markDensityIntegralDirty() {
    this.#densityIntegralDirty = true;
  }

  #resolveDensityIntegral() {
    const rows = Math.max(0, Math.floor(this.rows));
    const cols = Math.max(0, Math.floor(this.cols));

    if (rows === 0 || cols === 0) {
      this.#resetDensityIntegral();

      return null;
    }

    const requiredRows = rows + 1;
    const requiredCols = cols + 1;
    let integral = this.#densityIntegral;

    if (!integral || integral.length !== requiredRows) {
      integral = Array.from(
        { length: requiredRows },
        () => new Uint32Array(requiredCols),
      );
      this.#densityIntegral = integral;
      this.#densityIntegralDirty = true;
    }

    const firstRow = integral[0];

    if (!firstRow || firstRow.length !== requiredCols) {
      integral[0] = new Uint32Array(requiredCols);
      this.#densityIntegralDirty = true;
    } else {
      firstRow.fill(0);
    }

    if (this.#densityIntegralRows !== rows || this.#densityIntegralCols !== cols) {
      this.#densityIntegralDirty = true;
    }

    if (!this.#densityIntegralDirty) {
      return integral;
    }

    for (let r = 1; r <= rows; r++) {
      let rowArray = integral[r];

      if (!rowArray || rowArray.length !== requiredCols) {
        rowArray = new Uint32Array(requiredCols);
        integral[r] = rowArray;
      } else {
        rowArray[0] = 0;
      }

      const prevRow = integral[r - 1];
      const gridRow = this.grid[r - 1];
      let rowSum = 0;

      for (let c = 1; c <= cols; c++) {
        const occupied = gridRow?.[c - 1] ? 1 : 0;

        rowSum += occupied;
        rowArray[c] = prevRow[c] + rowSum;
      }
    }

    this.#densityIntegralRows = rows;
    this.#densityIntegralCols = cols;
    this.#densityIntegralDirty = false;

    return integral;
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

    const { weights, energized } = this.#ensureSpawnScoringScratch(candidates.length);
    let totalWeight = 0;
    let energizedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const energyRow = candidate ? this.energyGrid?.[candidate.r] : null;
      const energyValue = energyRow ? energyRow[candidate.c] : null;
      const hasEnergy = Number.isFinite(energyValue) && energyValue > 0;

      energized[i] = hasEnergy ? 1 : 0;

      if (hasEnergy) {
        energizedCount += 1;
      }

      const weight = hasEnergy ? this.#scoreSpawnCandidate(candidate, context) : 0;

      weights[i] = weight;
      totalWeight += weight;
    }

    if (!(totalWeight > 0)) {
      if (energizedCount > 0) {
        let pick = Math.floor(this.#random() * energizedCount);

        for (let i = 0; i < candidates.length; i++) {
          if (!energized[i]) continue;

          if (pick === 0) {
            return candidates[i] ?? null;
          }

          pick -= 1;
        }
      }

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

  static #isCellRecord(cell) {
    return cell != null && typeof cell === "object";
  }

  static #updateCellPosition(cell, row, col) {
    if (!this.#isCellRecord(cell)) return;
    if ("row" in cell) cell.row = row;
    if ("col" in cell) cell.col = col;
  }

  static #applyMovementEnergyCost(cell) {
    if (!this.#isCellRecord(cell) || cell.energy == null || !cell.dna) return;

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

  #ensureSpawnScoringScratch(size) {
    const capacity = Math.max(0, Math.floor(size));

    if (capacity === 0) {
      return {
        weights: this.#spawnCandidateWeightsScratch ?? EMPTY_FLOAT64_ARRAY,
        energized: this.#spawnCandidateEnergizedScratch ?? EMPTY_UINT8_ARRAY,
      };
    }

    let weights = this.#spawnCandidateWeightsScratch;
    let energized = this.#spawnCandidateEnergizedScratch;

    if (!weights || weights.length < capacity) {
      const nextCapacity = weights
        ? Math.max(capacity, weights.length * 2)
        : Math.max(8, capacity);

      weights = new Float64Array(nextCapacity);
      energized = new Uint8Array(nextCapacity);
      this.#spawnCandidateWeightsScratch = weights;
      this.#spawnCandidateEnergizedScratch = energized;
    } else if (!energized || energized.length < weights.length) {
      energized = new Uint8Array(weights.length);
      this.#spawnCandidateEnergizedScratch = energized;
    }

    return { weights, energized };
  }

  #enqueueDecay(row, col, cell) {
    if (!GridManager.#isCellRecord(cell)) return;
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    const energy = Number.isFinite(cell.energy) ? cell.energy : 0;

    if (energy <= DECAY_EPSILON) return;

    if (!this.decayAmount || this.decayAmount.length !== this.rows) {
      this.#initializeDecayBuffers(this.rows, this.cols);
    }

    const baseFraction = clamp(DECAY_RETURN_FRACTION, 0, 1);
    let effectiveFraction = baseFraction;

    if (typeof cell?.dna?.decayEnergyReturnFraction === "function") {
      const dnaFraction = cell.dna.decayEnergyReturnFraction(baseFraction);

      if (Number.isFinite(dnaFraction)) {
        effectiveFraction = clamp(dnaFraction, 0, 1);
      } else {
        warnOnce(
          "GridManager received non-finite decay return fraction from DNA; falling back to config.",
        );
      }
    }

    const returned = energy * effectiveFraction;

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
    const persistenceRow = this.decayPersistence?.[row];

    if (!rowStore || !ageRow || !persistenceRow) return;

    const previousReserve = Number.isFinite(rowStore[col]) ? rowStore[col] : 0;
    const updatedReserve = previousReserve + reserve;

    rowStore[col] = updatedReserve;
    ageRow[col] = 0;

    const dnaPersistence = this.#resolveDecayPersistenceTicks(cell, DECAY_MAX_AGE);
    const existingPersistence =
      previousReserve > DECAY_EPSILON &&
      Number.isFinite(persistenceRow[col]) &&
      persistenceRow[col] > 0
        ? persistenceRow[col]
        : DECAY_MAX_AGE;
    const totalReserve = updatedReserve;

    if (totalReserve > DECAY_EPSILON) {
      const weighted =
        (existingPersistence * previousReserve + dnaPersistence * reserve) /
        totalReserve;

      persistenceRow[col] = Math.max(
        1,
        Math.round(clamp(weighted, 1, DECAY_MAX_AGE * 4)),
      );
    } else {
      persistenceRow[col] = dnaPersistence;
    }

    this.decayActive.add(row * this.cols + col);
  }

  #resolveDecayPersistenceTicks(cell, baseAge = DECAY_MAX_AGE) {
    const fallback = Math.max(
      1,
      Math.round(Number.isFinite(baseAge) && baseAge > 0 ? baseAge : DECAY_MAX_AGE),
    );

    const dna = cell?.dna;

    if (!dna || typeof dna.decayPersistenceTicks !== "function") {
      return fallback;
    }

    const ticks = dna.decayPersistenceTicks(fallback);

    if (!Number.isFinite(ticks) || ticks <= 0) {
      warnOnce(
        "GridManager received non-finite decay persistence from DNA; falling back to configuration value.",
      );

      return fallback;
    }

    const normalized = clamp(ticks, 1, fallback * 4);

    return Math.max(1, Math.round(normalized));
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
    this.decayPersistence = Array.from({ length: rowCount }, () =>
      Array(colCount).fill(0),
    );
    if (this.decayActive) {
      this.decayActive.clear();
    } else {
      this.decayActive = new Set();
    }
    if (this.#decayActiveScratch) {
      this.#decayActiveScratch.clear();
    }
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
        const persistRow = this.decayPersistence?.[r];

        if (!rowStore || !ageRow) continue;

        rowStore.fill(0);
        ageRow.fill(0);
        if (persistRow) {
          persistRow.fill(0);
        }
      }

      return;
    }

    const nextActive = this.#acquireDecayActiveBuffer();

    for (const key of this.decayActive) {
      const row = Math.floor(key / this.cols);
      const col = key % this.cols;

      if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
        continue;
      }

      const rowStore = this.decayAmount[row];
      const ageRow = this.decayAge[row];
      const persistenceRow = this.decayPersistence?.[row];

      if (!rowStore || !ageRow) continue;

      let pool = Number.isFinite(rowStore[col]) ? rowStore[col] : 0;

      if (pool <= DECAY_EPSILON) {
        rowStore[col] = 0;
        ageRow[col] = 0;
        if (persistenceRow) {
          persistenceRow[col] = 0;
        }

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

      const maxAgeCandidate =
        persistenceRow &&
        Number.isFinite(persistenceRow[col]) &&
        persistenceRow[col] > 0
          ? persistenceRow[col]
          : DECAY_MAX_AGE;

      if (nextAmount <= DECAY_EPSILON || age >= maxAgeCandidate) {
        rowStore[col] = 0;
        ageRow[col] = 0;
        if (persistenceRow) {
          persistenceRow[col] = 0;
        }

        continue;
      }

      rowStore[col] = nextAmount;
      ageRow[col] = age;
      nextActive.add(key);
    }

    const previousActive = this.decayActive;

    this.decayActive = nextActive;
    this.#recycleDecayActiveBuffer(previousActive);
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
    this.#initializeRenderDirtyTracking(rows, cols);
    this.#initializeOccupancy(this.rows, this.cols);
    this.#resetDensityIntegral();
    this.maxTileEnergy =
      typeof maxTileEnergy === "number" ? maxTileEnergy : GridManager.maxTileEnergy;
    // Consumers can tune how energetic the world starts without touching the
    // core constant by supplying a fraction of the tile cap. The sanitizer keeps
    // the value in the 0..1 range so overrides remain deterministic.
    this.initialTileEnergyFraction = resolveInitialTileEnergyFraction(
      initialTileEnergyFraction,
    );
    this.initialTileEnergy = this.maxTileEnergy * this.initialTileEnergyFraction;
    this.energyGrid = Array.from({ length: rows }, () => {
      const row = new Float64Array(cols);

      row.fill(this.initialTileEnergy);

      return row;
    });
    this.energyNext = Array.from({ length: rows }, () => new Float64Array(cols));
    this.energyDeltaGrid = Array.from({ length: rows }, () => new Float64Array(cols));
    this.#energyDeltaDirtyTiles = null;
    this.#energyDeltaLastSparse = false;
    this.#ensureOccupantRegenBuffers(rows, cols);
    this.#initializeDecayBuffers(rows, cols);
    this.obstacles = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.obstacleRowCounts = new Uint32Array(rows);
    this.#resetObstacleRenderCache();
    this.eventManager = resolvedEventManager;
    this.eventContext = createEventContext(eventContext);
    this.eventEffectCache = new Map();
    this.ctx = resolvedCtx;
    this.cellSize = resolvedCellSize;
    this.stats = resolvedStats;
    this.renderStrategy =
      typeof options?.renderStrategy === "string" ? options.renderStrategy : "auto";
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
    const interactionAdapter = resolveInteractionAdapter(options, this);

    this.interactionAdapter = interactionAdapter;
    this.setInteractionSystem(
      resolveInteractionSystem(options, {
        gridManager: this,
        adapter: interactionAdapter,
      }),
    );
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
    this.populationScarcitySignal = 0;
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

  #initializeOccupancy(rowCount, colCount = this.cols) {
    const rows = normalizeDimension(rowCount);
    const cols = normalizeDimension(colCount);

    this.#rowOccupancy = Array.from({ length: rows }, () => new Set());
    this.#columnOccupancy = Array.from({ length: cols }, () => new Set());
    this.#rowOccupancySorted = Array.from({ length: rows }, () => []);
    this.#columnOccupancySorted = Array.from({ length: cols }, () => []);
  }

  #resetOccupancyTracking() {
    const needsRowReset =
      !Array.isArray(this.#rowOccupancy) || this.#rowOccupancy.length !== this.rows;
    const needsColReset =
      !Array.isArray(this.#columnOccupancy) ||
      this.#columnOccupancy.length !== this.cols;

    if (needsRowReset || needsColReset) {
      this.#initializeOccupancy(this.rows, this.cols);

      return;
    }

    for (let i = 0; i < this.#rowOccupancy.length; i++) {
      const bucket = this.#rowOccupancy[i];

      if (bucket) bucket.clear();
    }

    for (let i = 0; i < this.#columnOccupancy.length; i++) {
      const bucket = this.#columnOccupancy[i];

      if (bucket) bucket.clear();
    }

    if (Array.isArray(this.#rowOccupancySorted)) {
      for (let i = 0; i < this.#rowOccupancySorted.length; i++) {
        const list = this.#rowOccupancySorted[i];

        if (list) list.length = 0;
      }
    }

    if (Array.isArray(this.#columnOccupancySorted)) {
      for (let i = 0; i < this.#columnOccupancySorted.length; i++) {
        const list = this.#columnOccupancySorted[i];

        if (list) list.length = 0;
      }
    }
  }

  #recordOccupancy(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return;

    const needsRowReset =
      !Array.isArray(this.#rowOccupancy) || this.#rowOccupancy.length !== this.rows;
    const needsColReset =
      !Array.isArray(this.#columnOccupancy) ||
      this.#columnOccupancy.length !== this.cols;

    if (needsRowReset || needsColReset) {
      this.#initializeOccupancy(this.rows, this.cols);
    }

    let bucket = this.#rowOccupancy[row];

    if (!bucket) {
      bucket = new Set();
      this.#rowOccupancy[row] = bucket;
    }

    if (!bucket.has(col)) {
      bucket.add(col);
      this.#ensureRowOccupancyCache(row);
      const list = this.#rowOccupancySorted?.[row];

      if (Array.isArray(list)) {
        this.#insertIntoSortedList(list, col);
      }
    }

    let columnBucket = this.#columnOccupancy[col];

    if (!columnBucket) {
      columnBucket = new Set();
      this.#columnOccupancy[col] = columnBucket;
    }

    if (!columnBucket.has(row)) {
      columnBucket.add(row);
      this.#ensureColumnOccupancyCache(col);
      const list = this.#columnOccupancySorted?.[col];

      if (Array.isArray(list)) {
        this.#insertIntoSortedList(list, row);
      }
    }
  }

  #releaseOccupancy(row, col) {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return;

    const rowBucket = this.#rowOccupancy?.[row];
    const columnBucket = this.#columnOccupancy?.[col];

    if (rowBucket?.delete?.(col)) {
      const list = this.#rowOccupancySorted?.[row];

      if (Array.isArray(list)) {
        this.#removeFromSortedList(list, col);
      }
    }

    if (columnBucket?.delete?.(row)) {
      const list = this.#columnOccupancySorted?.[col];

      if (Array.isArray(list)) {
        this.#removeFromSortedList(list, row);
      }
    }
  }

  #shiftOccupancy(fromRow, fromCol, toRow, toCol) {
    this.#releaseOccupancy(fromRow, fromCol);
    this.#recordOccupancy(toRow, toCol);
  }

  #ensureRowOccupancyCache(row) {
    const buckets = this.#rowOccupancy;
    const targetLength = Array.isArray(buckets)
      ? buckets.length
      : Math.max(this.rows, row + 1);

    if (
      !Array.isArray(this.#rowOccupancySorted) ||
      this.#rowOccupancySorted.length !== targetLength
    ) {
      this.#rowOccupancySorted = Array.from({ length: targetLength }, () => []);
    }

    if (!this.#rowOccupancySorted[row]) {
      this.#rowOccupancySorted[row] = [];
    }
  }

  #ensureColumnOccupancyCache(col) {
    const buckets = this.#columnOccupancy;
    const targetLength = Array.isArray(buckets)
      ? buckets.length
      : Math.max(this.cols, col + 1);

    if (
      !Array.isArray(this.#columnOccupancySorted) ||
      this.#columnOccupancySorted.length !== targetLength
    ) {
      this.#columnOccupancySorted = Array.from({ length: targetLength }, () => []);
    }

    if (!this.#columnOccupancySorted[col]) {
      this.#columnOccupancySorted[col] = [];
    }
  }

  #insertIntoSortedList(list, value) {
    if (!Array.isArray(list)) {
      return;
    }

    const index = lowerBound(list, value);

    if (index < list.length && list[index] === value) {
      return;
    }

    list.splice(index, 0, value);
  }

  #removeFromSortedList(list, value) {
    if (!Array.isArray(list) || list.length === 0) {
      return;
    }

    const index = lowerBound(list, value);

    if (index < list.length && list[index] === value) {
      list.splice(index, 1);
    }
  }

  #getRowOccupantColumns(row, bucket, { refresh = false } = {}) {
    this.#ensureRowOccupancyCache(row);
    let list = this.#rowOccupancySorted[row];

    if (!Array.isArray(list)) {
      list = [];
      this.#rowOccupancySorted[row] = list;
    }

    if (refresh) {
      const refreshed = bucket
        ? Array.from(bucket)
            .filter((value) => Number.isInteger(value))
            .sort((a, b) => a - b)
        : [];

      this.#rowOccupancySorted[row] = refreshed;

      return refreshed;
    }

    if (list.length === 0 && bucket && bucket.size > 0) {
      for (const value of bucket) {
        if (Number.isInteger(value)) {
          this.#insertIntoSortedList(list, value);
        }
      }
    }

    return list;
  }

  #getColumnOccupantRows(col, bucket, { refresh = false } = {}) {
    this.#ensureColumnOccupancyCache(col);
    let list = this.#columnOccupancySorted[col];

    if (!Array.isArray(list)) {
      list = [];
      this.#columnOccupancySorted[col] = list;
    }

    if (refresh) {
      const refreshed = bucket
        ? Array.from(bucket)
            .filter((value) => Number.isInteger(value))
            .sort((a, b) => a - b)
        : [];

      this.#columnOccupancySorted[col] = refreshed;

      return refreshed;
    }

    if (list.length === 0 && bucket && bucket.size > 0) {
      for (const value of bucket) {
        if (Number.isInteger(value)) {
          this.#insertIntoSortedList(list, value);
        }
      }
    }

    return list;
  }

  #trackCellPosition(cell, row, col) {
    if (
      !GridManager.#isCellRecord(cell) ||
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
    const rows = this.rows;
    const cols = this.cols;
    const occupancyRows = this.#rowOccupancy;

    if (Array.isArray(occupancyRows) && occupancyRows.length === rows) {
      for (let r = 0; r < rows; r++) {
        const bucket = occupancyRows[r];

        if (!bucket || bucket.size === 0) continue;

        const gridRow = this.grid[r];

        if (!gridRow) continue;

        for (const c of bucket) {
          if (c < 0 || c >= cols) {
            bucket.delete(c);

            continue;
          }

          if (gridRow[c] === cell) {
            return { row: r, col: c };
          }

          if (!gridRow[c]) {
            bucket.delete(c);
          }
        }
      }
    }

    for (let r = 0; r < rows; r++) {
      const gridRow = this.grid[r];

      if (!gridRow) continue;

      const colIndex = gridRow.indexOf(cell);

      if (colIndex !== -1) {
        return { row: r, col: colIndex };
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
      if (Object.hasOwn(presetOptionsInput, presetId)) {
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

  setInitialTileEnergyFraction(fraction, options = {}) {
    const { refreshEmptyTiles = true, forceRefresh = false } =
      options && typeof options === "object" ? options : {};
    const sanitized = resolveInitialTileEnergyFraction(fraction);
    const previous = Number.isFinite(this.initialTileEnergyFraction)
      ? this.initialTileEnergyFraction
      : INITIAL_TILE_ENERGY_FRACTION_DEFAULT;
    const changed = Math.abs(previous - sanitized) > 1e-6;

    if (!changed && !forceRefresh) {
      return previous;
    }

    this.initialTileEnergyFraction = sanitized;
    this.initialTileEnergy = this.maxTileEnergy * this.initialTileEnergyFraction;

    if (!refreshEmptyTiles) {
      return this.initialTileEnergyFraction;
    }

    const baseEnergy = this.initialTileEnergy;

    if (!Array.isArray(this.energyGrid) || !Array.isArray(this.grid)) {
      return this.initialTileEnergyFraction;
    }

    if (!this.energyDirtyTiles) {
      this.energyDirtyTiles = new Set();
    }

    for (let row = 0; row < this.rows; row++) {
      const energyRow = this.energyGrid[row];
      const nextRow = this.energyNext?.[row];
      const deltaRow = this.energyDeltaGrid?.[row];
      const occupancyRow = this.grid[row];
      const regenRow = this.pendingOccupantRegen?.[row];

      if (!energyRow || !occupancyRow) continue;

      for (let col = 0; col < this.cols; col++) {
        if (occupancyRow[col]) continue;

        const before = Number.isFinite(energyRow[col]) ? energyRow[col] : 0;

        if (before === baseEnergy) {
          if (forceRefresh) {
            this.markEnergyDirty(row, col, { radius: 1 });
          }
          if (nextRow) nextRow[col] = 0;
          if (deltaRow) deltaRow[col] = 0;
          if (regenRow) regenRow[col] = 0;

          continue;
        }

        energyRow[col] = baseEnergy;
        if (nextRow) nextRow[col] = 0;
        if (deltaRow) deltaRow[col] = 0;
        if (regenRow) regenRow[col] = 0;
        this.markEnergyDirty(row, col, { radius: 1 });
      }
    }

    return this.initialTileEnergyFraction;
  }

  setInteractionSystem(interactionSystem) {
    this.interactionSystem = normalizeInteractionSystem(interactionSystem);
  }

  setMatingDiversityOptions({ threshold, lowDiversityMultiplier } = {}) {
    if (threshold !== undefined) {
      const clamped = sanitizeUnitInterval(threshold);

      if (clamped !== null) {
        this.matingDiversityThreshold = clamped;
      }
    } else if (typeof this.stats?.matingDiversityThreshold === "number") {
      this.matingDiversityThreshold = clamp(this.stats.matingDiversityThreshold, 0, 1);
    }

    if (lowDiversityMultiplier !== undefined) {
      const clamped = sanitizeUnitInterval(lowDiversityMultiplier);

      if (clamped !== null) {
        this.lowDiversityReproMultiplier = clamped;
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

    if (this.obstacleRowCounts) {
      this.obstacleRowCounts.fill(0);
    }

    this.currentObstaclePreset = "none";
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const wasBlocked = this.obstacles[row][col];

    if (!blocked) {
      if (wasBlocked) {
        this.obstacles[row][col] = false;
        if (this.obstacleRowCounts) {
          const counts = this.obstacleRowCounts;

          if (counts[row] > 0) counts[row] -= 1;
        }
        this.#markObstacleRenderDirty();
      } else {
        this.obstacles[row][col] = false;
      }

      return true;
    }

    this.obstacles[row][col] = true;

    if (!wasBlocked) {
      if (this.obstacleRowCounts) {
        this.obstacleRowCounts[row] += 1;
      }
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
    let normalizedId = "";

    if (typeof presetId === "string") {
      normalizedId = presetId.trim();
    } else if (
      presetId &&
      typeof presetId === "object" &&
      typeof presetId.id === "string"
    ) {
      normalizedId = presetId.id.trim();
    }
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
    this.#initializeRenderDirtyTracking(rowsInt, colsInt);
    this.#initializeOccupancy(this.rows, this.cols);
    this.#resetDensityIntegral();
    this.energyGrid = Array.from({ length: rowsInt }, () => {
      const row = new Float64Array(colsInt);

      row.fill(baseEnergy);

      return row;
    });
    this.energyNext = Array.from({ length: rowsInt }, () => new Float64Array(colsInt));
    this.energyDeltaGrid = Array.from(
      { length: rowsInt },
      () => new Float64Array(colsInt),
    );
    if (this.#energyDeltaDirtyTiles) {
      this.#energyDeltaDirtyTiles.clear();
      this.#energyDeltaDirtyTiles = null;
    }
    this.#energyDeltaLastSparse = false;
    this.#ensureOccupantRegenBuffers(rowsInt, colsInt);
    this.#initializeDecayBuffers(rowsInt, colsInt);
    this.obstacles = Array.from({ length: rowsInt }, () => Array(colsInt).fill(false));
    this.obstacleRowCounts = new Uint32Array(rowsInt);
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
    this.#segmentedEventContributionCache = null;
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
        this.#markDensityIntegralDirty();
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
    this.populationScarcitySignal = this.#computePopulationScarcitySignal();

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
    this.#resetDensityIntegral();

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
        if (this.#occupantRegenVersion?.[row]) {
          this.#occupantRegenVersion[row][col] = 0;
        }
      }
    }
    if (this.obstacleRowCounts) {
      this.obstacleRowCounts.fill(0);
    }

    this.activeCells.clear();
    this.#clearTrackedPositions();
    this.tickCount = 0;
    this.cellPositionTelemetry = { mismatches: 0, lastTick: 0 };
    this.lastSnapshot = null;
    this.densityDirtyTiles?.clear?.();
    this.eventEffectCache?.clear?.();
    this.#segmentedEventContributionCache = null;
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

    const resolvedPresetOptions = this.#resolvePresetOptions(
      targetPreset,
      presetOptions,
    );
    const presetArgs = {
      clearExisting: true,
      presetOptions: resolvedPresetOptions,
      evict: true,
    };

    this.applyObstaclePreset(targetPreset, presetArgs);

    if (reseed === true) {
      this.init();
    }

    this.recalculateDensityCounts();
    this.rebuildActiveCells();
    this.populationScarcitySignal = this.#computePopulationScarcitySignal();
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
    const baselineSpawnBuffer = clamp(0.05 + scarcitySignal * 0.05, 0.05, 0.12);
    const maxSpawnAttempts = 6;
    const empties = [];
    const viable = [];

    const removeFromEmpties = (entry) => {
      const index = entry?.emptyIndex;

      if (index == null || index < 0 || index >= empties.length) {
        entry.emptyIndex = -1;

        return;
      }

      const lastIndex = empties.length - 1;

      if (index !== lastIndex) {
        const lastEntry = empties[lastIndex];

        empties[index] = lastEntry;
        lastEntry.emptyIndex = index;
      }

      empties.pop();
      entry.emptyIndex = -1;
    };

    const removeFromViable = (entry) => {
      const index = entry?.viableIndex;

      if (index == null || index < 0 || index >= viable.length) {
        entry.viableIndex = -1;

        return;
      }

      viable.splice(index, 1);
      entry.viableIndex = -1;

      for (let i = index; i < viable.length; i += 1) {
        viable[i].viableIndex = i;
      }
    };

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
          emptyIndex: empties.length,
          viableIndex: -1,
        };

        empties.push(entry);

        if (normalizedEnergy >= energyFloorFrac) {
          entry.viableIndex = viable.length;
          viable.push(entry);
        }
      }
    }

    if (empties.length === 0) return;

    viable.sort((a, b) => b.score - a.score);

    for (let i = 0; i < viable.length; i += 1) {
      viable[i].viableIndex = i;
    }

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
      const candidate = pool[pickIndex];

      if (pool === viable) {
        removeFromViable(candidate);
        removeFromEmpties(candidate);
      } else {
        removeFromEmpties(candidate);

        if (candidate.viableIndex >= 0) {
          removeFromViable(candidate);
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
        let spawnBufferFrac = baselineSpawnBuffer;

        if (typeof dna.spawnEnergyBufferFrac === "function") {
          const context = { scarcity: scarcitySignal };
          const bufferCandidate = dna.spawnEnergyBufferFrac(context);

          if (Number.isFinite(bufferCandidate)) {
            spawnBufferFrac = clamp(bufferCandidate, 0.02, 0.2);
          }
        }
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
    const demand =
      typeof cell.resolveHarvestDemand === "function"
        ? cell.resolveHarvestDemand({
            baseRate: base,
            crowdPenalty,
            availableEnergy: available,
            maxTileEnergy: this.maxTileEnergy,
            minCap,
            maxCap,
            localDensity: density,
            densityEffectMultiplier,
            tileEnergy: normalizedTileEnergy,
            tileEnergyDelta,
          })
        : base * crowdPenalty;
    const cap = clamp(demand, minCap, maxCap);
    const take = Math.min(cap, available);
    const energyBefore = cell.energy;
    const energyAfter = Math.min(this.maxTileEnergy, energyBefore + take);
    const normalizedTileEnergyAfter =
      this.maxTileEnergy > 0 ? clamp((available - take) / this.maxTileEnergy, 0, 1) : 0;

    if (typeof cell.recordForageOutcome === "function") {
      cell.recordForageOutcome({
        energyAfter,
        intake: take,
        expectedDemand: demand,
        availableEnergyBefore: available,
        crowdPenalty,
        density: effDensity,
        tileEnergyBefore: normalizedTileEnergy,
        tileEnergyAfter: normalizedTileEnergyAfter,
        tileEnergyDelta: normalizedTileEnergyAfter - normalizedTileEnergy,
        maxTileEnergy: this.maxTileEnergy,
      });
    }

    this.energyGrid[row][col] -= take;
    cell.energy = energyAfter;
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
    const resolvedDensityGrid = hasDensityGrid ? densityGrid : this.densityGrid;
    const resolvedDensityLiveGrid = hasDensityGrid ? null : this.densityLiveGrid;
    let occupantRegenGrid = this.pendingOccupantRegen;
    let occupantRegenVersion = this.#occupantRegenVersion;

    const regenGridValid =
      Array.isArray(occupantRegenGrid) &&
      occupantRegenGrid.length === rows &&
      (rows === 0 ||
        (isArrayLike(occupantRegenGrid[0]) && occupantRegenGrid[0].length === cols));
    const regenVersionValid =
      Array.isArray(occupantRegenVersion) &&
      occupantRegenVersion.length === rows &&
      (rows === 0 ||
        (isArrayLike(occupantRegenVersion[0]) &&
          occupantRegenVersion[0].length === cols));

    if (!regenGridValid || !regenVersionValid) {
      this.#ensureOccupantRegenBuffers(rows, cols);
      occupantRegenGrid = this.pendingOccupantRegen;
      occupantRegenVersion = this.#occupantRegenVersion;
    }

    const energyGrid = this.energyGrid;
    const next = this.energyNext;
    const deltaGrid = this.energyDeltaGrid;
    const obstacles = this.obstacles;
    const occupantRevision = this.#advanceOccupantRegenRevision();
    const { isEventAffecting, getEventEffect } =
      this.eventContext ?? defaultEventContext;
    const regenRate = Number.isFinite(R) ? R : 0;
    const diffusionRate = Number.isFinite(D) ? D : 0;
    const useDiffusion = diffusionRate !== 0;
    const diffusionRateQuarter = useDiffusion ? diffusionRate * 0.25 : 0;
    const diffusionInvLookup = DIFFUSION_INV_NEIGHBOR_COUNT;
    const maxTileEnergy = this.maxTileEnergy;
    const invMaxTileEnergy = maxTileEnergy > 0 ? 1 / maxTileEnergy : 1;
    const positiveMaxTileEnergy = maxTileEnergy > 0 ? maxTileEnergy : 0;
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
    const baseEventModifiers = { regenMultiplier: 1, regenAdd: 0, drain: 0 };
    let segmentedEventContributions = false;
    let segmentedEventCleanup = null;
    const segmentedModifiersScratch = { regenMultiplier: 1, regenAdd: 0, drain: 0 };

    if (hasEvents && usingSegmentedEvents && eventOptions) {
      // When events can be segmented, precompute the contribution of each
      // individual event once. Later tile evaluations simply multiply these
      // cached values instead of rebuilding the modifier set for every tile,
      // eliminating a major O(n_events * n_tiles) hotspot in dense areas.
      segmentedEventCleanup = this.#getSegmentedEventContributionCleanup();
      let cachingSucceeded = true;

      for (let i = 0; i < evs.length; i++) {
        const ev = evs[i];

        if (!ev) continue;

        const contribution = this.#resolveSegmentedEventContribution(ev, {
          strengthMultiplier: normalizedEventStrengthMultiplier,
          getEventEffect,
          effectCache,
        });

        if (!contribution) {
          continue;
        }

        if (!Object.isExtensible(ev)) {
          cachingSucceeded = false;

          break;
        }

        ev[SEGMENTED_EVENT_CONTRIBUTION_KEY] = contribution;
        segmentedEventCleanup.push(ev);
      }

      if (cachingSucceeded) {
        segmentedEventContributions = true;
      } else {
        for (let i = 0; i < segmentedEventCleanup.length; i++) {
          const event = segmentedEventCleanup[i];

          if (event && Object.hasOwn(event, SEGMENTED_EVENT_CONTRIBUTION_KEY)) {
            delete event[SEGMENTED_EVENT_CONTRIBUTION_KEY];
          }

          segmentedEventCleanup[i] = null;
        }

        segmentedEventCleanup.length = 0;
        segmentedEventCleanup = null;
      }
    }
    this.#prepareCrowdingFeedback(rows, cols, positiveMaxTileEnergy);
    const crowdingPrepared = Boolean(this.#crowdingPrepared);
    const crowdingRevision = crowdingPrepared ? this.#crowdingRevision : 0;
    const crowdingUseScarcity =
      crowdingPrepared && Boolean(this.#crowdingPreparedUseScarcity);
    const crowdingComfortGrid = crowdingPrepared ? this.#crowdingComfortGrid : null;
    const crowdingCountGrid = crowdingPrepared ? this.#crowdingCountGrid : null;
    const crowdingScarcityGrid =
      crowdingUseScarcity && this.#crowdingScarcityGrid
        ? this.#crowdingScarcityGrid
        : null;
    const crowdingRevisionGrid = crowdingPrepared ? this.#crowdingRevisionGrid : null;
    const crowdingScratch = this.#crowdingFeedbackScratch;
    let crowdComfortRow = null;
    let crowdCountRow = null;
    let crowdScarcityRow = null;
    let crowdRevisionRow = null;

    let computeGeneralEventModifiers = null;

    if (hasEvents && !segmentedEventContributions && eventOptions) {
      const lastEventsCache = [];
      const reusableModifiers = { regenMultiplier: 1, regenAdd: 0, drain: 0 };

      computeGeneralEventModifiers = (eventsForTile, row, col) => {
        if (!eventsForTile || eventsForTile.length === 0) {
          lastEventsCache.length = 0;

          return baseEventModifiers;
        }

        let reuse = lastEventsCache.length === eventsForTile.length;

        if (reuse) {
          for (let i = 0; i < eventsForTile.length; i++) {
            if (lastEventsCache[i] !== eventsForTile[i]) {
              reuse = false;

              break;
            }
          }
        }

        if (!reuse) {
          const previousRow = eventOptions.row;
          const previousCol = eventOptions.col;
          const previousEvents = eventOptions.events;

          eventOptions.row = row;
          eventOptions.col = col;
          eventOptions.events = eventsForTile;

          const modifiers = accumulateEventModifiers(eventOptions);

          eventOptions.row = previousRow;
          eventOptions.col = previousCol;
          eventOptions.events = previousEvents;

          reusableModifiers.regenMultiplier = modifiers?.regenMultiplier ?? 1;
          reusableModifiers.regenAdd = modifiers?.regenAdd ?? 0;
          reusableModifiers.drain = modifiers?.drainAdd ?? 0;

          lastEventsCache.length = eventsForTile.length;

          for (let i = 0; i < eventsForTile.length; i++) {
            lastEventsCache[i] = eventsForTile[i];
          }
        }

        return reusableModifiers;
      };
    }
    const resolveModifiersForTile = (eventsForTile, row, col) => {
      if (!eventsForTile || eventsForTile.length === 0) {
        return baseEventModifiers;
      }

      if (segmentedEventContributions) {
        // Aggregating cached segments keeps the modifier resolution path
        // simple while still respecting multiplicative regen effects.
        let regenMultiplier = 1;
        let regenAdd = 0;
        let drain = 0;

        for (let i = 0; i < eventsForTile.length; i++) {
          const event = eventsForTile[i];
          const contribution =
            event && event[SEGMENTED_EVENT_CONTRIBUTION_KEY] != null
              ? event[SEGMENTED_EVENT_CONTRIBUTION_KEY]
              : null;

          if (!contribution) continue;

          regenMultiplier *= contribution.regenMultiplier;
          regenAdd += contribution.regenAdd;
          drain += contribution.drain;
        }

        segmentedModifiersScratch.regenMultiplier = regenMultiplier;
        segmentedModifiersScratch.regenAdd = regenAdd;
        segmentedModifiersScratch.drain = drain;

        return segmentedModifiersScratch;
      }

      if (computeGeneralEventModifiers) {
        return computeGeneralEventModifiers(eventsForTile, row, col);
      }

      return baseEventModifiers;
    };
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
    const obstacleRowCounts = this.obstacleRowCounts;

    let trackSparseDelta = false;
    let deltaDirtyTiles = null;

    const grid = this.grid;
    const getDensityValue = (rowIndex, colIndex, directRow) => {
      if (directRow) {
        const directValue = directRow[colIndex];

        if (directValue != null) {
          return directValue;
        }
      }

      if (resolvedDensityGrid) {
        const fallbackRow = resolvedDensityGrid[rowIndex];

        if (fallbackRow) {
          const fallbackValue = fallbackRow[colIndex];

          if (fallbackValue != null) {
            return fallbackValue;
          }
        }
      }

      if (resolvedDensityLiveGrid) {
        const liveRow = resolvedDensityLiveGrid[rowIndex];

        if (liveRow) {
          const liveValue = liveRow[colIndex];

          if (liveValue != null) {
            return liveValue;
          }
        }
      }

      return this.#resolveCachedDensityValue(
        rowIndex,
        colIndex,
        null,
        resolvedDensityGrid,
      );
    };

    const processTileBase = (
      r,
      c,
      energyRow,
      nextRow,
      deltaRow,
      hasDeltaRow,
      densityRow,
      obstacleRow,
      gridRow,
      upEnergyRow,
      upObstacleRow,
      downEnergyRow,
      downObstacleRow,
      occupantRegenRow,
      occupantRegenVersionRow,
      regenMultiplier = 1,
      regenAdd = 0,
      drain = 0,
    ) => {
      const currentEnergy = energyRow[c];
      let regen = 0;

      if (positiveMaxTileEnergy > 0) {
        const deficit = positiveMaxTileEnergy - currentEnergy;

        if (deficit > 0) {
          let regenPenalty = 1;

          if (normalizedDensityMultiplier !== 0) {
            const densityValue = getDensityValue(r, c, densityRow);

            if (densityValue != null) {
              let effectiveDensity = densityValue * normalizedDensityMultiplier;

              if (effectiveDensity <= 0) {
                effectiveDensity = 0;
              } else if (effectiveDensity >= 1) {
                effectiveDensity = 1;
              }

              if (effectiveDensity > 0) {
                let densityImpact = REGEN_DENSITY_PENALTY * effectiveDensity;

                if (densityImpact > 0) {
                  let crowdCount = 0;
                  let crowdComfort = 0.5;
                  let scarcitySignal = 0;

                  if (crowdingPrepared) {
                    if (
                      crowdRevisionRow &&
                      crowdRevisionRow[c] === crowdingRevision &&
                      crowdCountRow &&
                      crowdComfortRow
                    ) {
                      const neighborCount = crowdCountRow[c] ?? 0;

                      if (neighborCount > 0) {
                        crowdCount = neighborCount;
                        crowdComfort = crowdComfortRow[c];

                        if (crowdingUseScarcity && crowdScarcityRow) {
                          scarcitySignal = crowdScarcityRow[c];
                        }
                      }
                    }
                  } else {
                    const fallbackCrowding =
                      computeCrowdingFeedback({
                        grid,
                        row: r,
                        col: c,
                        rows,
                        cols,
                        neighborOffsets: NEIGHBOR_OFFSETS,
                        maxTileEnergy: positiveMaxTileEnergy,
                        result: crowdingScratch,
                      }) ?? DEFAULT_CROWDING_SUMMARY;

                    crowdCount = fallbackCrowding.count ?? 0;
                    crowdComfort =
                      fallbackCrowding.comfort ?? DEFAULT_CROWDING_SUMMARY.comfort;
                    scarcitySignal =
                      fallbackCrowding.scarcity ?? DEFAULT_CROWDING_SUMMARY.scarcity;
                  }

                  if (crowdCount > 0) {
                    const comfort = crowdComfort;
                    const pressure =
                      effectiveDensity > comfort ? effectiveDensity - comfort : 0;
                    const relief =
                      comfort > effectiveDensity ? comfort - effectiveDensity : 0;
                    let scarcityWeight = scarcitySignal;

                    if (scarcityWeight <= 0) {
                      scarcityWeight = 0;
                    } else if (scarcityWeight >= 1) {
                      scarcityWeight = 1;
                    }

                    let sensitivity =
                      1 +
                      pressure * (0.6 + scarcityWeight * 0.55) -
                      relief * (0.35 + (1 - scarcityWeight) * 0.15);

                    if (sensitivity <= 0.35) {
                      sensitivity = 0.35;
                    } else if (sensitivity >= 1.8) {
                      sensitivity = 1.8;
                    }

                    densityImpact *= sensitivity;
                  }
                }

                if (densityImpact <= 0) {
                  densityImpact = 0;
                } else if (densityImpact >= 1.1) {
                  densityImpact = 1.1;
                }

                regenPenalty -= densityImpact;
              }
            }
          }

          if (regenPenalty > 0) {
            regen = regenRate * deficit * regenPenalty;
          }
        }
      }

      let diffusion = 0;

      if (!obstacleRow && !upObstacleRow && !downObstacleRow) {
        if (useDiffusion) {
          if (c > 0 && c < cols - 1 && upEnergyRow && downEnergyRow) {
            const neighborSum =
              upEnergyRow[c] + downEnergyRow[c] + energyRow[c - 1] + energyRow[c + 1];

            diffusion = diffusionRateQuarter * (neighborSum - currentEnergy * 4);
          } else {
            let neighborSum = 0;
            let neighborCount = 0;

            if (upEnergyRow) {
              neighborSum += upEnergyRow[c];
              neighborCount += 1;
            }

            if (downEnergyRow) {
              neighborSum += downEnergyRow[c];
              neighborCount += 1;
            }

            if (c > 0) {
              neighborSum += energyRow[c - 1];
              neighborCount += 1;
            }

            if (c < cols - 1) {
              neighborSum += energyRow[c + 1];
              neighborCount += 1;
            }

            if (neighborCount > 0) {
              const invCount = diffusionInvLookup[neighborCount] ?? 1 / neighborCount;
              const neighborAverage = neighborSum * invCount;

              diffusion = diffusionRate * (neighborAverage - currentEnergy);
            }
          }
        }
      } else {
        const isObstacle = obstacleRow && obstacleRow[c];

        if (isObstacle) {
          nextRow[c] = 0;
          energyRow[c] = 0;
          if (hasDeltaRow) {
            deltaRow[c] = 0;

            if (trackSparseDelta && deltaDirtyTiles) {
              deltaDirtyTiles.add(r * cols + c);
            }
          }

          return;
        }

        if (useDiffusion) {
          let neighborSum = 0;
          let neighborCount = 0;

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

          if (neighborCount > 0) {
            diffusion = diffusionRate * (neighborSum / neighborCount - currentEnergy);
          }
        }
      }

      if (regenMultiplier !== 1) {
        regen *= regenMultiplier;
      }

      if (regenAdd !== 0) {
        regen += regenAdd;
      }

      let nextEnergy = currentEnergy + regen + diffusion;

      if (drain !== 0) {
        nextEnergy -= drain;
      }

      if (nextEnergy <= 0) {
        nextEnergy = 0;
      } else if (positiveMaxTileEnergy > 0 && nextEnergy >= positiveMaxTileEnergy) {
        nextEnergy = positiveMaxTileEnergy;
      }

      const occupant = gridRow ? gridRow[c] : null;

      if (occupant) {
        if (occupantRegenRow) occupantRegenRow[c] = nextEnergy;
        if (occupantRegenVersionRow) occupantRegenVersionRow[c] = occupantRevision;

        nextRow[c] = 0;
        energyRow[c] = 0;
        if (hasDeltaRow) {
          deltaRow[c] = 0;

          if (trackSparseDelta && deltaDirtyTiles) {
            deltaDirtyTiles.add(r * cols + c);
          }
        }

        return;
      }

      nextRow[c] = nextEnergy;
      energyRow[c] = nextEnergy;

      if (hasDeltaRow) {
        let normalizedDelta = (nextEnergy - currentEnergy) * invMaxTileEnergy;

        if (normalizedDelta < -1) {
          normalizedDelta = -1;
        } else if (normalizedDelta > 1) {
          normalizedDelta = 1;
        }

        deltaRow[c] = normalizedDelta;

        if (trackSparseDelta && deltaDirtyTiles) {
          deltaDirtyTiles.add(r * cols + c);
        }
      }
    };

    trackSparseDelta = Boolean(deltaGrid) && preferSparse;

    if (trackSparseDelta) {
      deltaDirtyTiles =
        this.#energyDeltaDirtyTiles ?? (this.#energyDeltaDirtyTiles = new Set());

      if (!this.#energyDeltaLastSparse) {
        for (let r = 0; r < rows; r++) {
          const deltaRow = deltaGrid[r];

          if (deltaRow) deltaRow.fill(0);
        }
      } else if (deltaDirtyTiles.size > 0) {
        for (const key of deltaDirtyTiles) {
          if (!Number.isFinite(key)) continue;

          const row = Math.floor(key / cols);
          const col = key % cols;
          const deltaRow = deltaGrid[row];

          if (deltaRow && col >= 0 && col < deltaRow.length) {
            deltaRow[col] = 0;
          }
        }
      }

      deltaDirtyTiles.clear();
      this.#energyDeltaLastSparse = true;
    } else {
      deltaDirtyTiles = null;

      if (this.#energyDeltaDirtyTiles) {
        this.#energyDeltaDirtyTiles.clear();
      }

      this.#energyDeltaLastSparse = false;
    }

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

        for (let i = 0; i < sparseRows.length; i++) {
          const r = sparseRows[i];
          const columns = sparseColumns[r];

          if (!columns || columns.length === 0) continue;

          const energyRow = energyGrid[r];
          const nextRow = next[r];

          if (!energyRow || !nextRow) continue;

          const deltaRow = deltaGrid ? deltaGrid[r] : null;
          const hasDeltaRow = Boolean(deltaRow);
          const densityRow = resolvedDensityGrid ? resolvedDensityGrid[r] : null;
          const rowObstacleCount = obstacleRowCounts ? obstacleRowCounts[r] : 0;
          const obstacleRow = rowObstacleCount > 0 ? obstacles[r] : null;
          const gridRow = this.grid[r];
          const upEnergyRow = r > 0 ? energyGrid[r - 1] : null;
          const upObstacleRow =
            r > 0 && obstacleRowCounts && obstacleRowCounts[r - 1] > 0
              ? obstacles[r - 1]
              : null;
          const downEnergyRow = r < rows - 1 ? energyGrid[r + 1] : null;
          const downObstacleRow =
            r < rows - 1 && obstacleRowCounts && obstacleRowCounts[r + 1] > 0
              ? obstacles[r + 1]
              : null;
          const occupantRegenRow = occupantRegenGrid ? occupantRegenGrid[r] : null;
          const occupantRegenVersionRow = occupantRegenVersion
            ? occupantRegenVersion[r]
            : null;

          crowdComfortRow = crowdingComfortGrid ? crowdingComfortGrid[r] : null;
          crowdCountRow = crowdingCountGrid ? crowdingCountGrid[r] : null;
          crowdScarcityRow = crowdingScarcityGrid ? crowdingScarcityGrid[r] : null;
          crowdRevisionRow = crowdingRevisionGrid ? crowdingRevisionGrid[r] : null;

          const columnCount = columns.length;

          const rowEvents = hasEvents
            ? eventsByRow
              ? (eventsByRow[r] ?? EMPTY_EVENT_LIST)
              : evs
            : EMPTY_EVENT_LIST;
          const rowHasEvents = hasEvents && rowEvents.length > 0;
          const useSegmentedForRow = rowHasEvents && usingSegmentedEvents;

          if (useSegmentedForRow && columnCount > 1) {
            columns.sort((a, b) => a - b);
          }

          const segments = useSegmentedForRow ? rowEvents : null;
          const activeSegments =
            useSegmentedForRow && segments ? this.#getSegmentWindowScratch() : null;
          const canUseSegmentContribs =
            segmentedEventContributions &&
            useSegmentedForRow &&
            segments &&
            activeSegments;
          const columnEventsScratch =
            useSegmentedForRow && !canUseSegmentContribs && segments
              ? this.#getColumnEventScratch()
              : null;
          let nextSegmentIndex = 0;
          const collectEventsForColumn =
            columnEventsScratch && activeSegments
              ? (column, isObstacle) => {
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

                      if (!isObstacle) {
                        columnEventsScratch.push(segment.event);
                      }
                    }
                  }

                  activeSegments.length = nextActiveCount;

                  return columnEventsScratch.length > 0 ? columnEventsScratch : null;
                }
              : null;

          if (!rowHasEvents) {
            for (let j = 0; j < columns.length; j++) {
              const c = columns[j];

              if (c < 0 || c >= cols) continue;

              processTileBase(
                r,
                c,
                energyRow,
                nextRow,
                deltaRow,
                hasDeltaRow,
                densityRow,
                obstacleRow,
                gridRow,
                upEnergyRow,
                upObstacleRow,
                downEnergyRow,
                downObstacleRow,
                occupantRegenRow,
                occupantRegenVersionRow,
              );
              processedTileCount += 1;
            }

            continue;
          }

          for (let j = 0; j < columns.length; j++) {
            const c = columns[j];

            if (c < 0 || c >= cols) continue;

            const isObstacle = Boolean(obstacleRow?.[c]);

            if (canUseSegmentContribs && activeSegments) {
              while (
                nextSegmentIndex < segments.length &&
                segments[nextSegmentIndex].startCol <= c
              ) {
                activeSegments.push(segments[nextSegmentIndex]);
                nextSegmentIndex += 1;
              }

              let nextActiveCount = 0;
              let regenMultiplier = 1;
              let regenAdd = 0;
              let drain = 0;
              let hasEffect = false;

              for (let k = 0; k < activeSegments.length; k++) {
                const segment = activeSegments[k];

                if (segment.endCol > c) {
                  activeSegments[nextActiveCount] = segment;
                  nextActiveCount += 1;

                  if (!isObstacle) {
                    const contribution =
                      segment.event?.[SEGMENTED_EVENT_CONTRIBUTION_KEY] ?? null;

                    if (contribution) {
                      hasEffect = true;
                      regenMultiplier *= contribution.regenMultiplier;
                      regenAdd += contribution.regenAdd;
                      drain += contribution.drain;
                    }
                  }
                }
              }

              activeSegments.length = nextActiveCount;

              if (!hasEffect) {
                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                );
              } else {
                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                  regenMultiplier,
                  regenAdd,
                  drain,
                );
              }

              processedTileCount += 1;

              continue;
            }

            let eventsForTile = null;

            if (collectEventsForColumn) {
              eventsForTile = collectEventsForColumn(c, isObstacle);
            } else if (!useSegmentedForRow) {
              eventsForTile = rowEvents;
            }

            if (!eventsForTile || eventsForTile.length === 0) {
              processTileBase(
                r,
                c,
                energyRow,
                nextRow,
                deltaRow,
                hasDeltaRow,
                densityRow,
                obstacleRow,
                gridRow,
                upEnergyRow,
                upObstacleRow,
                downEnergyRow,
                downObstacleRow,
                occupantRegenRow,
                occupantRegenVersionRow,
              );
            } else {
              const modifiers = resolveModifiersForTile(eventsForTile, r, c);

              processTileBase(
                r,
                c,
                energyRow,
                nextRow,
                deltaRow,
                hasDeltaRow,
                densityRow,
                obstacleRow,
                gridRow,
                upEnergyRow,
                upObstacleRow,
                downEnergyRow,
                downObstacleRow,
                occupantRegenRow,
                occupantRegenVersionRow,
                modifiers.regenMultiplier,
                modifiers.regenAdd,
                modifiers.drain,
              );
            }
            processedTileCount += 1;
          }

          if (activeSegments) {
            activeSegments.length = 0;
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
        const hasDeltaRow = Boolean(deltaRow);
        const densityRow = resolvedDensityGrid ? resolvedDensityGrid[r] : null;
        const rowObstacleCount = obstacleRowCounts ? obstacleRowCounts[r] : 0;
        const obstacleRow = rowObstacleCount > 0 ? obstacles[r] : null;
        const gridRow = this.grid[r];
        const upEnergyRow = r > 0 ? energyGrid[r - 1] : null;
        const upObstacleRow =
          r > 0 && obstacleRowCounts && obstacleRowCounts[r - 1] > 0
            ? obstacles[r - 1]
            : null;
        const downEnergyRow = r < rows - 1 ? energyGrid[r + 1] : null;
        const downObstacleRow =
          r < rows - 1 && obstacleRowCounts && obstacleRowCounts[r + 1] > 0
            ? obstacles[r + 1]
            : null;
        const occupantRegenRow = occupantRegenGrid ? occupantRegenGrid[r] : null;
        const occupantRegenVersionRow = occupantRegenVersion
          ? occupantRegenVersion[r]
          : null;

        crowdComfortRow = crowdingComfortGrid ? crowdingComfortGrid[r] : null;
        crowdCountRow = crowdingCountGrid ? crowdingCountGrid[r] : null;
        crowdScarcityRow = crowdingScarcityGrid ? crowdingScarcityGrid[r] : null;
        crowdRevisionRow = crowdingRevisionGrid ? crowdingRevisionGrid[r] : null;

        const rowEvents = hasEvents
          ? eventsByRow
            ? (eventsByRow[r] ?? EMPTY_EVENT_LIST)
            : evs
          : EMPTY_EVENT_LIST;
        const rowHasEvents = hasEvents && rowEvents.length > 0;

        if (rowHasEvents && usingSegmentedEvents) {
          const segments = rowEvents;

          const activeSegments = this.#getSegmentWindowScratch();
          const useSegmentContribs = segmentedEventContributions;
          const columnEvents = useSegmentContribs
            ? null
            : this.#getColumnEventScratch();
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

            if (useSegmentContribs) {
              let regenMultiplier = 1;
              let regenAdd = 0;
              let drain = 0;
              let hasEffect = false;

              for (let i = 0; i < activeSegments.length; i++) {
                const segment = activeSegments[i];

                if (segment.endCol > c) {
                  activeSegments[nextActiveCount] = segment;
                  nextActiveCount += 1;

                  if (!isObstacle) {
                    const contribution =
                      segment.event?.[SEGMENTED_EVENT_CONTRIBUTION_KEY] ?? null;

                    if (contribution) {
                      hasEffect = true;
                      regenMultiplier *= contribution.regenMultiplier;
                      regenAdd += contribution.regenAdd;
                      drain += contribution.drain;
                    }
                  }
                }
              }

              activeSegments.length = nextActiveCount;

              if (!hasEffect) {
                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                );
              } else {
                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                  regenMultiplier,
                  regenAdd,
                  drain,
                );
              }
            } else {
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

              if (!eventsForTile) {
                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                );
              } else {
                const modifiers = resolveModifiersForTile(eventsForTile, r, c);

                processTileBase(
                  r,
                  c,
                  energyRow,
                  nextRow,
                  deltaRow,
                  hasDeltaRow,
                  densityRow,
                  obstacleRow,
                  gridRow,
                  upEnergyRow,
                  upObstacleRow,
                  downEnergyRow,
                  downObstacleRow,
                  occupantRegenRow,
                  occupantRegenVersionRow,
                  modifiers.regenMultiplier,
                  modifiers.regenAdd,
                  modifiers.drain,
                );
              }
            }

            processedTileCount += 1;
          }

          if (activeSegments) {
            activeSegments.length = 0;
          }

          continue;
        }

        if (!rowHasEvents) {
          for (let c = 0; c < cols; c++) {
            processTileBase(
              r,
              c,
              energyRow,
              nextRow,
              deltaRow,
              hasDeltaRow,
              densityRow,
              obstacleRow,
              gridRow,
              upEnergyRow,
              upObstacleRow,
              downEnergyRow,
              downObstacleRow,
              occupantRegenRow,
              occupantRegenVersionRow,
            );
            processedTileCount += 1;
          }

          continue;
        }

        const eventsForRow = rowEvents;

        for (let c = 0; c < cols; c++) {
          const modifiers = resolveModifiersForTile(eventsForRow, r, c);

          processTileBase(
            r,
            c,
            energyRow,
            nextRow,
            deltaRow,
            hasDeltaRow,
            densityRow,
            obstacleRow,
            gridRow,
            upEnergyRow,
            upObstacleRow,
            downEnergyRow,
            downObstacleRow,
            occupantRegenRow,
            occupantRegenVersionRow,
            modifiers.regenMultiplier,
            modifiers.regenAdd,
            modifiers.drain,
          );
          processedTileCount += 1;
        }
      }
    }

    if (segmentedEventCleanup) {
      for (let i = 0; i < segmentedEventCleanup.length; i++) {
        const event = segmentedEventCleanup[i];

        if (!event) continue;

        if (Object.hasOwn(event, SEGMENTED_EVENT_CONTRIBUTION_KEY)) {
          try {
            delete event[SEGMENTED_EVENT_CONTRIBUTION_KEY];
          } catch {
            event[SEGMENTED_EVENT_CONTRIBUTION_KEY] = undefined;
          }
        }

        segmentedEventCleanup[i] = null;
      }

      segmentedEventCleanup.length = 0;
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
    if (!GridManager.#isCellRecord(cell)) return;

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

    this.#markDensityIntegralDirty();

    const baseRadius = Number.isFinite(radius)
      ? radius
      : Number.isFinite(this.densityRadius)
        ? this.densityRadius
        : 0;
    const normalizedRadius = baseRadius > 0 ? Math.floor(baseRadius) : 0;

    if (normalizedRadius < 1) {
      return;
    }

    const { rows, cols } = this;
    const counts = this.densityCounts;
    const liveGrid = this.densityLiveGrid;
    const totals = this.densityTotals;
    const canUpdateDensity = Array.isArray(liveGrid) && Array.isArray(totals);
    const minRow = Math.max(0, row - normalizedRadius);
    const maxRow = Math.min(rows - 1, row + normalizedRadius);
    const minCol = Math.max(0, col - normalizedRadius);
    const maxCol = Math.min(cols - 1, col + normalizedRadius);

    for (let rr = minRow; rr <= maxRow; rr++) {
      const countsRow = counts[rr];

      if (!countsRow) continue;

      const liveRow = canUpdateDensity ? liveGrid[rr] : null;
      const totalsRow = canUpdateDensity ? totals[rr] : null;
      const updateRow = liveRow && totalsRow;

      for (let cc = minCol; cc <= maxCol; cc++) {
        if (rr === row && cc === col) continue;

        const baseCount = countsRow[cc];
        const nextCount = (baseCount ?? 0) + delta;

        countsRow[cc] = nextCount;

        if (!updateRow) continue;

        const total = totalsRow[cc] ?? 0;

        if (!(total > 0)) {
          if (liveRow[cc] !== 0) {
            liveRow[cc] = 0;
            this.#markDensityDirty(rr, cc);
          }

          continue;
        }

        const ratio = nextCount / total;
        const nextDensity = ratio <= 0 ? 0 : ratio >= 1 ? 1 : ratio;

        if (liveRow[cc] !== nextDensity) {
          liveRow[cc] = nextDensity;
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
    const cacheKey = `${rows}x${cols}:${normalizedRadius}`;
    const cachedTotals = this.#densityTotalsCache.get(cacheKey);

    if (cachedTotals) {
      return cachedTotals;
    }

    let totals;

    if (normalizedRadius === 0) {
      totals = Array.from({ length: rows }, () => Array(cols).fill(0));
    } else {
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

      totals = Array.from({ length: rows }, (_, r) => {
        const span = rowSpans[r];
        const totalsRow = new Array(cols);

        for (let c = 0; c < cols; c++) {
          const neighbors = span * colSpans[c] - 1;

          totalsRow[c] = neighbors > 0 ? neighbors : 0;
        }

        return totalsRow;
      });
    }

    this.#densityTotalsCache.set(cacheKey, totals);

    if (this.#densityTotalsCache.size > 8) {
      const firstKey = this.#densityTotalsCache.keys().next().value;

      if (firstKey !== cacheKey) {
        this.#densityTotalsCache.delete(firstKey);
      }
    }

    return totals;
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
    this.#markRenderTileDirty(row, col);
  }

  markEnergyDirty(row, col, options = {}) {
    if (!this.energyDirtyTiles) {
      this.energyDirtyTiles = new Set();
    }

    this.#markEnergyDirty(row, col, options);
  }

  #markAllTilesDirty() {
    this.#clearRenderDirtyTiles();
    this.#imageDataNeedsFullRefresh = true;
  }

  #resetImageDataBuffer() {
    this.#imageDataCanvas = null;
    this.#imageDataCtx = null;
    this.#imageData = null;
    this.#imageData32 = null;
    this.#imageDataNeedsFullRefresh = true;
    this.#ensureRenderDirtyCapacity();
    this.#clearRenderDirtyTiles();
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

    // Each tile's density values are reassigned in the loops below, so avoid an
    // extra grid-sized pass that previously zeroed the arrays.
    this.densityDirtyTiles.clear();
  }

  #resolveCachedDensityValue(
    row,
    col,
    densityRow = null,
    densityGrid = null,
    radius = null,
  ) {
    if (densityRow) {
      const direct = densityRow[col];

      if (direct != null) {
        return direct;
      }
    }

    const gridSource = densityGrid ?? this.densityGrid;

    if (gridSource) {
      const gridRow = gridSource[row];

      if (gridRow) {
        const value = gridRow[col];

        if (value != null) {
          return value;
        }
      }
    }

    const liveGrid = this.densityLiveGrid;

    if (liveGrid) {
      const liveRow = liveGrid[row];

      if (liveRow) {
        const liveValue = liveRow[col];

        if (liveValue != null) {
          return liveValue;
        }
      }
    }

    const effectiveRadius =
      Number.isFinite(radius) && radius >= 0
        ? radius
        : Number.isFinite(this.densityRadius)
          ? this.densityRadius
          : GridManager.DENSITY_RADIUS;

    return this.localDensity(row, col, effectiveRadius);
  }

  recalculateDensityCounts(radius = this.densityRadius) {
    const normalizedRadius = Math.max(0, Math.floor(radius));
    const targetRadius = normalizedRadius > 0 ? normalizedRadius : this.densityRadius;

    this.#markDensityIntegralDirty();
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

    this.densityDirtyTiles.clear();

    const rows = this.rows;
    const cols = this.cols;
    const prefix = this.#ensureDensityPrefix(rows, cols);

    for (let r = 1; r <= rows; r++) {
      const prefixRow = prefix[r];
      const prevRow = prefix[r - 1];
      const gridRow = this.grid[r - 1];
      let rowSum = 0;

      for (let c = 1; c <= cols; c++) {
        const occupied = gridRow?.[c - 1] ? 1 : 0;

        rowSum += occupied;
        prefixRow[c] = prevRow[c] + rowSum;
      }
    }

    const activeRadius = this.densityRadius;
    const { rowTop, rowBottom, colLeft, colRight } = this.#ensureDensityBounds(
      rows,
      cols,
      activeRadius,
    );
    const counts = this.densityCounts;
    const live = this.densityLiveGrid;
    const totals = this.densityTotals;

    for (let r = 0; r < rows; r++) {
      const countsRow = counts[r];
      const liveRow = live ? live[r] : null;
      const totalsRow = totals ? totals[r] : null;
      const gridRow = this.grid[r];
      const topIndex = rowTop[r];
      const bottomIndex = rowBottom[r];
      const prefixTopRow = prefix[topIndex];
      const prefixBottomRow = prefix[bottomIndex];

      for (let c = 0; c < cols; c++) {
        const leftIndex = colLeft[c];
        const rightIndex = colRight[c];

        const regionSum =
          prefixBottomRow[rightIndex] -
          prefixTopRow[rightIndex] -
          prefixBottomRow[leftIndex] +
          prefixTopRow[leftIndex];

        const occupied = gridRow?.[c] ? 1 : 0;
        const neighborCount = regionSum - occupied;

        countsRow[c] = neighborCount;

        if (liveRow && totalsRow) {
          const totalNeighbors = totalsRow[c] || 0;
          const density =
            totalNeighbors > 0 ? clamp(neighborCount / totalNeighbors, 0, 1) : 0;

          liveRow[c] = density;
        }
      }
    }

    this.densityDirtyTiles.clear();
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
    if (this.grid?.[row]?.[col]) return null;

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
    return this.#resolveCachedDensityValue(row, col, null, null, this.densityRadius);
  }

  // Precompute density for all tiles (fraction of occupied neighbors)
  #countNeighbors(row, col, radius = GridManager.DENSITY_RADIUS) {
    const rows = this.rows;
    const cols = this.cols;

    if (rows <= 0 || cols <= 0 || row < 0 || row >= rows || col < 0 || col >= cols) {
      return { count: 0, total: 0 };
    }

    const normalizedRadius = Math.max(
      0,
      Math.floor(Number.isFinite(radius) ? radius : GridManager.DENSITY_RADIUS),
    );

    if (normalizedRadius === 0) {
      return { count: 0, total: 0 };
    }

    let minRow = row - normalizedRadius;

    if (minRow < 0) minRow = 0;
    let maxRow = row + normalizedRadius;

    if (maxRow >= rows) maxRow = rows - 1;
    let minCol = col - normalizedRadius;

    if (minCol < 0) minCol = 0;
    let maxCol = col + normalizedRadius;

    if (maxCol >= cols) maxCol = cols - 1;

    const grid = this.grid;
    const integral = this.#resolveDensityIntegral();

    if (integral) {
      const leftIndex = minCol;
      const rightIndex = maxCol + 1;
      const topIndex = minRow;
      const bottomIndex = maxRow + 1;
      const regionSum =
        integral[bottomIndex][rightIndex] -
        integral[topIndex][rightIndex] -
        integral[bottomIndex][leftIndex] +
        integral[topIndex][leftIndex];
      const occupied = grid[row]?.[col] ? 1 : 0;
      const spanRows = maxRow - minRow + 1;
      const spanCols = maxCol - minCol + 1;
      const total = spanRows * spanCols - 1;
      const count = regionSum - occupied;

      return { count, total: total > 0 ? total : 0 };
    }

    let count = 0;
    let total = 0;

    for (let rr = minRow; rr <= maxRow; rr++) {
      const gridRow = grid[rr];

      if (!gridRow) continue;

      for (let cc = minCol; cc <= maxCol; cc++) {
        if (rr === row && cc === col) continue;

        total += 1;

        if (gridRow[cc]) {
          count += 1;
        }
      }
    }

    return { count, total };
  }

  computeDensityGrid(radius = GridManager.DENSITY_RADIUS) {
    const normalizedRadius = Math.max(
      0,
      Math.floor(Number.isFinite(radius) ? radius : 0),
    );
    const useCache =
      normalizedRadius === this.densityRadius &&
      this.densityCounts &&
      this.densityTotals &&
      this.densityLiveGrid;

    if (useCache) {
      this.#syncDensitySnapshot();

      return this.densityGrid.map((row) => row.slice());
    }

    const rows = this.rows;
    const cols = this.cols;

    if (rows === 0 || cols === 0) {
      return [];
    }

    if (normalizedRadius === 0) {
      return Array.from({ length: rows }, () => Array(cols).fill(0));
    }

    const prefix = this.#ensureDensityPrefix(rows, cols);
    const { rowTop, rowBottom, colLeft, colRight } = this.#ensureDensityBounds(
      rows,
      cols,
      normalizedRadius,
    );

    for (let r = 1; r <= rows; r++) {
      const prefixRow = prefix[r];
      const prevRow = prefix[r - 1];
      const gridRow = this.grid[r - 1];
      let rowSum = 0;

      for (let c = 1; c <= cols; c++) {
        const occupied = gridRow?.[c - 1] ? 1 : 0;

        rowSum += occupied;
        prefixRow[c] = prevRow[c] + rowSum;
      }
    }

    const totals =
      normalizedRadius === this.densityRadius && this.densityTotals
        ? this.densityTotals
        : this.#buildDensityTotals(normalizedRadius);
    const out = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let r = 0; r < rows; r++) {
      const outRow = out[r];
      const totalsRow = totals[r];
      const gridRow = this.grid[r];
      const topIndex = rowTop[r];
      const bottomIndex = rowBottom[r];
      const prefixTopRow = prefix[topIndex];
      const prefixBottomRow = prefix[bottomIndex];

      for (let c = 0; c < cols; c++) {
        const leftIndex = colLeft[c];
        const rightIndex = colRight[c];
        const regionSum =
          prefixBottomRow[rightIndex] -
          prefixTopRow[rightIndex] -
          prefixBottomRow[leftIndex] +
          prefixTopRow[leftIndex];
        const occupied = gridRow?.[c] ? 1 : 0;
        const neighborCount = regionSum - occupied;
        const totalNeighbors = totalsRow?.[c] ?? 0;

        outRow[c] =
          totalNeighbors > 0 ? clamp(neighborCount / totalNeighbors, 0, 1) : 0;
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
      supportsPackedColor &&
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

    for (let i = 0; i < dirtyTiles.length; i++) {
      const key = dirtyTiles[i];
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
      const dirtyCount = dirtyTiles.length;
      const dirtyArea = dirtyWidth * dirtyHeight;
      let usedSparseFlush = false;

      if (
        dirtyCount >= IMAGE_DATA_SPARSE_MIN_TILES &&
        dirtyArea > dirtyCount * IMAGE_DATA_SPARSE_AREA_RATIO
      ) {
        usedSparseFlush = this.#flushSparseImageData(dirtyTiles, {
          minRow,
          maxRow,
          cols,
        });
      }

      if (!usedSparseFlush) {
        this.#imageDataCtx.putImageData(
          this.#imageData,
          0,
          0,
          minCol,
          minRow,
          dirtyWidth,
          dirtyHeight,
        );
      }
      this.#imageDataNeedsFullRefresh = false;
    }

    return { minRow, minCol, maxRow, maxCol };
  }

  #flushSparseImageData(dirtyTiles, bounds) {
    if (
      !this.#imageData ||
      !this.#imageDataCtx ||
      typeof this.#imageDataCtx.putImageData !== "function"
    ) {
      return false;
    }

    const { minRow, maxRow, cols } = bounds ?? {};

    if (
      !Number.isInteger(minRow) ||
      !Number.isInteger(maxRow) ||
      !Number.isInteger(cols) ||
      minRow > maxRow
    ) {
      return false;
    }

    const rowBuckets = this.#prepareSparseDirtyColumns(this.rows);
    const rowList = this.#getSparseDirtyRowList();

    for (let i = 0; i < dirtyTiles.length; i++) {
      const key = dirtyTiles[i];
      const row = Math.floor(key / cols);
      const col = key % cols;

      if (row < minRow || row > maxRow) {
        continue;
      }

      const bucket = rowBuckets[row];

      if (!bucket) {
        continue;
      }

      if (bucket.length === 0) {
        rowList.push(row);
      }

      bucket.push(col);
    }

    if (rowList.length === 0) {
      return false;
    }

    rowList.sort((a, b) => a - b);

    const imageData = this.#imageData;
    const ctx = this.#imageDataCtx;

    for (let i = 0; i < rowList.length; i++) {
      const row = rowList[i];
      const bucket = rowBuckets[row];

      if (!bucket || bucket.length === 0) {
        continue;
      }

      bucket.sort((a, b) => a - b);

      let start = bucket[0];
      let previous = start;

      for (let j = 1; j < bucket.length; j++) {
        const col = bucket[j];

        if (col === previous + 1) {
          previous = col;

          continue;
        }

        const width = previous - start + 1;

        if (width > 0) {
          ctx.putImageData(imageData, 0, 0, start, row, width, 1);
        }

        start = previous = col;
      }

      const width = previous - start + 1;

      if (width > 0) {
        ctx.putImageData(imageData, 0, 0, start, row, width, 1);
      }

      bucket.length = 0;
    }

    rowList.length = 0;

    return true;
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

    this.#clearRenderDirtyTiles();
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
    const dirtyTiles = this.#renderDirtyIndices;
    let dirtyCount = dirtyTiles.length;
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

    this.#clearRenderDirtyTiles();

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
      dirtyCount: this.#renderDirtyIndices.length,
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

    if (this.pendingOccupantRegen && this.#occupantRegenVersion) {
      const regenRow = this.pendingOccupantRegen[row];
      const versionRow = this.#occupantRegenVersion[row];

      if (regenRow && versionRow && versionRow[col] === this.#occupantRegenRevision) {
        const stored = regenRow[col];

        if (Number.isFinite(stored) && stored > 0) {
          pendingRegen = stored;
        }

        regenRow[col] = 0;
        versionRow[col] = 0;
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
    diversityOpportunity = 0,
    diversityOpportunityAvailability = 0,
    complementOpportunity = 0,
    complementOpportunityAvailability = 0,
    complementOpportunityGap = 0,
    complementOpportunityAlignment = 0,
    noveltyPressure = 0,
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
    const opportunitySignal = clamp(
      Number.isFinite(diversityOpportunity) ? diversityOpportunity : 0,
      0,
      1,
    );
    const opportunityAvailability = clamp(
      Number.isFinite(diversityOpportunityAvailability)
        ? diversityOpportunityAvailability
        : opportunitySignal > 0
          ? 1
          : 0,
      0,
      1,
    );
    const complementOpportunitySignal = clamp(
      Number.isFinite(complementOpportunity) ? complementOpportunity : 0,
      0,
      1,
    );
    const complementAvailability = clamp(
      Number.isFinite(complementOpportunityAvailability)
        ? complementOpportunityAvailability
        : complementOpportunitySignal > 0
          ? 1
          : 0,
      0,
      1,
    );
    const complementGapValue = clamp(
      Number.isFinite(complementOpportunityGap)
        ? complementOpportunityGap
        : complementOpportunitySignal > 0
          ? clamp(1 - complementOpportunitySignal, 0, 1)
          : 0,
      0,
      1,
    );
    const complementAlignmentValue = clamp(
      Number.isFinite(complementOpportunityAlignment)
        ? complementOpportunityAlignment
        : complementAvailability > 0
          ? clamp(1 - complementGapValue, 0, 1)
          : 0,
      0,
      1,
    );

    const pressure = clamp(
      Number.isFinite(diversityPressure) ? diversityPressure : 0,
      0,
      1,
    );
    const scarcitySignal = clamp(Number.isFinite(scarcity) ? scarcity : 0, 0, 1);
    const novelty = clamp(Number.isFinite(noveltyPressure) ? noveltyPressure : 0, 0, 1);
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

    if (opportunitySignal > 0) {
      const opportunityDemand =
        opportunitySignal *
        (0.22 + pressure * 0.25 + combinedDrive * 0.2 + probabilitySlack * 0.15);

      severity += opportunityDemand;
    }

    if (opportunityAvailability > 0) {
      const availabilityDemand =
        opportunityAvailability *
        (0.12 + pressure * 0.2 + combinedDrive * 0.15 + probabilitySlack * 0.15);

      severity += availabilityDemand * (0.35 + opportunitySignal * 0.25);
      severity *= 1 + availabilityDemand * 0.2;
    }

    if (complementOpportunitySignal > 0) {
      const complementDemand =
        complementOpportunitySignal *
        (0.18 + pressure * 0.25 + combinedDrive * 0.2 + probabilitySlack * 0.2);
      const complementAvailabilityDemand =
        complementAvailability *
        (0.14 + strategyPressureValue * 0.22 + probabilitySlack * 0.18);
      const gapIntensity =
        complementGapValue *
        (0.22 + pressure * 0.18 + strategyPressureValue * 0.2 + closeness * 0.15);

      severity += complementDemand * (0.45 + complementGapValue * 0.35);
      severity += complementAvailabilityDemand * (0.35 + complementDemand * 0.2);
      severity *= 1 + gapIntensity;
    }

    if (novelty > 0) {
      const noveltyDemand =
        novelty * (0.18 + probabilitySlack * 0.28 + closeness * 0.3 + pressure * 0.25);

      severity += noveltyDemand;

      const noveltyIntensity =
        novelty * (0.1 + diversityShortfall * 0.25 + opportunitySignal * 0.2);

      if (noveltyIntensity > 0) {
        severity *= 1 + noveltyIntensity * (0.5 + strategyPressureValue * 0.25);
      }
    }

    if (complementarity > 0 && evennessDrag > 0) {
      const reliefScale =
        0.25 + evennessDrag * 0.4 + combinedDrive * 0.25 + pressure * 0.2;
      const relief = clamp(complementarity * reliefScale, 0, 0.8);

      severity *= clamp(1 - relief, 0.25, 1);
      severity -= complementarity * evennessDrag * 0.12;
    }

    if (complementAlignmentValue > 0) {
      const complementRelief =
        complementAlignmentValue *
        (0.12 + complementarity * 0.2 + (1 - closeness) * 0.1 + pressure * 0.1);

      severity *= clamp(1 - complementRelief, 0.3, 1);
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

    const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 12;

    if (normalizedLimit <= 0) {
      return [];
    }

    const maxCandidates = normalizedLimit;

    const selected = new Array(maxCandidates);
    const separations = new Array(maxCandidates);
    let size = 0;

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];

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
      const normalizedSeparation = Number.isFinite(separation)
        ? separation
        : Number.POSITIVE_INFINITY;

      if (size < maxCandidates) {
        let insertAt = size;

        while (insertAt > 0 && normalizedSeparation < separations[insertAt - 1]) {
          selected[insertAt] = selected[insertAt - 1];
          separations[insertAt] = separations[insertAt - 1];
          insertAt -= 1;
        }

        selected[insertAt] = candidate;
        separations[insertAt] = normalizedSeparation;
        size += 1;

        continue;
      }

      if (normalizedSeparation >= separations[size - 1]) {
        continue;
      }

      let insertAt = size - 1;

      while (insertAt > 0 && normalizedSeparation < separations[insertAt - 1]) {
        selected[insertAt] = selected[insertAt - 1];
        separations[insertAt] = separations[insertAt - 1];
        insertAt -= 1;
      }

      selected[insertAt] = candidate;
      separations[insertAt] = normalizedSeparation;
    }

    return selected.slice(0, size);
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

    const scoredCandidates =
      typeof cell.scorePotentialMates === "function"
        ? cell.scorePotentialMates(matePool, reproductionContext)
        : EMPTY_TARGET_LIST;
    const selection = cell.selectMateWeighted
      ? cell.selectMateWeighted(matePool, reproductionContext, scoredCandidates)
      : null;
    const selectedMate = selection?.chosen ?? null;
    const evaluated = Array.isArray(selection?.evaluated)
      ? selection.evaluated
      : EMPTY_TARGET_LIST;
    const selectionMode = selection?.mode ?? "preference";

    let bestMate = selectedMate;

    if (!bestMate || !bestMate.target) {
      bestMate = cell.findBestMate
        ? cell.findBestMate(matePool, reproductionContext, scoredCandidates)
        : null;

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
    const opportunityCandidates =
      Array.isArray(scoredCandidates) && scoredCandidates.length > 0
        ? scoredCandidates
        : evaluated;

    if (Array.isArray(opportunityCandidates) && opportunityCandidates.length > 0) {
      for (let i = 0; i < opportunityCandidates.length; i += 1) {
        const candidate = opportunityCandidates[i];

        if (!candidate) continue;

        const partner = candidate.target ?? null;

        if (!partner) continue;

        const complementValue = computeBehaviorComplementarity(cell, partner);

        if (Number.isFinite(complementValue) && complementValue > 0) {
          candidate.behaviorComplementarityOpportunity = complementValue;
        } else if (Object.hasOwn(candidate, "behaviorComplementarityOpportunity")) {
          candidate.behaviorComplementarityOpportunity = undefined;
        }
      }
    }

    const diversityOpportunitySummary = GridManager.#summarizeMateDiversityOpportunity({
      candidates: opportunityCandidates,
      chosenDiversity: diversity,
      chosenComplementarity: behaviorComplementarity,
      diversityThreshold: pairDiversityThreshold,
    });
    const diversityOpportunityScore = diversityOpportunitySummary.score;
    const diversityOpportunityWeight = diversityOpportunitySummary.weight;
    const diversityOpportunityAvailability = diversityOpportunitySummary.availability;
    const rawOpportunityGap = diversityOpportunitySummary.gap;
    const diversityOpportunityGap = Number.isFinite(rawOpportunityGap)
      ? clamp(rawOpportunityGap, 0, 1)
      : 0;
    const opportunityAvailability = clamp(
      Number.isFinite(diversityOpportunityAvailability)
        ? diversityOpportunityAvailability
        : 0,
      0,
      1,
    );
    const opportunityWeight = clamp(
      Number.isFinite(diversityOpportunityWeight) ? diversityOpportunityWeight : 0,
      0,
      1,
    );
    const opportunityAlignment = clamp(1 - diversityOpportunityGap, 0, 1);
    const opportunityAlignmentWeighted = opportunityAlignment * opportunityAvailability;
    let opportunityAlignmentMultiplier = 1;
    let opportunityPenaltyMultiplier = 1;
    const complementOpportunityScore = Number.isFinite(
      diversityOpportunitySummary.complementScore,
    )
      ? clamp(diversityOpportunitySummary.complementScore, 0, 1)
      : 0;
    const complementOpportunityAvailability = clamp(
      Number.isFinite(diversityOpportunitySummary.complementAvailability)
        ? diversityOpportunitySummary.complementAvailability
        : 0,
      0,
      1,
    );
    const complementOpportunityWeight = clamp(
      Number.isFinite(diversityOpportunitySummary.complementWeight)
        ? diversityOpportunitySummary.complementWeight
        : 0,
      0,
      1,
    );
    const complementOpportunityGap = clamp(
      Number.isFinite(diversityOpportunitySummary.complementGap)
        ? diversityOpportunitySummary.complementGap
        : 0,
      0,
      1,
    );
    const complementOpportunityAlignment = clamp(
      Number.isFinite(diversityOpportunitySummary.complementAlignment)
        ? diversityOpportunitySummary.complementAlignment
        : complementOpportunityAvailability > 0
          ? clamp(1 - complementOpportunityGap, 0, 1)
          : 0,
      0,
      1,
    );
    let complementOpportunityMultiplier = 1;
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
        diversityOpportunity: diversityOpportunityScore,
        diversityOpportunityAvailability,
        complementOpportunity: complementOpportunityScore,
        complementOpportunityAvailability,
        complementOpportunityGap,
        complementOpportunityAlignment,
        noveltyPressure: combinedNovelty,
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

    if (diversity >= pairDiversityThreshold && effectiveReproProb > 0) {
      if (opportunityWeight > 0) {
        const weightedAlignment = opportunityAlignmentWeighted * opportunityWeight;

        if (weightedAlignment > 0) {
          const alignmentBonusScale =
            0.12 + diversityPressure * 0.22 + behaviorComplementarity * 0.18;
          const alignmentBonus = clamp(
            1 + weightedAlignment * alignmentBonusScale,
            1,
            1.5,
          );

          opportunityAlignmentMultiplier *= alignmentBonus;
        }

        const weightedGap =
          diversityOpportunityGap * opportunityAvailability * opportunityWeight;

        if (weightedGap > 0.001) {
          const penaltyScale = 0.08 + diversityPressure * 0.18 + strategyPressure * 0.2;
          const penaltyMultiplierCandidate = clamp(
            1 - weightedGap * penaltyScale,
            penaltyFloor > 0 ? penaltyFloor : 0.6,
            1,
          );

          if (penaltyMultiplierCandidate < 1) {
            opportunityPenaltyMultiplier = Math.min(
              opportunityPenaltyMultiplier,
              penaltyMultiplierCandidate,
            );
            opportunityAlignmentMultiplier *= penaltyMultiplierCandidate;
            penalizedForSimilarity = true;
          }
        }
      }

      if (complementOpportunityWeight > 0) {
        const complementAlignmentWeighted =
          complementOpportunityAlignment *
          complementOpportunityAvailability *
          complementOpportunityWeight *
          complementOpportunityScore;

        if (complementAlignmentWeighted > 0 && behaviorComplementarity > 0) {
          const complementBonusScale =
            0.1 + behaviorComplementarity * 0.25 + strategyPressure * 0.18;
          const complementBonus = clamp(
            1 + complementAlignmentWeighted * complementBonusScale,
            1,
            1.5,
          );

          opportunityAlignmentMultiplier *= complementBonus;
          complementOpportunityMultiplier *= complementBonus;
        }

        const complementGapWeighted =
          complementOpportunityGap *
          complementOpportunityAvailability *
          complementOpportunityWeight *
          complementOpportunityScore;

        if (complementGapWeighted > 0.001) {
          const complementPenaltyScale =
            complementOpportunityScore *
            (0.05 + strategyPressure * 0.12 + (1 - behaviorComplementarity) * 0.15);
          const complementPenaltyCandidate = clamp(
            1 - complementGapWeighted * complementPenaltyScale,
            penaltyFloor > 0 ? penaltyFloor : 0.65,
            1,
          );

          if (complementPenaltyCandidate < 1) {
            opportunityPenaltyMultiplier = Math.min(
              opportunityPenaltyMultiplier,
              complementPenaltyCandidate,
            );
            opportunityAlignmentMultiplier *= complementPenaltyCandidate;
            complementOpportunityMultiplier *= complementPenaltyCandidate;
            penalizedForSimilarity = true;
          }
        }
      }
    }

    if (opportunityAlignmentMultiplier !== 1) {
      effectiveReproProb = clamp(
        effectiveReproProb * opportunityAlignmentMultiplier,
        0,
        1,
      );
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

      if (diversityOpportunityScore > 0) {
        monotonySeverity *= 1 + diversityOpportunityScore * 0.28;
        monotonySeverity += diversityOpportunityScore * 0.08;
      }

      if (complementOpportunityScore > 0.05) {
        const complementDemand =
          complementOpportunityScore *
          (0.12 + complementOpportunityAvailability * 0.24 + complementGap * 0.18);

        monotonySeverity += complementDemand;
        monotonySeverity *= 1 + complementOpportunityGap * 0.15;
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
      diversityPenaltyMultiplier *
        strategyPenaltyMultiplier *
        opportunityPenaltyMultiplier,
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
    let thrA = thrFracA * this.maxTileEnergy;
    let thrB = thrFracB * this.maxTileEnergy;
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

    let distanceScaling = { probability: 1, energy: 1 };

    if (!blockedInfo) {
      if (!Number.isFinite(separation) || separation <= 0) {
        blockedInfo = {
          reason: "Parents out of reach",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach },
        };
      } else if (separation > effectiveReach) {
        blockedInfo = {
          reason: "Parents out of reach",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach },
        };
      } else {
        distanceScaling = computeReproductionDistanceScaling({
          separation,
          effectiveReach,
          parentReach,
          mateReach,
          parentTileEnergy: tileEnergy,
          mateTileEnergy,
          parentTileEnergyDelta: tileEnergyDelta,
          mateTileEnergyDelta,
          parentLocalDensity: localDensity,
          mateLocalDensity,
        });

        if (
          !Number.isFinite(distanceScaling?.probability) ||
          distanceScaling.probability <= 0
        ) {
          blockedInfo = {
            reason: "Parents out of reach",
            parentA: { row: parentRow, col: parentCol, reach: parentReach },
            parentB: { row: mateRow, col: mateCol, reach: mateReach },
            separation: { distance: separation, effectiveReach },
          };
        }
      }
    }

    if (!blockedInfo && effectiveReproProb > 0) {
      const probabilityScale = clamp(distanceScaling?.probability ?? 1, 0, 1);

      if (probabilityScale <= 0) {
        blockedInfo = {
          reason: "Parents out of reach",
          parentA: { row: parentRow, col: parentCol, reach: parentReach },
          parentB: { row: mateRow, col: mateCol, reach: mateReach },
          separation: { distance: separation, effectiveReach },
        };
      } else if (probabilityScale < 1) {
        effectiveReproProb = clamp(effectiveReproProb * probabilityScale, 0, 1);
      }
    }

    if (!blockedInfo) {
      const energyScale = Number.isFinite(distanceScaling?.energy)
        ? distanceScaling.energy
        : 1;

      if (energyScale > 1) {
        thrA *= energyScale;
        thrB *= energyScale;
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
      const neighborOffsets = NEIGHBOR_OFFSETS;
      const neighborCount = neighborOffsets.length;
      const addNeighbors = (baseRow, baseCol) => {
        // Index iteration avoids array destructuring allocations on this hot path.
        for (let i = 0; i < neighborCount; i += 1) {
          const offset = neighborOffsets[i];

          addCandidate(baseRow + offset[0], baseCol + offset[1]);
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
                const parentAColor = resolveCellColor(cell);
                const parentBColor = resolveCellColor(bestMate.target);

                if (parentAColor) parentColors.push(parentAColor);
                if (parentBColor) parentColors.push(parentBColor);

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
        diversityOpportunity: diversityOpportunityScore,
        diversityOpportunityWeight,
        diversityOpportunityAvailability,
        diversityOpportunityGap,
        diversityOpportunityAlignment: opportunityAlignmentWeighted,
        diversityOpportunityMultiplier: opportunityAlignmentMultiplier,
        complementOpportunity: complementOpportunityScore,
        complementOpportunityWeight,
        complementOpportunityAvailability,
        complementOpportunityGap,
        complementOpportunityAlignment,
        complementOpportunityMultiplier,
        distanceProbabilityMultiplier: clamp(distanceScaling?.probability ?? 1, 0, 1),
        distanceEnergyMultiplier: Number.isFinite(distanceScaling?.energy)
          ? Math.max(1, distanceScaling.energy)
          : 1,
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
          diversityOpportunity: diversityOpportunityScore,
          diversityOpportunityWeight,
          diversityOpportunityAvailability,
          diversityOpportunityGap,
          diversityOpportunityAlignment: opportunityAlignmentWeighted,
          diversityOpportunityMultiplier: opportunityAlignmentMultiplier,
          complementOpportunity: complementOpportunityScore,
          complementOpportunityWeight,
          complementOpportunityAvailability,
          complementOpportunityGap,
          complementOpportunityAlignment,
          complementOpportunityMultiplier,
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
    const reachContext = {
      action,
      localDensity,
      densityEffectMultiplier,
      tileEnergy,
      tileEnergyDelta,
      maxTileEnergy: this.maxTileEnergy,
      enemies,
      allies,
      target: targetEnemy?.target ?? null,
      distance: dist,
    };
    const resolveInteractionReach = (mode) => {
      if (typeof cell.getInteractionReach !== "function") {
        return 1;
      }

      const reach = cell.getInteractionReach(mode, { ...reachContext, action: mode });

      return Number.isFinite(reach) && reach > 0 ? reach : 1;
    };

    if (action === "fight") {
      const fightReach = resolveInteractionReach("fight");

      if (dist <= fightReach) {
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

    const cooperateReach = resolveInteractionReach("cooperate");

    if (dist <= cooperateReach) {
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
    const populationCells = this.#acquirePopulationCellScratch();
    const snapshot = {
      rows: this.rows,
      cols: this.cols,
      population: 0,
      totalEnergy: 0,
      totalAge: 0,
      maxFitness: 0,
      entries,
    };
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
        const fightsWon = Number.isFinite(cell.fightsWon) ? cell.fightsWon : 0;
        const offspring = Number.isFinite(cell.offspring) ? cell.offspring : 0;
        const colorCandidate = resolveCellColor(cell);
        const entry = {
          row,
          col,
          fitness,
          age,
          fightsWon,
          offspring,
        };

        if (colorCandidate) {
          entry.color = colorCandidate;
        }

        snapshot.population += 1;
        snapshot.totalEnergy += energy;
        snapshot.totalAge += age;
        entries.push(entry);
        populationCells.push(cell);

        if (Number.isFinite(entry.fitness) && entry.fitness > snapshot.maxFitness) {
          snapshot.maxFitness = entry.fitness;
        }
      }
    }

    snapshot.populationCells = populationCells;
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

  getTargetDescriptorPoolSize() {
    return Array.isArray(this.#targetDescriptorPool)
      ? this.#targetDescriptorPool.length
      : 0;
  }

  #createTargetDescriptor() {
    return {
      row: 0,
      col: 0,
      target: null,
      classification: "",
      precomputedSimilarity: 0,
      similarity: 0,
    };
  }

  #acquireTargetDescriptor() {
    const descriptor = this.#targetDescriptorPool.pop();

    if (descriptor) {
      return descriptor;
    }

    return this.#createTargetDescriptor();
  }

  #resetTargetDescriptor(descriptor) {
    descriptor.row = 0;
    descriptor.col = 0;
    descriptor.target = null;
    descriptor.classification = "";
    descriptor.precomputedSimilarity = 0;
    descriptor.similarity = 0;

    for (const key of TARGET_DESCRIPTOR_DYNAMIC_KEYS) {
      if (Object.hasOwn(descriptor, key)) {
        descriptor[key] = undefined;
      }
    }

    const keys = Object.keys(descriptor);

    if (
      keys.length >
      TARGET_DESCRIPTOR_BASE_KEY_SET.size + TARGET_DESCRIPTOR_DYNAMIC_KEYS.size
    ) {
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];

        if (
          TARGET_DESCRIPTOR_BASE_KEY_SET.has(key) ||
          TARGET_DESCRIPTOR_DYNAMIC_KEYS.has(key)
        ) {
          continue;
        }

        descriptor[key] = undefined;
        TARGET_DESCRIPTOR_DYNAMIC_KEYS.add(key);
      }
    }

    return descriptor;
  }

  #flushTargetList(list) {
    if (!Array.isArray(list) || list.length === 0) {
      return;
    }

    const count = list.length;

    if (count > 0) {
      this.#targetUsageAccumulator += count;
    }

    for (let i = 0; i < list.length; i++) {
      const descriptor = list[i];

      if (!descriptor) continue;

      this.#targetDescriptorPool.push(this.#resetTargetDescriptor(descriptor));
    }

    list.length = 0;

    this.#trimTargetDescriptorPool();
  }

  #beginTargetScan() {
    this.#targetUsageAccumulator = 0;
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

    const usage = this.#targetUsageAccumulator;
    const previous = this.#targetDescriptorUsageAverage;
    const smoothing = TARGET_DESCRIPTOR_POOL_DECAY;

    this.#targetDescriptorUsageAverage = previous * smoothing + usage * (1 - smoothing);
    this.#targetUsageAccumulator = 0;

    this.#trimTargetDescriptorPool();
  }

  #resolveTargetDescriptorPoolLimit() {
    const { rows, cols } = normalizeDimensions(this.rows, this.cols);
    const area = rows * cols;
    const activeCount = this.activeCells?.size ?? 0;
    const averageUsage = this.#targetDescriptorUsageAverage || 0;
    const fallback = area > 0 ? Math.min(area, 1024) : 512;
    let estimate = averageUsage * 1.5 + TARGET_DESCRIPTOR_POOL_MIN;

    if (activeCount > 0) {
      estimate = Math.max(estimate, activeCount * 0.25);
    }

    if (!(estimate > 0) || !Number.isFinite(estimate)) {
      estimate = fallback;
    }

    if (area > 0) {
      estimate = Math.min(estimate, area);
      const minimum = Math.min(area, TARGET_DESCRIPTOR_POOL_MIN);

      estimate = Math.max(minimum, estimate);
    } else {
      estimate = Math.max(TARGET_DESCRIPTOR_POOL_MIN, estimate);
    }

    return Math.floor(estimate);
  }

  #trimTargetDescriptorPool() {
    if (!Array.isArray(this.#targetDescriptorPool)) {
      return;
    }

    const limit = this.#resolveTargetDescriptorPoolLimit();

    if (this.#targetDescriptorPool.length > limit) {
      this.#targetDescriptorPool.length = limit;
    }
  }

  #ensureSegmentedEventContributionCache() {
    let cache = this.#segmentedEventContributionCache;

    if (!cache) {
      cache = new WeakMap();
      this.#segmentedEventContributionCache = cache;
    }

    return cache;
  }

  #getSegmentedEventContributionCleanup() {
    if (!this.#segmentedEventContributionCleanup) {
      this.#segmentedEventContributionCleanup = [];
    } else {
      this.#segmentedEventContributionCleanup.length = 0;
    }

    return this.#segmentedEventContributionCleanup;
  }

  #resolveSegmentedEventContribution(
    event,
    { strengthMultiplier = 1, getEventEffect, effectCache } = {},
  ) {
    if (!event) {
      return null;
    }

    const cache = this.#ensureSegmentedEventContributionCache();
    const resolverIdentity =
      typeof getEventEffect === "function" ? getEventEffect : null;
    const eventType = typeof event?.eventType === "string" ? event.eventType : null;
    const numericMultiplier = Number(strengthMultiplier);
    const multiplier = Number.isFinite(numericMultiplier) ? numericMultiplier : 1;
    const baseStrength = Number(event?.strength ?? 0);
    const normalizedBaseStrength = Number.isFinite(baseStrength) ? baseStrength : 0;
    const strength = normalizedBaseStrength * multiplier;

    const cached = cache.get(event);

    if (
      cached &&
      cached.strength === strength &&
      cached.effectResolver === resolverIdentity &&
      cached.eventType === eventType
    ) {
      return cached;
    }

    const contribution = resolveEventContribution({
      event,
      strengthMultiplier: multiplier,
      getEventEffect: resolverIdentity ?? undefined,
      effectCache,
    });

    const record = {
      regenMultiplier: contribution?.regenMultiplier ?? 1,
      regenAdd: contribution?.regenAdd ?? 0,
      drain: contribution?.drainAdd ?? 0,
      strength,
      eventType,
      effectResolver: resolverIdentity,
    };

    cache.set(event, record);

    return record;
  }

  #resetTickSimilarityCache() {
    if (!this.#tickSimilarityCache) {
      this.#tickSimilarityCache = new WeakMap();
    }

    const rowsInUse = this.#tickSimilarityRowsInUse;

    if (Array.isArray(rowsInUse) && rowsInUse.length > 0) {
      for (let i = 0; i < rowsInUse.length; i += 1) {
        const record = rowsInUse[i];

        if (!record) continue;

        const { map, keys, cell } = record;

        if (map && Array.isArray(keys)) {
          for (let j = 0; j < keys.length; j += 1) {
            map.delete(keys[j]);
          }

          keys.length = 0;
        }

        if (cell) {
          this.#tickSimilarityCache.delete(cell);
        }

        record.cell = null;
        this.#tickSimilarityRowPool.push(record);
      }

      rowsInUse.length = 0;
    }

    this.#tickSimilarityVersion = this.tickCount;
  }

  #ensureTickSimilarityCache() {
    if (!this.#tickSimilarityCache) {
      this.#tickSimilarityCache = new WeakMap();
      this.#tickSimilarityVersion = this.tickCount;
    } else if (this.#tickSimilarityVersion !== this.tickCount) {
      this.#resetTickSimilarityCache();
    }

    return this.#tickSimilarityCache;
  }

  #acquireTickSimilarityRow(cell) {
    let record = this.#tickSimilarityCache.get(cell);

    if (record) {
      return record;
    }

    record = this.#tickSimilarityRowPool.pop();

    if (!record) {
      record = { map: new WeakMap(), keys: [], cell: null };
    } else {
      if (!record.map) {
        record.map = new WeakMap();
      }

      record.keys.length = 0;
    }

    record.cell = cell;
    this.#tickSimilarityCache.set(cell, record);
    this.#tickSimilarityRowsInUse.push(record);

    return record;
  }

  #resolveTargetSimilarity(cellA, cellB) {
    if (!cellA || !cellB) return 0;

    const cache = this.#ensureTickSimilarityCache();
    let recordA = cache.get(cellA);
    let mapForA = recordA?.map;

    if (!recordA) {
      recordA = this.#acquireTickSimilarityRow(cellA);
      mapForA = recordA.map;
    }

    if (mapForA.has(cellB)) {
      return mapForA.get(cellB);
    }

    let recordB = cache.get(cellB);
    let mapForB = recordB?.map;

    if (mapForB && mapForB.has(cellA)) {
      const value = mapForB.get(cellA);

      mapForA.set(cellB, value);
      recordA.keys.push(cellB);

      return value;
    }

    if (!recordB) {
      recordB = this.#acquireTickSimilarityRow(cellB);
      mapForB = recordB.map;
    }

    const value = getPairSimilarity(cellA, cellB);

    mapForA.set(cellB, value);
    recordA.keys.push(cellB);

    if (cellA !== cellB) {
      mapForB.set(cellA, value);
      recordB.keys.push(cellA);
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
    const seenTargets = new WeakSet();
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
    const occupancyColumns = this.#columnOccupancy;

    if (sight <= 0) {
      return this.#targetGroupsView;
    }

    const handleCandidate = (targetRow, targetCol, target, bucket) => {
      if (!target || (targetRow === row && targetCol === col)) {
        if (!target && bucket?.delete?.(targetCol)) {
          const columnBucket = occupancyColumns?.[targetCol];

          columnBucket?.delete?.(targetRow);
        }

        return false;
      }

      if (seenTargets.has(target)) {
        return false;
      }

      seenTargets.add(target);

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

        return true;
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

      const descriptor = this.#acquireTargetDescriptor();

      descriptor.row = targetRow;
      descriptor.col = targetCol;
      descriptor.target = target;
      descriptor.precomputedSimilarity = similarity;
      descriptor.similarity = similarity;

      if (classifyAsEnemy) {
        descriptor.classification = "enemy";
        enemies.push(descriptor);
      } else {
        descriptor.classification = "mate";
        mates.push(descriptor);
      }

      return true;
    };

    for (let targetRow = minRow; targetRow <= maxRow; targetRow++) {
      const gridRow = grid[targetRow];

      if (!gridRow) {
        const bucket = occupancyRows?.[targetRow];

        bucket?.clear?.();

        continue;
      }

      const bucket = occupancyRows?.[targetRow] ?? null;
      let processed = 0;
      let attemptedCachedScan = false;
      let rowOccupancyDirty = false;

      if (bucket && bucket.size > 0) {
        const columns = this.#getRowOccupantColumns(targetRow, bucket);

        if (Array.isArray(columns) && columns.length > 0) {
          let index = lowerBound(columns, minCol);

          while (index < columns.length) {
            const targetCol = columns[index];

            if (targetCol > maxCol) {
              break;
            }

            attemptedCachedScan = true;

            if (!bucket.has(targetCol)) {
              rowOccupancyDirty = true;
              index += 1;

              continue;
            }

            const target = gridRow[targetCol];

            if (!target) {
              rowOccupancyDirty = true;
              bucket.delete(targetCol);

              const columnBucket = occupancyColumns?.[targetCol];

              columnBucket?.delete?.(targetRow);

              const columnList = this.#columnOccupancySorted?.[targetCol];

              if (Array.isArray(columnList)) {
                const removalIndex = lowerBound(columnList, targetRow);

                if (
                  removalIndex < columnList.length &&
                  columnList[removalIndex] === targetRow
                ) {
                  columnList.splice(removalIndex, 1);
                }
              }

              index += 1;

              continue;
            }

            if (targetRow === row && targetCol === col) {
              index += 1;

              continue;
            }

            if (handleCandidate(targetRow, targetCol, target, bucket)) {
              processed += 1;
            }

            index += 1;
          }
        }
      }

      if (rowOccupancyDirty) {
        this.#getRowOccupantColumns(targetRow, bucket, { refresh: true });
      }

      if (processed === 0 && !attemptedCachedScan) {
        let columnProcessed = 0;

        if (Array.isArray(occupancyColumns)) {
          for (let targetCol = minCol; targetCol <= maxCol; targetCol++) {
            const columnBucket = occupancyColumns?.[targetCol] ?? null;

            if (!columnBucket || columnBucket.size === 0) {
              continue;
            }

            const rowsForColumn = this.#getColumnOccupantRows(targetCol, columnBucket);

            if (!Array.isArray(rowsForColumn) || rowsForColumn.length === 0) {
              continue;
            }

            let columnRowsDirty = false;
            let rowIndex = lowerBound(rowsForColumn, minRow);

            while (rowIndex < rowsForColumn.length) {
              const candidateRow = rowsForColumn[rowIndex];

              if (candidateRow > maxRow) {
                break;
              }

              if (!columnBucket.has(candidateRow)) {
                columnRowsDirty = true;
                rowIndex += 1;

                continue;
              }

              let candidateRowBucket = occupancyRows?.[candidateRow] ?? null;
              const target = this.grid[candidateRow]?.[targetCol];

              if (!target) {
                columnRowsDirty = true;
                columnBucket.delete(candidateRow);
                candidateRowBucket?.delete?.(targetCol);
                this.#getRowOccupantColumns(candidateRow, candidateRowBucket, {
                  refresh: true,
                });
                rowIndex += 1;

                continue;
              }

              if (candidateRow === row && targetCol === col) {
                rowIndex += 1;

                continue;
              }

              if (!candidateRowBucket?.has?.(targetCol)) {
                this.#recordOccupancy(candidateRow, targetCol);
                candidateRowBucket = occupancyRows?.[candidateRow] ?? null;
              }

              if (
                handleCandidate(candidateRow, targetCol, target, candidateRowBucket)
              ) {
                columnProcessed += 1;
              }

              rowIndex += 1;
            }

            if (columnRowsDirty) {
              this.#getColumnOccupantRows(targetCol, columnBucket, { refresh: true });
            }

            if (columnProcessed > 0) {
              break;
            }
          }
        }

        if (columnProcessed > 0) {
          processed += columnProcessed;
          attemptedCachedScan = true;
        }
      }

      if (processed === 0) {
        let encounteredUntracked = false;

        for (let targetCol = minCol; targetCol <= maxCol; targetCol++) {
          if (targetRow === row && targetCol === col) {
            continue;
          }

          if (bucket?.has?.(targetCol)) {
            continue;
          }

          const target = gridRow[targetCol];

          if (!target) {
            continue;
          }

          encounteredUntracked = true;

          if (handleCandidate(targetRow, targetCol, target, bucket)) {
            this.#recordOccupancy(targetRow, targetCol);
            processed += 1;
          }
        }

        if (!encounteredUntracked) {
          continue;
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
