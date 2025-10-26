import { pickFirstFinitePositive, toFiniteOrNull } from "../utils/math.js";
import { toPlainObject } from "../utils/object.js";

const GLOBAL = typeof globalThis !== "undefined" ? globalThis : {};

const defaultNow = () => {
  const perf = GLOBAL.performance;

  if (perf && typeof perf.now === "function") {
    return perf.now();
  }

  return Date.now();
};

const defaultRequestAnimationFrame = (cb) => setTimeout(() => cb(defaultNow()), 16);
const defaultCancelAnimationFrame = (id) => clearTimeout(id);

/**
 * Determines appropriate dimensions for a headless/offscreen canvas based on
 * the supplied configuration. Mirrors the heuristics used by the browser entry
 * point so scripted runs produce consistent render sizes without depending on
 * DOM measurements.
 *
 * @param {Object} [config]
 * @returns {{width:number,height:number}} Normalized canvas dimensions.
 */
export function resolveHeadlessCanvasSize(config = {}) {
  const rawCellSize = toFiniteOrNull(config?.cellSize);
  const cellSize = rawCellSize != null && rawCellSize > 0 ? rawCellSize : 5;
  const rawRows = toFiniteOrNull(config?.rows);
  const rawCols = toFiniteOrNull(config?.cols);
  const rows = rawRows != null && rawRows > 0 ? rawRows : null;
  const cols = rawCols != null && rawCols > 0 ? rawCols : null;
  const defaultWidth = (cols ?? 120) * cellSize;
  const defaultHeight = (rows ?? 120) * cellSize;

  return {
    width: pickFirstFinitePositive(
      [
        config?.width,
        config?.canvasWidth,
        config?.canvasSize?.width,
        cols != null ? cols * cellSize : null,
      ],
      defaultWidth,
    ),
    height: pickFirstFinitePositive(
      [
        config?.height,
        config?.canvasHeight,
        config?.canvasSize?.height,
        rows != null ? rows * cellSize : null,
      ],
      defaultHeight,
    ),
  };
}

/**
 * Builds a stub 2D canvas implementation for headless environments. The
 * returned object satisfies the minimal surface expected by the rendering
 * pipeline while deferring all drawing operations.
 *
 * @param {Object} [config]
 * @returns {{width:number,height:number,getContext:(type:string)=>CanvasRenderingContext2D|null}}
 *   Headless canvas shim used by {@link SimulationEngine} during tests.
 */
export function createHeadlessCanvas(config = {}) {
  const { width, height } = resolveHeadlessCanvasSize(config);
  const context = {
    canvas: null,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
    imageSmoothingEnabled: false,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fill() {},
    translate() {},
    setTransform() {},
    resetTransform() {},
    scale() {},
    drawImage() {},
    createLinearGradient() {
      return {
        addColorStop() {},
      };
    },
    fillText() {},
    strokeText() {},
  };
  const canvas = {
    width,
    height,
    getContext(type) {
      if (type !== "2d") return null;

      return context;
    },
  };

  context.canvas = canvas;

  return canvas;
}

/**
 * Derives width/height overrides for headless canvases so both the generated
 * canvas and simulation config stay in sync. Returns `null` when no positive
 * dimensions are supplied by the resolver.
 *
 * @param {Object} config - Simulation configuration containing optional
 *   `canvasSize` overrides.
 * @param {{width?:number,height?:number}|null} size - Canvas dimensions
 *   returned by {@link resolveHeadlessCanvasSize}.
 * @returns {Object|null} Override object suitable for merging into the
 *   simulation config or `null` when no overrides are required.
 */
export function buildHeadlessCanvasOverrides(config, size) {
  if (!size) return null;

  const width = Number.isFinite(size.width) && size.width > 0 ? size.width : null;
  const height = Number.isFinite(size.height) && size.height > 0 ? size.height : null;

  if (width == null && height == null) {
    return null;
  }

  const canvasSize = { ...toPlainObject(config?.canvasSize) };

  if (width != null) {
    canvasSize.width = width;
  }

  if (height != null) {
    canvasSize.height = height;
  }

  const overrides = {
    canvasSize,
  };

  if (width != null) {
    overrides.width = width;
    overrides.canvasWidth = width;
  }

  if (height != null) {
    overrides.height = height;
    overrides.canvasHeight = height;
  }

  return overrides;
}

