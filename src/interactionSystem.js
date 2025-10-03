import { clamp, clamp01 } from "./utils.js";
import GridInteractionAdapter from "./grid/gridAdapter.js";
import {
  COMBAT_EDGE_SHARPNESS_DEFAULT,
  COMBAT_TERRITORY_EDGE_FACTOR,
} from "./config.js";

function asFiniteCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Picks the first available row/column pair, preferring the `preferred`
 * location and only falling back when coordinates are missing or non-finite.
 * The helper keeps intent explicit at call sites so complex movement flows
 * highlight where we gracefully degrade to historical coordinates.
 */
function pickCoordinatesWithFallback(preferred, fallback = null) {
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

  if (typeof adapter.removeCell === "function") {
    adapter.removeCell(row, col);
  } else if (typeof adapter.setCell === "function") {
    adapter.setCell(row, col, null);
  }
}

function placeAdapterCell(adapter, row, col, cell) {
  adapter?.setCell?.(row, col, cell);
}

function resolveAdapterOccupant(adapter, location, fallback = location?.cell ?? null) {
  if (!adapter) return null;

  const { row, col } = pickCoordinatesWithFallback(location, fallback);

  if (row == null || col == null) {
    return null;
  }

  const cell = getAdapterCell(adapter, row, col);

  return cell ? { cell, row, col } : null;
}

function computeAgeEnergyScale(cell) {
  return typeof cell?.ageEnergyMultiplier === "function"
    ? cell.ageEnergyMultiplier(1)
    : 1;
}

function computeFightCost(cell) {
  const baseCost =
    typeof cell?.dna?.fightCost === "function" ? cell.dna.fightCost() : 0;

  return baseCost * computeAgeEnergyScale(cell);
}

function computeCombatPower(cell) {
  const modifier = cell?.dna?.combatPower?.() ?? 1;

  return cell?.energy * modifier;
}

function resolveCombatSharpness(cell) {
  const fn = cell?.dna?.combatEdgeSharpness;

  if (typeof fn !== "function") return 1;

  const value = Number(fn.call(cell?.dna));

  if (!Number.isFinite(value)) return 1;

  return clamp(value, 0.25, 4);
}

function resolveTrait01(cell, traitName, fallback = 0.5) {
  if (cell && typeof cell.resolveTrait === "function") {
    const dynamic = cell.resolveTrait(traitName);

    if (Number.isFinite(dynamic)) {
      return clamp01(dynamic);
    }
  }

  const trait = cell?.dna?.[traitName];

  if (typeof trait !== "function") return fallback;

  const value = Number(trait.call(cell.dna));

  if (!Number.isFinite(value)) return fallback;

  return clamp01(value);
}

function computeDensityAdvantage({
  adapter,
  attackerRow,
  attackerCol,
  targetRow,
  targetCol,
  densityGrid,
  densityEffectMultiplier,
  territoryEdgeFactor = COMBAT_TERRITORY_EDGE_FACTOR,
}) {
  if (!adapter) return 0;

  const attackerDensity = clamp01(
    adapter.densityAt?.(attackerRow, attackerCol, { densityGrid }) ?? 0,
  );
  const defenderDensity = clamp01(
    adapter.densityAt?.(targetRow, targetCol, { densityGrid }) ?? 0,
  );
  const densityDelta = clamp(attackerDensity - defenderDensity, -1, 1);
  const effect = Number.isFinite(densityEffectMultiplier) ? densityEffectMultiplier : 1;
  const edgeFactor = Number.isFinite(territoryEdgeFactor)
    ? clamp(territoryEdgeFactor, 0, 1)
    : COMBAT_TERRITORY_EDGE_FACTOR;

  return densityDelta * clamp(effect, 0, 2) * edgeFactor;
}

