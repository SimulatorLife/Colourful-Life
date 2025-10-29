import { assert, test } from "#tests/harness";

const simulationModulePromise = import("../src/main.js");
const errorUtilsPromise = import("../src/utils/error.js");
const simulationEngineModulePromise = import("../src/simulationEngine.js");

async function withWarnCapture(run) {
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };

  try {
    await run(warnings);
  } finally {
    console.warn = originalWarn;
  }

  return warnings;
}

test("createSimulation destroy warns once when ui cleanup throws", async () => {
  const [{ createSimulation }, { __dangerousResetWarnOnce }] = await Promise.all([
    simulationModulePromise,
    errorUtilsPromise,
  ]);

  __dangerousResetWarnOnce();

  const warnings = await withWarnCapture(async () => {
    const simulation = createSimulation({ headless: true, autoStart: false });

    simulation.uiManager.destroy = () => {
      throw new Error("ui failure");
    };

    simulation.destroy();
    simulation.destroy();
  });

  try {
    assert.is(warnings.length, 1);
    const [message, error] = warnings[0];

    assert.is(message, "UI manager destroy handler threw; continuing cleanup.");
    assert.instance(error, Error);
    assert.is(error?.message, "ui failure");
  } finally {
    __dangerousResetWarnOnce();
  }
});

test("createSimulation destroy warns once when unsubscribe callbacks throw", async () => {
  const [
    { createSimulation },
    { __dangerousResetWarnOnce },
    { default: SimulationEngine },
  ] = await Promise.all([
    simulationModulePromise,
    errorUtilsPromise,
    simulationEngineModulePromise,
  ]);

  const originalOn = SimulationEngine.prototype.on;

  SimulationEngine.prototype.on = function patchedOn(event, handler) {
    if (typeof handler !== "function") return () => {};

    const unsubscribe =
      typeof originalOn === "function"
        ? originalOn.call(this, event, handler)
        : () => {};
    const error = new Error("unsubscribe failure");

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }

      throw error;
    };
  };

  __dangerousResetWarnOnce();

  const warnings = await withWarnCapture(async () => {
    const simulation = createSimulation({ headless: true, autoStart: false });

    simulation.destroy();
  });

  try {
    assert.is(warnings.length, 1);
    const [message, error] = warnings[0];

    assert.is(
      message,
      "Simulation cleanup handler threw during destroy; continuing cleanup.",
    );
    assert.instance(error, Error);
    assert.is(error?.message, "unsubscribe failure");
  } finally {
    SimulationEngine.prototype.on = originalOn;
    __dangerousResetWarnOnce();
  }
});

test("createSimulation destroy warns when engine destroy throws", async () => {
  const [{ createSimulation }, { __dangerousResetWarnOnce }] = await Promise.all([
    simulationModulePromise,
    errorUtilsPromise,
  ]);

  __dangerousResetWarnOnce();

  const warnings = await withWarnCapture(async () => {
    const simulation = createSimulation({ headless: true, autoStart: false });

    simulation.engine.destroy = () => {
      throw new Error("engine destroy failure");
    };

    simulation.destroy();
    simulation.destroy();
  });

  try {
    assert.is(warnings.length, 1);
    const [message, error] = warnings[0];

    assert.is(
      message,
      "Simulation engine destroy handler threw; attempting graceful shutdown.",
    );
    assert.instance(error, Error);
    assert.is(error?.message, "engine destroy failure");
  } finally {
    __dangerousResetWarnOnce();
  }
});

test("createSimulation destroy falls back to stop when destroy is absent", async () => {
  const [{ createSimulation }, { __dangerousResetWarnOnce }] = await Promise.all([
    simulationModulePromise,
    errorUtilsPromise,
  ]);

  __dangerousResetWarnOnce();

  const warnings = await withWarnCapture(async () => {
    const simulation = createSimulation({ headless: true, autoStart: false });
    const originalStop = simulation.engine.stop;

    simulation.engine.destroy = null;
    simulation.engine.stop = () => {
      throw new Error("engine stop failure");
    };

    try {
      simulation.destroy();
      simulation.destroy();
    } finally {
      simulation.engine.stop = originalStop;
    }
  });

  try {
    assert.is(warnings.length, 1);
    const [message, error] = warnings[0];

    assert.is(
      message,
      "Simulation engine stop handler threw; shutdown may be incomplete.",
    );
    assert.instance(error, Error);
    assert.is(error?.message, "engine stop failure");
  } finally {
    __dangerousResetWarnOnce();
  }
});
