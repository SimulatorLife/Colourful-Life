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

export function resolveCanvas(canvas, documentRef) {
  if (canvas) return canvas;

  if (documentRef && typeof documentRef.getElementById === "function") {
    return documentRef.getElementById("gameCanvas");
  }

  return null;
}

export function ensureCanvasDimensions(canvas, config) {
  const toFiniteDimension = (value) => {
    if (value == null) return null;

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed.length === 0) return null;

      const parsed = Number.parseFloat(trimmed);

      return Number.isFinite(parsed) ? parsed : null;
    }

    if (typeof value === "bigint") {
      const numeric = Number(value);

      return Number.isFinite(numeric) ? numeric : null;
    }

    const numeric = Number(value);

    return Number.isFinite(numeric) ? numeric : null;
  };

  const pickDimension = (candidates) => {
    for (const candidate of candidates) {
      const normalized = toFiniteDimension(candidate);

      if (normalized != null) {
        return normalized;
      }
    }

    return null;
  };

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

  const canvasWidth = toFiniteDimension(canvas?.width);
  const canvasHeight = toFiniteDimension(canvas?.height);

  if (canvasWidth != null && canvasHeight != null) {
    return { width: canvasWidth, height: canvasHeight };
  }

  if (width != null && height != null) {
    return { width, height };
  }

  throw new Error("SimulationEngine requires canvas dimensions to be specified.");
}

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
