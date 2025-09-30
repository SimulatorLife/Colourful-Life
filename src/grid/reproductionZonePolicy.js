import { warnOnce } from '../utils.js';

function isFunction(fn) {
  return typeof fn === 'function';
}

const ALLOW_ALL = Object.freeze({ allowed: true });

function coerceValidationResult(result) {
  if (result && typeof result === 'object' && 'allowed' in result) {
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
    if (selectionManager && typeof selectionManager !== 'object') {
      warnOnce('Selection manager must be an object; ignoring assignment.');

      return;
    }

    this.#selectionManager = selectionManager ?? null;
  }

  hasActiveZones() {
    const manager = this.#selectionManager;

    return Boolean(manager && isFunction(manager.hasActiveZones) && manager.hasActiveZones());
  }

  validateArea({ parentA, parentB, spawn } = {}) {
    const manager = this.#selectionManager;

    if (!manager || !isFunction(manager.validateReproductionArea)) {
      return ALLOW_ALL;
    }

    try {
      return coerceValidationResult(manager.validateReproductionArea({ parentA, parentB, spawn }));
    } catch (error) {
      warnOnce('Selection manager threw during reproduction validation.', error);

      return ALLOW_ALL;
    }
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

    const filtered = candidates.filter(({ r, c }) => tester.call(manager, r, c));

    return filtered.length > 0 ? filtered : candidates;
  }
}
