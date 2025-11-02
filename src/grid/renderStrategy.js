const RENDER_STRATEGY_VALUES = Object.freeze(["auto", "canvas", "image-data"]);

export const RenderStrategy = Object.freeze({
  AUTO: RENDER_STRATEGY_VALUES[0],
  CANVAS: RENDER_STRATEGY_VALUES[1],
  IMAGE_DATA: RENDER_STRATEGY_VALUES[2],
});

const VALID_RENDER_STRATEGIES = new Set(RENDER_STRATEGY_VALUES);

export function isRenderStrategy(value) {
  return typeof value === "string" && VALID_RENDER_STRATEGIES.has(value);
}

export function normalizeRenderStrategy(value, defaultStrategy = RenderStrategy.AUTO) {
  if (!isRenderStrategy(defaultStrategy)) {
    throw new TypeError(
      `Invalid default render strategy: ${String(defaultStrategy)}. Expected one of ${RENDER_STRATEGY_VALUES.join(", ")}.`,
    );
  }

  if (value == null) {
    return defaultStrategy;
  }

  if (!isRenderStrategy(value)) {
    throw new TypeError(
      `Invalid render strategy: ${String(value)}. Expected one of ${RENDER_STRATEGY_VALUES.join(", ")}.`,
    );
  }

  return value;
}
