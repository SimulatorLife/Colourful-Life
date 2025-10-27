import { assert, test } from "#tests/harness";
import { approxEqual } from "./helpers/assertions.js";

if (typeof globalThis.window === "undefined") {
  globalThis.window = {};
}

test("GridManager.regenerateEnergyGrid applies event effect modifiers", async () => {
  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const energyCap = 6;
  const affectedArea = { x: 0, y: 0, width: 1, height: 1 };

  const floodManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    maxTileEnergy: energyCap,
  });

  floodManager.energyGrid = [[1]];
  floodManager.energyNext = [[0]];
  floodManager.regenerateEnergyGrid(
    [{ eventType: "flood", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(floodManager.energyGrid[0][0], energyCap);

  const droughtManager = new TestGridManager(1, 1, {
    eventManager: { activeEvents: [] },
    ctx: {},
    cellSize: 1,
    maxTileEnergy: energyCap,
  });

  droughtManager.energyGrid = [[1]];
  droughtManager.energyNext = [[0]];
  droughtManager.regenerateEnergyGrid(
    [{ eventType: "drought", strength: 1, affectedArea }],
    1,
    1,
    0,
    [[0]],
  );

  approxEqual(droughtManager.energyGrid[0][0], energyCap * 0.4);
});

test("Cell.applyEventEffects uses event mapping and DNA resistance", async () => {
  const { default: Cell } = await import("../src/cell.js");

  const event = {
    eventType: "heatwave",
    strength: 1,
    affectedArea: { x: 0, y: 0, width: 2, height: 2 },
  };

  const cell = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0.4,
      heatResist: () => 0.3,
    },
  });

  cell.applyEventEffects(0, 0, event, 1, 5);
  approxEqual(cell.energy, 1.924, 1e-3);

  const unaffected = Object.assign(Object.create(Cell.prototype), {
    energy: 2,
    dna: {
      recoveryRate: () => 0,
      heatResist: () => 0,
    },
  });

  unaffected.applyEventEffects(5, 5, event, 1, 5);
  assert.is(unaffected.energy, 2);
});

test("Cell.applyEventEffects scales drain using DNA susceptibility", async () => {
  const [{ default: Cell }, { default: DNA, GENE_LOCI }, { EVENT_EFFECTS }] =
    await Promise.all([
      import("../src/cell.js"),
      import("../src/genome.js"),
      import("../src/events/eventEffects.js"),
    ]);

  if (typeof window.GridManager !== "object") {
    window.GridManager = {};
  }
  if (typeof window.GridManager.maxTileEnergy !== "number") {
    window.GridManager.maxTileEnergy = 5;
  }

  const createFloodGenome = (overrides = {}) => {
    const dna = new DNA(120, 120, 120);
    const defaults = {
      DENSITY: 128,
      RECOVERY: 128,
      ENERGY_EFFICIENCY: 128,
      MOVEMENT: 128,
      RISK: 128,
      COOPERATION: 128,
      RESIST_FLOOD: 160,
    };

    for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
      const locus = GENE_LOCI[key];

      if (typeof locus !== "number") continue;

      dna.genes[locus] = value;
    }

    return dna;
  };

  const resilientDNA = createFloodGenome({
    DENSITY: 220,
    RECOVERY: 220,
    ENERGY_EFFICIENCY: 210,
    MOVEMENT: 40,
    RISK: 60,
  });
  const fragileDNA = createFloodGenome({
    DENSITY: 40,
    RECOVERY: 40,
    ENERGY_EFFICIENCY: 60,
    MOVEMENT: 220,
    RISK: 210,
  });

  const baselineEnergy = 3;
  const resilient = new Cell(0, 0, resilientDNA, baselineEnergy);
  const fragile = new Cell(0, 0, fragileDNA, baselineEnergy);

  const floodEvent = {
    eventType: "flood",
    strength: 0.9,
    affectedArea: { x: 0, y: 0, width: 1, height: 1 },
  };
  const eventContext = {
    isEventAffecting: () => true,
    getEventEffect: (type) => EVENT_EFFECTS[type],
  };

  resilient.applyEventEffects(0, 0, floodEvent, 1, 5, { eventContext });
  fragile.applyEventEffects(0, 0, floodEvent, 1, 5, { eventContext });

  const resilientLoss = baselineEnergy - resilient.energy;
  const fragileLoss = baselineEnergy - fragile.energy;

  assert.ok(resilientLoss > 0, "events should drain some energy");
  assert.ok(
    fragileLoss > resilientLoss,
    `Fragile genomes should lose more (${fragileLoss}) than resilient ones (${resilientLoss})`,
  );
});

test("Cell.applyEventEffects imprints neural anticipation when brain plasticity is active", async () => {
  const { default: Cell } = await import("../src/cell.js");

  const imprintCalls = [];
  const feedbackCalls = [];
  const anticipationProfile = {
    assimilation: 0.6,
    relief: 0.2,
    gainInfluence: 0.4,
    volatility: 0.7,
    fatigueWeight: 0.45,
    rewardScale: 0.8,
    baseline: 0.25,
  };
  const responseProfile = {
    drainMitigation: 0.15,
    vigilance: 0.9,
    pressureRetention: 0.7,
    rebound: 0.25,
  };

  const cell = Object.assign(Object.create(Cell.prototype), {
    energy: 3,
    dna: {
      recoveryRate: () => 0.2,
      heatResist: () => 0,
      eventAnticipationProfile: () => anticipationProfile,
      eventResponseProfile: () => responseProfile,
    },
    lastEventPressure: 0.1,
    eventAnticipationProfile: anticipationProfile,
    neuralFatigueProfile: { baseline: 0.3 },
    _resourceSignal: -0.2,
    _neuralFatigue: 0.4,
    brain: {
      applyExperienceImprint: (payload) => imprintCalls.push(payload),
      applySensorFeedback: (payload) => feedbackCalls.push(payload),
      lastActivationCount: 4,
    },
  });

  const event = {
    eventType: "heatwave",
    strength: 1,
    affectedArea: { x: 0, y: 0, width: 2, height: 2 },
  };

  cell.applyEventEffects(0, 0, event, 1, 5);

  assert.ok(imprintCalls.length > 0, "expected event imprint call");
  assert.ok(
    imprintCalls[0]?.adjustments?.some((entry) => entry.sensor === "eventPressure"),
    "expected event pressure adjustment",
  );
  assert.ok(feedbackCalls.length > 0, "expected sensor feedback call");
  assert.ok(feedbackCalls[0]?.energyCost > 0, "feedback should reflect energy loss");
});
