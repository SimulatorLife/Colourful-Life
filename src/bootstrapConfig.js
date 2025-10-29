import { toPlainObject } from "./utils/object.js";

const DEFAULT_CANVAS_ID = "gameCanvas";
const DEFAULT_BOOT_CONFIG = Object.freeze({
  cellSize: 5,
});

function toNonEmptyString(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : "";
}

function resolveCanvas({ canvas, canvasId }, documentRef) {
  if (canvas && typeof canvas === "object") {
    return canvas;
  }

  const doc =
    documentRef && typeof documentRef.getElementById === "function"
      ? documentRef
      : null;

  if (typeof canvas === "string" && doc) {
    const directMatch = toNonEmptyString(canvas);

    if (directMatch) {
      const byId = doc.getElementById(directMatch);

      if (byId) {
        return byId;
      }

      if (typeof doc.querySelector === "function") {
        const bySelector = doc.querySelector(directMatch);

        if (bySelector) {
          return bySelector;
        }
      }
    }
  }

  if (!doc) {
    return null;
  }

  const fallbackId = toNonEmptyString(canvasId) || DEFAULT_CANVAS_ID;

  return doc.getElementById(fallbackId);
}

function mergeConfig(defaults, overrides) {
  const base = { ...defaults };
  const source = toPlainObject(overrides);

  for (const [key, value] of Object.entries(source)) {
    base[key] = value;
  }

  return base;
}

/**
 * Normalizes the options forwarded to {@link createSimulation} during browser
 * bootstrapping. Consumers can populate `globalThis.COLOURFUL_LIFE_BOOT_OPTIONS`
 * with overrides such as `{ canvasId: "custom", config: { cellSize: 8 } }`
 * before loading the bundle to tweak the startup behaviour without editing the
 * entry script.
 *
 * @param {{ globalOptions?: object|null, documentRef?: Document|null }} [options]
 *   Raw bootstrap context.
 * @returns {object} Sanitized options ready for {@link createSimulation}.
 */
export function resolveBootstrapOptions({ globalOptions, documentRef } = {}) {
  const overrides = toPlainObject(globalOptions);
  const canvasId = toNonEmptyString(overrides.canvasId);
  const canvas = resolveCanvas({ canvas: overrides.canvas, canvasId }, documentRef);
  const config = mergeConfig(DEFAULT_BOOT_CONFIG, overrides.config);
  const { canvasId: _ignoredCanvasId, ...rest } = overrides;
  const result = { ...rest, canvas, config };

  if (!Object.hasOwn(result, "defaultCanvasId")) {
    result.defaultCanvasId = canvasId || DEFAULT_CANVAS_ID;
  }

  return result;
}

export const __test__ = { DEFAULT_CANVAS_ID, DEFAULT_BOOT_CONFIG };
