import { warnOnce, invokeWithErrorBoundary } from "../utils/error.js";

function isFunction(fn) {
  return typeof fn === "function";
}

const ALLOW_ALL = Object.freeze({ allowed: true });

const WARNINGS = Object.freeze({
  activeZones:
    "Selection manager threw while resolving whether reproduction zones are active.",
  validation: "Selection manager threw during reproduction validation.",
  membership:
    "Selection manager threw while evaluating spawn candidate zone membership.",
});

function coerceValidationResult(result) {
  if (result && typeof result === "object" && "allowed" in result) {
    return result;
  }

  return ALLOW_ALL;
}

/**
 * Provides a narrow facade between {@link GridManager}'s reproduction logic and
 * optional selection managers. The adapter keeps grid code agnostic to the
 * concrete selection implementation while still supporting behavioural
 * features—zone validation and spawn filtering—when a manager is supplied.
 */
export default class ReproductionZonePolicy {
  #selectionManager = null;

  constructor({ selectionManager = null } = {}) {
    if (selectionManager) {
      this.setSelectionManager(selectionManager);
    }
  }

  getSelectionManager() {
    return this.#selectionManager;
  }

  setSelectionManager(selectionManager) {
    if (selectionManager && typeof selectionManager !== "object") {
      warnOnce("Selection manager must be an object; ignoring assignment.");

      return;
    }

    this.#selectionManager = selectionManager ?? null;
  }

  hasActiveZones() {
    const manager = this.#selectionManager;

    if (!manager || !isFunction(manager.hasActiveZones)) {
      return false;
    }

    const result = invokeWithErrorBoundary(manager.hasActiveZones, [], {
      thisArg: manager,
      message: WARNINGS.activeZones,
      reporter: warnOnce,
      once: true,
    });

    return Boolean(result);
  }

  validateArea({ parentA, parentB, spawn } = {}) {
    const manager = this.#selectionManager;

    if (!manager || !isFunction(manager.validateReproductionArea)) {
      return ALLOW_ALL;
    }

    const result = invokeWithErrorBoundary(
      manager.validateReproductionArea,
      [{ parentA, parentB, spawn }],
      {
        thisArg: manager,
        message: WARNINGS.validation,
        reporter: warnOnce,
        once: true,
      },
    );

    return coerceValidationResult(result);
  }

  filterSpawnCandidates(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return candidates;
    }

    const manager = this.#selectionManager;

    if (!manager || !this.hasActiveZones()) {
      return candidates;
    }

    const tester = manager.isInActiveZone;

    if (!isFunction(tester)) {
      return candidates;
    }

    let encounteredError = false;
    const boundaryArgs = [0, 0];
    const boundaryOptions = {
      thisArg: manager,
      message: WARNINGS.membership,
      reporter: warnOnce,
      once: true,
      onError: () => {
        encounteredError = true;
      },
    };

    const filtered = candidates.filter((candidate) => {
      if (!candidate) {
        return false;
      }

      if (encounteredError) {
        return true;
      }

      boundaryArgs[0] = candidate.r;
      boundaryArgs[1] = candidate.c;

      const result = invokeWithErrorBoundary(tester, boundaryArgs, boundaryOptions);

      return Boolean(result);
    });

    if (encounteredError) {
      return candidates;
    }

    return filtered.length > 0 ? filtered : candidates;
  }

  clearActiveZones() {
    const manager = this.#selectionManager;

    if (!manager) {
      return;
    }

    if (typeof manager.clearActiveZones === "function") {
      manager.clearActiveZones();

      return;
    }

    if (
      typeof manager.getPatterns === "function" &&
      typeof manager.togglePattern === "function"
    ) {
      const patterns = manager.getPatterns();

      if (Array.isArray(patterns)) {
        for (const pattern of patterns) {
          if (pattern?.id) {
            manager.togglePattern(pattern.id, false);
          }
        }
      }
    }
  }
}
