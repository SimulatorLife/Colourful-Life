import { clamp, clamp01 } from './utils.js';

export default class InteractionSystem {
  constructor({ gridManager, gridState } = {}) {
    this.gridManager = gridManager || null;
    this.gridState = gridState || null;
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
    const manager = this.gridState || this.gridManager;

    if (!manager) return false;

    const initiator = intent.initiator || intent.attacker || null;
    const target = intent.target || null;

    if (!initiator?.cell || !target) return false;

    const attacker = initiator.cell;
    const attackerRow =
      typeof initiator.row === 'number'
        ? initiator.row
        : typeof attacker.row === 'number'
          ? attacker.row
          : null;
    const attackerCol =
      typeof initiator.col === 'number'
        ? initiator.col
        : typeof attacker.col === 'number'
          ? attacker.col
          : null;

    if (attackerRow == null || attackerCol == null) return false;

    const targetRow = target.row;
    const targetCol = target.col;

    if (targetRow == null || targetCol == null) return false;

    const defender = manager.grid?.[targetRow]?.[targetCol] ?? null;

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

    const attackerTile = manager.grid?.[attackerRow]?.[attackerCol] ?? null;

    if (attackerPower >= defenderPower) {
      if (typeof manager.removeCell === 'function') manager.removeCell(targetRow, targetCol);
      else if (manager.grid?.[targetRow]) manager.grid[targetRow][targetCol] = null;

      let relocated = false;

      if (typeof manager.relocateCell === 'function') {
        relocated = manager.relocateCell(attackerRow, attackerCol, targetRow, targetCol);
      }

      if (!relocated) {
        if (manager.grid?.[targetRow]) manager.grid[targetRow][targetCol] = attacker;
        if (manager.grid?.[attackerRow]) manager.grid[attackerRow][attackerCol] = null;
        attacker.row = targetRow;
        attacker.col = targetCol;
      }

      if (typeof manager.consumeEnergy === 'function') {
        manager.consumeEnergy(
          attacker,
          targetRow,
          targetCol,
          densityGrid ?? manager.densityGrid,
          densityEffectMultiplier
        );
      }

      stats?.onFight?.();
      stats?.onDeath?.();
      attacker.fightsWon = (attacker.fightsWon || 0) + 1;
      defender.fightsLost = (defender.fightsLost || 0) + 1;

      return true;
    }

    if (attackerTile === attacker && typeof manager.removeCell === 'function') {
      manager.removeCell(attackerRow, attackerCol);
    } else if (attackerTile === attacker && manager.grid?.[attackerRow]) {
      manager.grid[attackerRow][attackerCol] = null;
    }

    stats?.onFight?.();
    stats?.onDeath?.();
    defender.fightsWon = (defender.fightsWon || 0) + 1;
    attacker.fightsLost = (attacker.fightsLost || 0) + 1;

    return true;
  }

  #resolveCooperation(intent, { stats } = {}) {
    const manager = this.gridState || this.gridManager;

    if (!manager) return false;

    const initiator = intent.initiator || null;
    const target = intent.target || null;

    if (!initiator?.cell || !target) return false;

    const actor = initiator.cell;
    const targetRow = target.row;
    const targetCol = target.col;

    if (targetRow == null || targetCol == null) return false;

    const partner = manager.grid?.[targetRow]?.[targetCol] ?? null;

    if (!partner) return false;

    const shareFraction = clamp01(intent.metadata?.shareFraction);
    const maxTileEnergy = manager.maxTileEnergy ?? 0;
    const available = Math.max(0, actor.energy * shareFraction);
    const shareAmount = Math.min(maxTileEnergy, available);

    if (shareAmount <= 0) return false;

    actor.energy = Math.max(0, actor.energy - shareAmount);
    partner.energy = Math.min(maxTileEnergy, (partner.energy ?? 0) + shareAmount);

    stats?.onCooperate?.();

    return true;
  }
}
