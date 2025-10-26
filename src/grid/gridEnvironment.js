const GLOBAL_SCOPE = typeof globalThis !== "undefined" ? globalThis : {};

function pickDefined(...candidates) {
  return candidates.find((candidate) => candidate !== undefined);
}

function resolveEventManager(options, fallback) {
  const environment =
    options.environment && typeof options.environment === "object"
      ? options.environment
      : null;

  return pickDefined(
    options.eventManager,
    environment?.eventManager,
    fallback?.eventManager,
  );
}

function resolveCtx(options, fallback) {
  const environment =
    options.environment && typeof options.environment === "object"
      ? options.environment
      : null;

  const candidate = pickDefined(options.ctx, environment?.ctx, fallback?.ctx);

  return candidate ?? null;
}

function resolveStats(options, fallback) {
  const environment =
    options.environment && typeof options.environment === "object"
      ? options.environment
      : null;

  return pickDefined(options.stats, environment?.stats, fallback?.stats);
}

function resolveCellSize(options, fallback) {
  const environment =
    options.environment && typeof options.environment === "object"
      ? options.environment
      : null;

  // Avoid the temporary array + map + find churn in the previous implementation.
  // This helper sits on the grid initialisation hot path, so a tiny reduction in
  // allocations and predicate calls keeps repeated environment resolution cheap.
  const optionCandidate = options.cellSize;

  if (optionCandidate != null) {
    const numeric = Number(optionCandidate);

    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }

  if (environment) {
    const environmentCandidate = environment.cellSize;

    if (environmentCandidate != null) {
      const numeric = Number(environmentCandidate);

      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }

  if (fallback) {
    const fallbackCandidate = fallback.cellSize;

    if (fallbackCandidate != null) {
      const numeric = Number(fallbackCandidate);

      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
  }

  return 8;
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
  const eventManager = resolveEventManager(options, fallbackScope);
  const ctx = resolveCtx(options, fallbackScope);
  const stats = resolveStats(options, fallbackScope);
  const cellSize = resolveCellSize(options, fallbackScope);

  return { eventManager, ctx, stats, cellSize };
}