function computeCombatOdds({
  attacker,
  defender,
  attackerPower,
  defenderPower,
  adapter,
  attackerRow,
  attackerCol,
  targetRow,
  targetCol,
  densityGrid,
  densityEffectMultiplier,
  combatEdgeSharpness = COMBAT_EDGE_SHARPNESS_DEFAULT,
  combatTerritoryEdgeFactor = COMBAT_TERRITORY_EDGE_FACTOR,
}) {
  const totalPower = Math.abs(attackerPower) + Math.abs(defenderPower);
  const baseEdge =
    totalPower > 0 ? clamp((attackerPower - defenderPower) / totalPower, -1, 1) : 0;
  const riskEdge =
    (resolveTrait01(attacker, "riskTolerance") -
      resolveTrait01(defender, "riskTolerance")) *
    0.2;
  const resilienceEdge =
    (resolveTrait01(attacker, "recoveryRate") -
      resolveTrait01(defender, "recoveryRate")) *
    0.15;
  const territoryFactor = Number.isFinite(combatTerritoryEdgeFactor)
    ? clamp(combatTerritoryEdgeFactor, 0, 1)
    : COMBAT_TERRITORY_EDGE_FACTOR;
  const territoryEdge = computeDensityAdvantage({
    adapter,
    attackerRow,
    attackerCol,
    targetRow,
    targetCol,
    densityGrid,
    densityEffectMultiplier,
    territoryEdgeFactor: territoryFactor,
  });
  const combinedEdge = clamp(
    baseEdge + riskEdge + resilienceEdge + territoryEdge,
    -0.95,
    0.95,
  );
  const baseSharpness = Number.isFinite(combatEdgeSharpness)
    ? combatEdgeSharpness
    : COMBAT_EDGE_SHARPNESS_DEFAULT;
  const attackerSharpness = resolveCombatSharpness(attacker);
  const defenderSharpness = resolveCombatSharpness(defender);
  const dnaScale = clamp((attackerSharpness + defenderSharpness) / 2, 0.1, 5);
  const logisticInput = combinedEdge * baseSharpness * dnaScale;
  const attackerWinChance = clamp01(1 / (1 + Math.exp(-logisticInput)));

  return { attackerWinChance, edge: combinedEdge };
}

function subtractEnergy(cell, amount) {
  if (!cell) return;

  const current = typeof cell.energy === "number" ? cell.energy : Number.NaN;

  cell.energy = Math.max(0, current - amount);
}

function applyFightCost(cell) {
  if (!cell) return 0;

  const cost = computeFightCost(cell);

  subtractEnergy(cell, cost);

  return cost;
}

