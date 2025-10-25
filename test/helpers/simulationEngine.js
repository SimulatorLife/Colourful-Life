export { MockCanvas } from "./mockDom.js";

export async function loadSimulationModules() {
  const [simulationModule, gridModule, statsModule, eventModule] = await Promise.all([
    import("../../src/simulationEngine.js"),
    import("../../src/grid/gridManager.js"),
    import("../../src/stats.js"),
    import("../../src/events/eventManager.js"),
  ]);

  return {
    SimulationEngine: simulationModule.default,
    GridManager: gridModule.default,
    Stats: statsModule.default,
    EventManager: eventModule.default,
  };
}

export function patchSimulationPrototypes({ GridManager, Stats, EventManager }) {
  const snapshot = {
    entries: [
      {
        row: 0,
        col: 0,
        fitness: 1,
        cell: {
          offspring: 3,
          fightsWon: 4,
          age: 5,
          color: "#123456",
        },
      },
    ],
    brainSnapshots: [],
  };
  const metrics = { averageEnergy: 0.5 };
  const fixedEventTemplate = {
    eventType: "flood",
    duration: 10,
    remaining: 10,
    strength: 0.75,
    affectedArea: { x: 1, y: 2, width: 3, height: 4 },
  };

  const gridMethods = [
    "init",
    "recalculateDensityCounts",
    "rebuildActiveCells",
    "update",
    "draw",
    "getLastSnapshot",
    "setMatingDiversityOptions",
    "setBrainSnapshotCollector",
    "setBrainSnapshotLimit",
  ];
  const statsMethods = [
    "resetTick",
    "logEvent",
    "updateFromSnapshot",
    "setMutationMultiplier",
  ];

  const originals = {
    grid: {},
    stats: {},
    event: EventManager.prototype.generateRandomEvent,
  };
  const calls = {
    grid: Object.fromEntries(gridMethods.map((name) => [name, []])),
    stats: Object.fromEntries(statsMethods.map((name) => [name, []])),
    events: { generateRandomEvent: [] },
  };

  gridMethods.forEach((name) => {
    originals.grid[name] = GridManager.prototype[name];
    GridManager.prototype[name] = function stubbedGridMethod(...args) {
      calls.grid[name].push(args);

      if (name === "update") {
        return snapshot;
      }

      if (name === "getLastSnapshot") {
        return snapshot;
      }
    };
  });

  statsMethods.forEach((name) => {
    originals.stats[name] = Stats.prototype[name];
    Stats.prototype[name] = function stubbedStatsMethod(...args) {
      calls.stats[name].push(args);

      if (name === "updateFromSnapshot") {
        return metrics;
      }

      return undefined;
    };
  });

  EventManager.prototype.generateRandomEvent = function stubbedGenerateRandomEvent(
    ...args
  ) {
    calls.events.generateRandomEvent.push(args);

    return {
      ...fixedEventTemplate,
      affectedArea: { ...fixedEventTemplate.affectedArea },
    };
  };

  return {
    calls,
    snapshot,
    metrics,
    fixedEventTemplate,
    restore() {
      gridMethods.forEach((name) => {
        GridManager.prototype[name] = originals.grid[name];
      });
      statsMethods.forEach((name) => {
        Stats.prototype[name] = originals.stats[name];
      });
      EventManager.prototype.generateRandomEvent = originals.event;
    },
  };
}
