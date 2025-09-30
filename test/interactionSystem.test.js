import { test } from "uvu";
import * as assert from "uvu/assert";

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

test.run();
