import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";
import {
  getInteractionAdapterFactory,
  setInteractionAdapterFactory,
} from "../src/grid/interactionAdapterRegistry.js";

let InteractionSystem;

class FakeAdapter {
  constructor({ maxTileEnergy = 12 } = {}) {
    this.maxEnergy = maxTileEnergy;
    this.cells = new Map();
    this.consumeCalls = [];
  }

  #key(row, col) {
    return `${row},${col}`;
  }

  place(cell, row, col) {
    if (!cell) return null;

    cell.row = row;
    cell.col = col;
    this.cells.set(this.#key(row, col), cell);

    return cell;
  }

  getCell(row, col) {
    return this.cells.get(this.#key(row, col)) ?? null;
  }

  setCell(row, col, cell) {
    if (!cell) {
      this.cells.delete(this.#key(row, col));

      return null;
    }

    return this.place(cell, row, col);
  }

  removeCell(row, col) {
    const key = this.#key(row, col);
    const cell = this.cells.get(key) ?? null;

    if (cell) {
      this.cells.delete(key);
    }

    return cell;
  }

  relocateCell(fromRow, fromCol, toRow, toCol) {
    const moving = this.getCell(fromRow, fromCol);

    if (!moving || this.getCell(toRow, toCol)) return false;

    this.cells.delete(this.#key(fromRow, fromCol));
    this.place(moving, toRow, toCol);

    return true;
  }

  consumeTileEnergy({ cell, row, col, densityGrid, densityEffectMultiplier } = {}) {
    this.consumeCalls.push({ cell, row, col, densityGrid, densityEffectMultiplier });
  }

  transferEnergy({ from, to, amount } = {}) {
    const donor = from ?? null;
    const recipient = to ?? null;
    const requested = Math.max(0, amount ?? 0);

    if (!donor || typeof donor.energy !== "number" || requested <= 0) return 0;

    const available = Math.min(requested, donor.energy);
    const maxEnergy = this.maxTileEnergy();
    let accepted = available;

    if (recipient) {
      const current = typeof recipient.energy === "number" ? recipient.energy : 0;
      const capacity = Math.max(0, maxEnergy - current);

      accepted = Math.max(0, Math.min(available, capacity));
      recipient.energy = current + accepted;
    }

    donor.energy = Math.max(0, donor.energy - accepted);

    return accepted;
  }

  maxTileEnergy() {
    return this.maxEnergy;
  }

  densityAt(row, col, { densityGrid } = {}) {
    if (densityGrid?.[row]?.[col] != null) {
      return densityGrid[row][col];
    }

    return 0;
  }
}

function withFixedRandom(value, fn) {
  const original = Math.random;
  const generator = typeof value === "function" ? value : () => value;

  Math.random = generator;

  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test.before(async () => {
  ({ default: InteractionSystem } = await import("../src/interactionSystem.js"));
});

test("constructor uses registered adapter factory when only a grid manager is provided", () => {
  const gridManager = { id: "grid" };
  const adapter = { id: "adapter" };
  const previousFactory = getInteractionAdapterFactory();
  let factoryCalls = 0;

  try {
    setInteractionAdapterFactory(({ gridManager: factoryGridManager }) => {
      factoryCalls += 1;
      assert.is(
        factoryGridManager,
        gridManager,
        "grid manager should be forwarded to the factory",
      );

      return adapter;
    });

    const interaction = new InteractionSystem({ gridManager });

    assert.is(interaction.adapter, adapter, "factory result should be used");
    assert.is(factoryCalls, 1, "factory should be invoked exactly once");
  } finally {
    setInteractionAdapterFactory(previousFactory);
  }
});

test("fight victory removes defender, relocates attacker, and consumes tile energy", () => {
  const adapter = new FakeAdapter();
  const interaction = new InteractionSystem({ adapter });
  const attacker = {
    energy: 10,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };
  const defender = {
    energy: 4,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };

  adapter.place(attacker, 0, 0);
  adapter.place(defender, 0, 1);

  let fights = 0;
  let deaths = 0;
  const densityGrid = [[0]];
  const stats = {
    onFight: () => fights++,
    onDeath: () => deaths++,
  };
  const intent = {
    type: "fight",
    initiator: { cell: attacker, row: 0, col: 0 },
    target: { row: 0, col: 1 },
  };

  const resolved = withFixedRandom(0, () =>
    interaction.resolveIntent(intent, {
      stats,
      densityGrid,
      densityEffectMultiplier: 1,
    }),
  );

  assert.ok(resolved, "fight intent resolves");
  assert.is(adapter.getCell(0, 1), attacker, "attacker moves to defender tile");
  assert.is(adapter.getCell(0, 0), null, "origin tile emptied");
  assert.is(attacker.row, 0);
  assert.is(attacker.col, 1);
  assert.is(attacker.fightsWon, 1);
  assert.is(defender.fightsLost, 1);
  assert.is(fights, 1, "fight stat incremented");
  assert.is(deaths, 1, "death stat incremented");
  assert.is(adapter.consumeCalls.length, 1, "tile energy consumed once");
  assert.equal(adapter.consumeCalls[0], {
    cell: attacker,
    row: 0,
    col: 1,
    densityGrid,
    densityEffectMultiplier: 1,
  });
});

test("ranged fight victory leaves attacker in place", () => {
  const adapter = new FakeAdapter();
  const interaction = new InteractionSystem({ adapter });
  const attacker = {
    energy: 12,
    dna: {
      fightCost: () => 0,
      combatPower: () => 2,
    },
    ageEnergyMultiplier: () => 1,
  };
  const defender = {
    energy: 2,
    dna: {
      fightCost: () => 0,
      combatPower: () => 0.5,
    },
    ageEnergyMultiplier: () => 1,
  };

  adapter.place(attacker, 0, 0);
  adapter.place(defender, 0, 2);

  const densityGrid = [[0, 0, 0]];
  const stats = {
    onFight() {},
    onDeath() {},
  };
  const intent = {
    type: "fight",
    initiator: { cell: attacker, row: 0, col: 0 },
    target: { row: 0, col: 2 },
  };

  const resolved = withFixedRandom(0, () =>
    interaction.resolveIntent(intent, {
      stats,
      densityGrid,
      densityEffectMultiplier: 1,
    }),
  );

  assert.ok(resolved, "fight intent resolves at range");
  assert.is(adapter.getCell(0, 0), attacker, "attacker remains on original tile");
  assert.is(adapter.getCell(0, 2), null, "defender tile is cleared");
  assert.is(attacker.row, 0);
  assert.is(attacker.col, 0);
  assert.is(attacker.fightsWon, 1);
  assert.is(defender.fightsLost, 1);
  assert.is(adapter.consumeCalls.length, 0, "no remote tile energy consumption");
});

test("fight defeat removes attacker but leaves defender intact", () => {
  const adapter = new FakeAdapter();
  const interaction = new InteractionSystem({ adapter });
  const attacker = {
    energy: 2,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };
  const defender = {
    energy: 8,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };

  adapter.place(attacker, 0, 0);
  adapter.place(defender, 0, 1);

  let fights = 0;
  let deaths = 0;
  const stats = {
    onFight: () => fights++,
    onDeath: () => deaths++,
  };
  const intent = {
    type: "fight",
    initiator: { cell: attacker, row: 0, col: 0 },
    target: { row: 0, col: 1 },
  };

  const resolved = withFixedRandom(0.999, () =>
    interaction.resolveIntent(intent, { stats }),
  );

  assert.ok(resolved, "fight defeat still resolves");
  assert.is(adapter.getCell(0, 1), defender, "defender remains on tile");
  assert.is(adapter.getCell(0, 0), null, "attacker tile cleared");
  assert.is(defender.fightsWon, 1, "defender records win");
  assert.is(attacker.fightsLost, 1, "attacker records loss");
  assert.is(fights, 1, "fight stat incremented once");
  assert.is(deaths, 1, "death stat incremented once");
});

test("cooperation transfers bounded energy to partner via adapter", () => {
  const adapter = new FakeAdapter({ maxTileEnergy: 15 });
  const interaction = new InteractionSystem({ adapter });
  const actor = { energy: 12 };
  const partner = { energy: 5 };

  adapter.place(actor, 0, 0);
  adapter.place(partner, 0, 1);

  let cooperations = 0;
  const stats = {
    onCooperate: () => cooperations++,
  };
  const intent = {
    type: "cooperate",
    initiator: { cell: actor, row: 0, col: 0 },
    target: { row: 0, col: 1 },
    metadata: { shareFraction: 0.5 },
  };

  const resolved = interaction.resolveIntent(intent, { stats });

  assert.ok(resolved, "cooperation intent resolves");
  assert.is(cooperations, 1, "cooperation stat increments");
  assert.is(actor.energy, 6, "actor spends half of energy");
  assert.is(
    partner.energy,
    11,
    "partner receives transferred energy capped by max energy",
  );
});

test("submitIntent queues intents and process resolves at least one", () => {
  const adapter = new FakeAdapter();
  const interaction = new InteractionSystem({ adapter });

  assert.is(interaction.submitIntent(null), false, "rejects non-object intents");
  assert.is(
    interaction.pendingIntents.length,
    0,
    "no intents queued for invalid input",
  );

  const attacker = {
    energy: 6,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };
  const defender = {
    energy: 4,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };

  adapter.place(attacker, 0, 0);
  adapter.place(defender, 0, 1);

  const invalidIntent = { type: "fight" };
  const validIntent = {
    type: "fight",
    initiator: { cell: attacker, row: 0, col: 0 },
    target: { row: 0, col: 1 },
  };

  assert.is(
    interaction.submitIntent(invalidIntent),
    true,
    "queues malformed fight intent",
  );
  assert.is(interaction.submitIntent(validIntent), true, "queues valid fight intent");

  let fights = 0;
  const stats = {
    onFight: () => fights++,
  };

  const resolved = withFixedRandom(0, () =>
    interaction.process({ stats, densityGrid: [[0]] }),
  );

  assert.ok(resolved, "process returns true when a later intent resolves");
  assert.is(fights, 1, "fight stat increments once");
  assert.is(interaction.pendingIntents.length, 0, "all intents consumed");
  assert.is(adapter.getCell(0, 1), attacker, "attacker relocates to defender tile");

  const idle = interaction.process({ stats });

  assert.is(idle, false, "subsequent process call reports no work");
});

test("fight resolves using fallback coordinates from cell references", () => {
  const adapter = new FakeAdapter();
  const interaction = new InteractionSystem({ adapter });
  const attacker = {
    energy: 5,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };
  const defender = {
    energy: 5,
    dna: {
      fightCost: () => 0,
      combatPower: () => 1,
    },
    ageEnergyMultiplier: () => 1,
  };

  adapter.place(attacker, 2, 3);
  adapter.place(defender, 2, 4);

  const intent = {
    type: "fight",
    initiator: { cell: attacker },
    target: { cell: defender },
  };

  const resolved = withFixedRandom(0, () =>
    interaction.resolveIntent(intent, { densityGrid: [[0, 0, 0, 0, 0]] }),
  );

  assert.ok(resolved, "fight resolves despite missing explicit coordinates");
  assert.is(attacker.row, 2, "attacker row updated via fallback coordinate");
  assert.is(attacker.col, 4, "attacker col updated via fallback coordinate");
  assert.is(adapter.getCell(2, 3), null, "origin tile cleared");
  assert.is(adapter.getCell(2, 4), attacker, "attacker occupies defender tile");
});

test("fight odds incorporate trait and territory adjustments", () => {
  class CapturingAdapter extends FakeAdapter {
    constructor(options) {
      super(options);
      this.deathRecords = [];
    }

    registerDeath(cell, details) {
      this.deathRecords.push({ cell, details });
    }
  }

  const adapter = new CapturingAdapter({ maxTileEnergy: 30 });
  const interaction = new InteractionSystem({ adapter });
  const attacker = {
    energy: 10,
    dna: {
      fightCost: () => 2,
      combatPower: () => 1.1,
      combatEdgeSharpness: () => 1.8,
    },
    ageEnergyMultiplier: () => 0.5,
    resolveTrait: (trait) => {
      if (trait === "riskTolerance") return 0.9;
      if (trait === "recoveryRate") return 0.7;

      return undefined;
    },
    similarityTo: () => 0.4,
    experienceInteraction: ({ type, outcome, energyDelta, intensity }) => {
      attacker.lastInteraction = { type, outcome, energyDelta, intensity };
    },
  };
  const defender = {
    energy: 10,
    dna: {
      fightCost: () => 1,
      combatPower: () => 0.9,
      combatEdgeSharpness: () => 0.6,
    },
    ageEnergyMultiplier: () => 1.2,
    resolveTrait: (trait) => {
      if (trait === "riskTolerance") return 0.1;
      if (trait === "recoveryRate") return 0.3;

      return undefined;
    },
    experienceInteraction: ({ type, outcome, energyDelta, intensity }) => {
      defender.lastInteraction = { type, outcome, energyDelta, intensity };
    },
  };

  adapter.place(attacker, 0, 0);
  adapter.place(defender, 0, 1);

  const stats = { onFight: () => {} };
  const densityGrid = [[0.8, 0.2]];

  const expectedEdge = (() => {
    const attackerCost = attacker.dna.fightCost() * attacker.ageEnergyMultiplier(1);
    const defenderCost = defender.dna.fightCost() * defender.ageEnergyMultiplier(1);
    const attackerPower = (attacker.energy - attackerCost) * attacker.dna.combatPower();
    const defenderPower = (defender.energy - defenderCost) * defender.dna.combatPower();
    const totalPower = Math.abs(attackerPower) + Math.abs(defenderPower);
    const baseEdge = totalPower > 0 ? (attackerPower - defenderPower) / totalPower : 0;
    const riskEdge = (0.9 - 0.1) * 0.2;
    const resilienceEdge = (0.7 - 0.3) * 0.15;
    const densityDelta = Math.max(-1, Math.min(1, 0.8 - 0.2));
    const territoryEdge = densityDelta * 1.1 * 0.4;

    return Math.max(
      -0.95,
      Math.min(0.95, baseEdge + riskEdge + resilienceEdge + territoryEdge),
    );
  })();

  const expectedDnaScale = (() => {
    const attackerSharpness = Math.min(
      4,
      Math.max(0.25, attacker.dna.combatEdgeSharpness()),
    );
    const defenderSharpness = Math.min(
      4,
      Math.max(0.25, defender.dna.combatEdgeSharpness()),
    );

    return Math.max(0.1, Math.min(5, (attackerSharpness + defenderSharpness) / 2));
  })();

  const expectedWinChance = (() => {
    const logisticInput = expectedEdge * 2.5 * expectedDnaScale;
    const probability = 1 / (1 + Math.exp(-logisticInput));

    return Math.max(0, Math.min(1, probability));
  })();

  const resolved = withFixedRandom(0.1, () =>
    interaction.resolveIntent(
      {
        type: "fight",
        initiator: { cell: attacker, row: 0, col: 0 },
        target: { row: 0, col: 1 },
      },
      {
        stats,
        densityGrid,
        densityEffectMultiplier: 1.1,
        combatEdgeSharpness: 2.5,
        combatTerritoryEdgeFactor: 0.4,
      },
    ),
  );

  assert.ok(resolved, "fight resolves with deterministic victory");
  assert.is(adapter.getCell(0, 0), null, "attacker origin cleared after move");
  assert.is(adapter.getCell(0, 1), attacker, "attacker occupies defender tile");
  approxEqual(attacker.energy, 9, 1e-9);
  approxEqual(defender.energy, 8.8, 1e-8);
  assert.is(attacker.lastInteraction.type, "fight");
  assert.is(attacker.lastInteraction.outcome, "win");
  approxEqual(attacker.lastInteraction.energyDelta, -1, 1e-9);
  assert.ok(attacker.lastInteraction.intensity > 0.5);
  assert.is(defender.lastInteraction.outcome, "loss");
  approxEqual(defender.lastInteraction.energyDelta, -1.2, 1e-8);
  assert.is(adapter.deathRecords.length, 1, "adapter records defender death");
  approxEqual(adapter.deathRecords[0].details.winChance, expectedWinChance, 1e-8);
});