function recordFight(stats, winner, loser, context = {}) {
  stats?.onFight?.();
  if (stats?.onDeath) {
    const opponentColor =
      typeof winner?.dna?.toColor === "function"
        ? winner.dna.toColor()
        : typeof winner?.color === "string"
          ? winner.color
          : null;
    const row = Number.isFinite(context.loserRow)
      ? context.loserRow
      : Number.isFinite(loser?.row)
        ? loser.row
        : null;
    const col = Number.isFinite(context.loserCol)
      ? context.loserCol
      : Number.isFinite(loser?.col)
        ? loser.col
        : null;

    stats.onDeath({
      cell: loser,
      row,
      col,
      cause: "combat",
      intensity: context.intensity,
      opponentColor,
      winChance: context.winChance,
    });
  }

  if (winner) {
    winner.fightsWon = (winner.fightsWon || 0) + 1;
    winner.experienceInteraction?.({
      type: "fight",
      outcome: "win",
      partner: loser,
      kinship: clamp(context.kinship ?? 0, 0, 1),
      energyDelta: Number.isFinite(context.winnerCost) ? -context.winnerCost : 0,
      intensity: clamp(context.intensity ?? 1, 0, 2),
    });
  }

  if (loser) {
    loser.fightsLost = (loser.fightsLost || 0) + 1;
    loser.experienceInteraction?.({
      type: "fight",
      outcome: "loss",
      partner: winner,
      kinship: clamp(context.kinship ?? 0, 0, 1),
      energyDelta: Number.isFinite(context.loserCost) ? -context.loserCost : 0,
      intensity: clamp(context.intensity ?? 1, 0, 2),
    });
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

  if (typeof adapter?.relocateCell === "function") {
    relocated = adapter.relocateCell(attackerRow, attackerCol, targetRow, targetCol);
  }

  if (!relocated) {
    if (attackerTile === attacker) {
      clearAdapterCell(adapter, attackerRow, attackerCol);
    }

    placeAdapterCell(adapter, targetRow, targetCol, attacker);

    if ("row" in attacker) attacker.row = targetRow;
    if ("col" in attacker) attacker.col = targetCol;
  }

  if (typeof adapter?.consumeTileEnergy === "function") {
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
  const { row: attackerRow, col: attackerCol } = pickCoordinatesWithFallback(
    initiator,
    attacker,
  );

  if (attackerRow == null || attackerCol == null) return null;

  const defenderInfo = resolveAdapterOccupant(adapter, target);

  if (!defenderInfo) return null;

  const { cell: defender, row: targetRow, col: targetCol } = defenderInfo;

  return { attacker, defender, attackerRow, attackerCol, targetRow, targetCol };
}

/**
 * Resolves social interactions between organisms by interpreting neural
 * intents alongside environmental context. The system handles combat odds,
 * cooperation transfers, reproduction gating, and the bookkeeping required to
 * keep stats and DNA-driven memories up to date.
 */
export default class InteractionSystem {
  constructor({
    adapter,
    gridManager,
    combatTerritoryEdgeFactor = COMBAT_TERRITORY_EDGE_FACTOR,
  } = {}) {
    if (adapter) {
      this.adapter = adapter;
    } else if (gridManager) {
      this.adapter = new GridInteractionAdapter({ gridManager });
    } else {
      this.adapter = null;
    }
    this.pendingIntents = [];
    const numericFactor = Number(combatTerritoryEdgeFactor);

    this.combatTerritoryEdgeFactor = Number.isFinite(numericFactor)
      ? clamp(numericFactor, 0, 1)
      : COMBAT_TERRITORY_EDGE_FACTOR;
  }

  submitIntent(intent) {
    if (!intent || typeof intent !== "object") return false;

    this.pendingIntents.push(intent);

    return true;
  }

  process({
    stats,
    densityGrid,
    densityEffectMultiplier,
    combatEdgeSharpness,
    combatTerritoryEdgeFactor,
  } = {}) {
    let processed = false;

    while (this.pendingIntents.length > 0) {
      const intent = this.pendingIntents.shift();

      processed =
        this.resolveIntent(intent, {
          stats,
          densityGrid,
          densityEffectMultiplier,
          combatEdgeSharpness,
          combatTerritoryEdgeFactor,
        }) || processed;
    }

    return processed;
  }

  resolveIntent(
    intent,
    {
      stats,
      densityGrid,
      densityEffectMultiplier,
      combatEdgeSharpness,
      combatTerritoryEdgeFactor,
    } = {},
  ) {
    if (!intent || typeof intent !== "object") return false;

    switch (intent.type) {
      case "fight":
        return this.#resolveFight(intent, {
          stats,
          densityGrid,
          densityEffectMultiplier,
          combatEdgeSharpness,
          combatTerritoryEdgeFactor,
        });
      case "cooperate":
        return this.#resolveCooperation(intent, { stats });
      default:
        return false;
    }
  }

  #resolveFight(
    intent,
    {
      stats,
      densityGrid,
      densityEffectMultiplier,
      combatEdgeSharpness,
      combatTerritoryEdgeFactor,
    } = {},
  ) {
    const adapter = this.adapter;

    if (!adapter) return false;

    const initiator = intent.initiator || intent.attacker || null;
    const target = intent.target || null;

    const participants = prepareFightParticipants({ adapter, initiator, target });

    if (!participants) return false;

    const { attacker, defender, attackerRow, attackerCol, targetRow, targetCol } =
      participants;

    const attackerCost = applyFightCost(attacker);
    const defenderCost = applyFightCost(defender);

    const attackerPower = computeCombatPower(attacker);
    const defenderPower = computeCombatPower(defender);
    const kinship =
      typeof attacker?.similarityTo === "function" && defender
        ? clamp(attacker.similarityTo(defender), 0, 1)
        : 0;
    const odds = computeCombatOdds({
      attacker,
      defender,
      attackerPower,
      defenderPower,
      adapter,
      attackerRow,
      attackerCol,
      targetRow,
      targetCol,
      densityGrid,
      densityEffectMultiplier,
      combatEdgeSharpness,
      combatTerritoryEdgeFactor: Number.isFinite(combatTerritoryEdgeFactor)
        ? combatTerritoryEdgeFactor
        : this.combatTerritoryEdgeFactor,
    });
    const fightRng =
      typeof attacker?.resolveSharedRng === "function"
        ? attacker.resolveSharedRng(defender, "fightOutcome")
        : Math.random;
    const attackerWins = fightRng() < odds.attackerWinChance;
    const intensity = clamp(
      0.5 + Math.abs(odds.edge) * 0.9 + Math.abs(odds.attackerWinChance - 0.5),
      0,
      1.6,
    );

    const attackerTile = getAdapterCell(adapter, attackerRow, attackerCol);

    if (attackerWins) {
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

      recordFight(stats, attacker, defender, {
        kinship,
        winnerCost: attackerCost,
        loserCost: defenderCost,
        intensity,
        winChance: odds.attackerWinChance,
        loserRow: targetRow,
        loserCol: targetCol,
      });

      return true;
    }

    if (attackerTile === attacker) {
      clearAdapterCell(adapter, attackerRow, attackerCol);
    }

    recordFight(stats, defender, attacker, {
      kinship,
      winnerCost: defenderCost,
      loserCost: attackerCost,
      intensity,
      winChance: 1 - odds.attackerWinChance,
      loserRow: attackerRow,
      loserCol: attackerCol,
    });

    return true;
  }

  #resolveCooperation(intent, { stats } = {}) {
    const adapter = this.adapter;

    if (!adapter) return false;

    const initiator = intent.initiator || null;
    const target = intent.target || null;

    if (!initiator?.cell || !target) return false;

    const actor = initiator.cell;
    const partnerInfo = resolveAdapterOccupant(adapter, target);

    if (!partnerInfo) return false;

    const { cell: partner } = partnerInfo;

    const shareFraction = clamp01(intent.metadata?.shareFraction);
    const maxTileEnergy =
      typeof adapter.maxTileEnergy === "function" ? adapter.maxTileEnergy() : 0;
    const available = Math.max(0, actor.energy * shareFraction);
    const shareAmount = Math.min(maxTileEnergy, available);

    if (shareAmount <= 0) return false;

    const transferred =
      typeof adapter.transferEnergy === "function"
        ? adapter.transferEnergy({ from: actor, to: partner, amount: shareAmount })
        : 0;

    if (transferred <= 0) return false;

    stats?.onCooperate?.();

    const kinship =
      typeof actor?.similarityTo === "function" && partner
        ? clamp(actor.similarityTo(partner), 0, 1)
        : 0;

    actor.experienceInteraction?.({
      type: "cooperate",
      outcome: "give",
      partner,
      kinship,
      energyDelta: -transferred,
      intensity: 0.6 + kinship * 0.4,
    });

    partner.experienceInteraction?.({
      type: "cooperate",
      outcome: "receive",
      partner: actor,
      kinship,
      energyDelta: transferred,
      intensity: 0.6 + kinship * 0.4,
    });

    return true;
  }
}
