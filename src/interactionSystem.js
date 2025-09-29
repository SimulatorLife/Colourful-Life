import { clamp, clamp01 } from './utils.js';
import GridInteractionAdapter from './grid/gridAdapter.js';

function asFiniteCoordinate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolveCoordinates(preferred, fallback = null) {
  const primaryRow = asFiniteCoordinate(preferred?.row);
  const primaryCol = asFiniteCoordinate(preferred?.col);
  const fallbackRow = asFiniteCoordinate(fallback?.row);
  const fallbackCol = asFiniteCoordinate(fallback?.col);

  return {
    row: primaryRow ?? fallbackRow,
    col: primaryCol ?? fallbackCol,
  };
}

function getAdapterCell(adapter, row, col) {
  return adapter?.getCell?.(row, col) ?? null;
}

function clearAdapterCell(adapter, row, col) {
  if (!adapter) return;

  if (typeof adapter.removeCell === 'function') {
    adapter.removeCell(row, col);
  } else if (typeof adapter.setCell === 'function') {
    adapter.setCell(row, col, null);
  }
}

function placeAdapterCell(adapter, row, col, cell) {
  adapter?.setCell?.(row, col, cell);
}

export default class InteractionSystem {
  constructor({ adapter, gridManager } = {}) {
    if (adapter) {
      this.adapter = adapter;
    } else if (gridManager) {
      this.adapter = new GridInteractionAdapter({ gridManager });
    } else {
      this.adapter = null;
    }
    this.pendingIntents = [];
  }

  submitIntent(intent) {
    if (!intent || typeof intent !== 'object') return false;

    this.pendingIntents.push(intent);

    return true;
  }

  process({ stats, densityGrid, densityEffectMultiplier } = {}) {
    let processed = false;

    while (this.pendingIntents.length > 0) {
      const intent = this.pendingIntents.shift();

      processed =
        this.resolveIntent(intent, { stats, densityGrid, densityEffectMultiplier }) || processed;
    }

    return processed;
  }

  resolveIntent(intent, { stats, densityGrid, densityEffectMultiplier } = {}) {
    if (!intent || typeof intent !== 'object') return false;

    switch (intent.type) {
      case 'fight':
        return this.#resolveFight(intent, { stats, densityGrid, densityEffectMultiplier });
      case 'cooperate':
        return this.#resolveCooperation(intent, { stats });
      default:
        return false;
    }
  }

  #resolveFight(intent, { stats, densityGrid, densityEffectMultiplier } = {}) {
    const adapter = this.adapter;

    if (!adapter) return false;

    const initiator = intent.initiator || intent.attacker || null;
    const target = intent.target || null;

    if (!initiator?.cell || !target) return false;

    const attacker = initiator.cell;
    const { row: attackerRow, col: attackerCol } = resolveCoordinates(initiator, attacker);

    if (attackerRow == null || attackerCol == null) return false;

    const { row: targetRow, col: targetCol } = resolveCoordinates(target);

    if (targetRow == null || targetCol == null) return false;

    const defender = getAdapterCell(adapter, targetRow, targetCol);

    if (!defender) return false;

    const attackerAgeScale =
      typeof attacker.ageEnergyMultiplier === 'function' ? attacker.ageEnergyMultiplier(1) : 1;
    const defenderAgeScale =
      typeof defender.ageEnergyMultiplier === 'function' ? defender.ageEnergyMultiplier(1) : 1;
    const attackerCost =
      (typeof attacker.dna?.fightCost === 'function' ? attacker.dna.fightCost() : 0) *
      attackerAgeScale;
    const defenderCost =
      (typeof defender.dna?.fightCost === 'function' ? defender.dna.fightCost() : 0) *
      defenderAgeScale;

    attacker.energy = Math.max(0, attacker.energy - attackerCost);
    defender.energy = Math.max(0, defender.energy - defenderCost);

    const attackerPower = attacker.energy * (attacker.dna?.combatPower?.() ?? 1);
    const defenderPower = defender.energy * (defender.dna?.combatPower?.() ?? 1);

    const attackerTile = getAdapterCell(adapter, attackerRow, attackerCol);

    if (attackerPower >= defenderPower) {
      clearAdapterCell(adapter, targetRow, targetCol);

      let relocated = false;

      if (typeof adapter.relocateCell === 'function') {
        relocated = adapter.relocateCell(attackerRow, attackerCol, targetRow, targetCol);
      }

      if (!relocated) {
        if (attackerTile === attacker) {
          clearAdapterCell(adapter, attackerRow, attackerCol);
        }

        placeAdapterCell(adapter, targetRow, targetCol, attacker);
        if ('row' in attacker) attacker.row = targetRow;
        if ('col' in attacker) attacker.col = targetCol;
      }

      if (typeof adapter.consumeTileEnergy === 'function') {
        adapter.consumeTileEnergy({
          cell: attacker,
          row: targetRow,
          col: targetCol,
          densityGrid,
          densityEffectMultiplier,
        });
      }

      stats?.onFight?.();
      stats?.onDeath?.();
      attacker.fightsWon = (attacker.fightsWon || 0) + 1;
      defender.fightsLost = (defender.fightsLost || 0) + 1;

      return true;
    }

    if (attackerTile === attacker) {
      clearAdapterCell(adapter, attackerRow, attackerCol);
    }

    stats?.onFight?.();
    stats?.onDeath?.();
    defender.fightsWon = (defender.fightsWon || 0) + 1;
    attacker.fightsLost = (attacker.fightsLost || 0) + 1;

    return true;
  }

  #resolveCooperation(intent, { stats } = {}) {
    const adapter = this.adapter;

    if (!adapter) return false;

    const initiator = intent.initiator || null;
    const target = intent.target || null;

    if (!initiator?.cell || !target) return false;

    const actor = initiator.cell;
    const targetRow = target.row;
    const targetCol = target.col;

    if (targetRow == null || targetCol == null) return false;

    const partner = adapter.getCell?.(targetRow, targetCol) ?? null;

    if (!partner) return false;

    const shareFraction = clamp01(intent.metadata?.shareFraction);
    const maxTileEnergy = typeof adapter.maxTileEnergy === 'function' ? adapter.maxTileEnergy() : 0;
    const available = Math.max(0, actor.energy * shareFraction);
    const shareAmount = Math.min(maxTileEnergy, available);

    if (shareAmount <= 0) return false;

    const transferred =
      typeof adapter.transferEnergy === 'function'
        ? adapter.transferEnergy({ from: actor, to: partner, amount: shareAmount })
        : 0;

    if (transferred <= 0) return false;

    stats?.onCooperate?.();

    return true;
  }
}