/**
 * Resolves the canvas element the simulation should render into.
 *
 * Consumers can supply an explicit `HTMLCanvasElement` (or compatible
 * offscreen canvas). When omitted, the helper attempts to locate the
 * `#gameCanvas` element on the provided document reference. Returning `null`
 * allows callers to detect the missing canvas and surface a descriptive error.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas|null} canvas - Preferred canvas
 *   instance supplied by the embedding context.
 * @param {Document|undefined} documentRef - Document used to look up the
 *   default canvas when one is not provided explicitly.
 * @returns {HTMLCanvasElement|OffscreenCanvas|null} Canvas element or `null`
 *   when unavailable.
 */
export function resolveCanvas(canvas, documentRef) {
  if (canvas) return canvas;

  if (documentRef && typeof documentRef.getElementById === "function") {
    return documentRef.getElementById("gameCanvas");
  }

  return null;
}

/**
 * Applies width/height overrides to the supplied canvas and returns the active
 * dimensions. The helper inspects both the configuration object and the
 * existing canvas element, ensuring the engine receives concrete measurements
 * even when callers pass strings or BigInts.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas - Canvas to size.
 * @param {{width?:number|string, height?:number|string, canvasWidth?:number|string,
 *   canvasHeight?:number|string, canvasSize?:{width?:number|string,height?:number|string}}} config
 *   - Dimension overrides accepted by {@link SimulationEngine}.
 * @returns {{width:number,height:number}} Active canvas width and height.
 * @throws {Error} When no width/height can be resolved.
 */
export function ensureCanvasDimensions(canvas, config) {
  const toPositiveDimension = (candidate) => {
    const numeric = toFiniteOrNull(candidate);

    return numeric != null && numeric > 0 ? numeric : null;
  };

  const pickDimension = (candidates) =>
    candidates.reduce(
      (selected, candidate) => selected ?? toPositiveDimension(candidate),
      null,
    );

  const width = pickDimension([
    config?.width,
    config?.canvasWidth,
    config?.canvasSize?.width,
    canvas?.width,
  ]);
  const height = pickDimension([
    config?.height,
    config?.canvasHeight,
    config?.canvasSize?.height,
    canvas?.height,
  ]);

  if (canvas && width != null) canvas.width = width;
  if (canvas && height != null) canvas.height = height;

  const canvasWidth = toPositiveDimension(canvas?.width);
  const canvasHeight = toPositiveDimension(canvas?.height);

  if (canvasWidth != null && canvasHeight != null) {
    return { width: canvasWidth, height: canvasHeight };
  }

  if (width != null && height != null) {
    return { width, height };
  }

  throw new Error("SimulationEngine requires canvas dimensions to be specified.");
}

/**
 * Resolves the timing primitives used by {@link SimulationEngine}. Callers can
 * inject custom implementations (e.g. for tests or headless environments).
 * Fallbacks mirror browser behaviour to keep the engine portable.
 *
 * @param {{window?:Window, requestAnimationFrame?:Function,
 *   cancelAnimationFrame?:Function, performanceNow?:Function}} [options]
 *   - Optional overrides for timing hooks.
 * @returns {{now:()=>number, raf:(cb:FrameRequestCallback)=>number,
 *   caf:(handle:number)=>void}} Normalized timing providers.
 */
export function resolveTimingProviders({
  window: injectedWindow,
  requestAnimationFrame,
  cancelAnimationFrame,
  performanceNow,
} = {}) {
  const win = injectedWindow ?? null;

  const now =
    typeof performanceNow === "function"
      ? performanceNow
      : typeof win?.performance?.now === "function"
        ? win.performance.now.bind(win.performance)
        : defaultNow;

  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : typeof win?.requestAnimationFrame === "function"
        ? win.requestAnimationFrame.bind(win)
        : defaultRequestAnimationFrame;

  const caf =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : typeof win?.cancelAnimationFrame === "function"
        ? win.cancelAnimationFrame.bind(win)
        : defaultCancelAnimationFrame;

  return { now, raf, caf };
}
