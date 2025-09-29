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

function computeAgeEnergyScale(cell) {
  return typeof cell?.ageEnergyMultiplier === 'function' ? cell.ageEnergyMultiplier(1) : 1;
}

function computeFightCost(cell) {
  const baseCost = typeof cell?.dna?.fightCost === 'function' ? cell.dna.fightCost() : 0;

  return baseCost * computeAgeEnergyScale(cell);
}

function computeCombatPower(cell) {
  const modifier = cell?.dna?.combatPower?.() ?? 1;

  return cell?.energy * modifier;
}

function subtractEnergy(cell, amount) {
  if (!cell) return;

  const current = typeof cell.energy === 'number' ? cell.energy : Number.NaN;

  cell.energy = Math.max(0, current - amount);
}

function applyFightCost(cell) {
  if (!cell) return;

  const cost = computeFightCost(cell);

  subtractEnergy(cell, cost);
}

function recordFight(stats, winner, loser) {
  stats?.onFight?.();
  stats?.onDeath?.();

  if (winner) {
    winner.fightsWon = (winner.fightsWon || 0) + 1;
  }

  if (loser) {
    loser.fightsLost = (loser.fightsLost || 0) + 1;
  }
}

function moveVictoriousAttacker({
  adapter,
  attacker,
  attackerRow,
  attackerCol,
  targetRow,
  targetCol,
  attackerTile,
  densityGrid,
  densityEffectMultiplier,
}) {
  let relocated = false;

  if (typeof adapter?.relocateCell === 'function') {
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

  if (typeof adapter?.consumeTileEnergy === 'function') {
    adapter.consumeTileEnergy({
      cell: attacker,
      row: targetRow,
      col: targetCol,
      densityGrid,
      densityEffectMultiplier,
    });
  }
}

function prepareFightParticipants({ adapter, initiator, target }) {
  if (!adapter || !initiator?.cell || !target) return null;

  const attacker = initiator.cell;
  const { row: attackerRow, col: attackerCol } = resolveCoordinates(initiator, attacker);

  if (attackerRow == null || attackerCol == null) return null;

  const { row: targetRow, col: targetCol } = resolveCoordinates(target);

  if (targetRow == null || targetCol == null) return null;

  const defender = getAdapterCell(adapter, targetRow, targetCol);

  if (!defender) return null;

  return { attacker, defender, attackerRow, attackerCol, targetRow, targetCol };
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

    const participants = prepareFightParticipants({ adapter, initiator, target });

    if (!participants) return false;

    const { attacker, defender, attackerRow, attackerCol, targetRow, targetCol } = participants;

    applyFightCost(attacker);
    applyFightCost(defender);

    const attackerPower = computeCombatPower(attacker);
    const defenderPower = computeCombatPower(defender);

    const attackerTile = getAdapterCell(adapter, attackerRow, attackerCol);

    if (attackerPower >= defenderPower) {
      clearAdapterCell(adapter, targetRow, targetCol);
      moveVictoriousAttacker({
        adapter,
        attacker,
        attackerRow,
        attackerCol,
        targetRow,
        targetCol,
        attackerTile,
        densityGrid,
        densityEffectMultiplier,
      });

      recordFight(stats, attacker, defender);

      return true;
    }

    if (attackerTile === attacker) {
      clearAdapterCell(adapter, attackerRow, attackerCol);
    }

    recordFight(stats, defender, attacker);

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
