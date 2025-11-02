import SimulationEngine from "../engine/simulationEngine.js";
import GridManager from "../grid/gridManager.js";
import Stats from "../stats/index.js";
import EventManager from "../events/eventManager.js";

function resolveSimulationModules() {
  return {
    SimulationEngine,
    GridManager,
    Stats,
    EventManager,
  };
}

export async function loadSimulationModules() {
  return resolveSimulationModules();
}

export function createSimulationModuleAdapter() {
  return resolveSimulationModules();
}

export function createGridManagerFactory() {
  const { GridManager: GridManagerCtor } = resolveSimulationModules();

  return (rows, cols, options = {}) => new GridManagerCtor(rows, cols, options);
}
