import { assert, suite } from "#tests/harness";

const test = suite("simulation timing resets");

async function setupHeadlessSimulation() {
  const { createSimulation } = await import("../src/main.js");
  let frameCallback = null;
  let currentTime = 0;

  const controller = createSimulation({
    headless: true,
    autoStart: false,
    requestAnimationFrame: (cb) => {
      frameCallback = cb;

      return 1;
    },
    cancelAnimationFrame: () => {},
    performanceNow: () => currentTime,
  });

  const advanceFrame = (timestamp) => {
    currentTime = timestamp;
    assert.ok(
      typeof frameCallback === "function",
      "animation frame should be scheduled",
    );
    frameCallback(timestamp);
  };

  return {
    controller,
    engine: controller.engine,
    setNow(value) {
      currentTime = value;
    },
    advanceFrame,
    getCurrentTime() {
      return currentTime;
    },
  };
}

test("setWorldGeometry keeps lastUpdateTime aligned with current time", async () => {
  const simulation = await setupHeadlessSimulation();

  try {
    const { engine } = simulation;

    engine.start();
    simulation.advanceFrame(32);

    assert.is(engine.lastUpdateTime, 32);

    simulation.setNow(48);
    engine.setWorldGeometry({
      rows: engine.rows + 1,
      cols: engine.cols,
      cellSize: engine.cellSize,
    });

    assert.is(engine.lastUpdateTime, simulation.getCurrentTime());
  } finally {
    simulation.controller.destroy();
  }
});

test("resetWorld restores lastUpdateTime when restarting", async () => {
  const simulation = await setupHeadlessSimulation();

  try {
    const { engine } = simulation;

    engine.start();
    simulation.advanceFrame(24);

    assert.is(engine.lastUpdateTime, 24);

    simulation.setNow(64);
    engine.resetWorld({});

    assert.is(engine.lastUpdateTime, simulation.getCurrentTime());
  } finally {
    simulation.controller.destroy();
  }
});
