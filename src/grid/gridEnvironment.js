import { pickFirstFinitePositive } from "../utils/math.js";

const GLOBAL_SCOPE = typeof globalThis !== "undefined" ? globalThis : {};

function pickDefined(...candidates) {
  return candidates.find((candidate) => candidate !== undefined);
}

function extractEnvironment(options) {
  if (!options || typeof options !== "object") {
    return null;
  }

  const { environment } = options;

  return environment && typeof environment === "object" ? environment : null;
}

function resolveEventManager(options, environment, fallback) {
  return pickDefined(
    options.eventManager,
    environment?.eventManager,
    fallback?.eventManager,
  );
}

function resolveCtx(options, environment, fallback) {
  const candidate = pickDefined(options.ctx, environment?.ctx, fallback?.ctx);

  return candidate ?? null;
}

function resolveStats(options, environment, fallback) {
  return pickDefined(options.stats, environment?.stats, fallback?.stats);
}

function resolveCellSize(options, environment, fallback) {
  const fallbackCellSize = fallback?.cellSize;

  return pickFirstFinitePositive(
    [options.cellSize, environment?.cellSize, fallbackCellSize],
    8,
  );
}

/**
 * Normalises rendering and event dependencies consumed by {@link GridManager}.
 * Consumers can explicitly provide dependencies via constructor options or
 * configure an `environment` object containing defaults. When omitted, the
 * resolver falls back to `globalThis` so legacy behaviour remains intact while
 * allowing tests and headless contexts to inject isolated dependencies.
 *
 * @param {Object} [options]
 * @param {Object} [options.eventManager]
 * @param {Object} [options.ctx]
 * @param {number} [options.cellSize]
 * @param {Object} [options.stats]
 * @param {Object} [options.environment]
 * @returns {{eventManager: any, ctx: any, cellSize: number, stats: any}}
 */
export function resolveGridEnvironment(options = {}, fallbackScope = GLOBAL_SCOPE) {
  const environment = extractEnvironment(options);
  const fallback =
    fallbackScope && typeof fallbackScope === "object" ? fallbackScope : GLOBAL_SCOPE;

  const eventManager = resolveEventManager(options, environment, fallback);
  const ctx = resolveCtx(options, environment, fallback);
  const stats = resolveStats(options, environment, fallback);
  const cellSize = resolveCellSize(options, environment, fallback);

  return { eventManager, ctx, stats, cellSize };
}
