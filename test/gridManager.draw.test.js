import { test } from "uvu";
import * as assert from "uvu/assert";

function createMockContext() {
  const calls = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    clearRect: (...args) => {
      calls.push({ type: "clearRect", args });
    },
    fillRect: (...args) => {
      calls.push({ type: "fillRect", fillStyle: ctx.fillStyle, args });
    },
    strokeRect: (...args) => {
      calls.push({
        type: "strokeRect",
        strokeStyle: ctx.strokeStyle,
        lineWidth: ctx.lineWidth,
        args,
      });
    },
  };

  return { ctx, calls };
}

async function buildGridManager() {
  const originalWindow = global.window;

  if (typeof originalWindow === "undefined") {
    global.window = { eventManager: { activeEvents: [] } };
  } else {
    global.window = { ...originalWindow };

    if (!global.window.eventManager) {
      global.window.eventManager = { activeEvents: [] };
    }
  }

  const { default: GridManager } = await import("../src/grid/gridManager.js");

  class TestGridManager extends GridManager {
    init() {}
  }

  const { ctx, calls } = createMockContext();
  const grid = new TestGridManager(2, 2, {
    ctx,
    cellSize: 10,
    eventManager: { activeEvents: [] },
  });

  grid.setObstacle(0, 0, true);
  grid.setCell(0, 1, { color: "#ff00ff" });

  return {
    grid,
    calls,
    restore() {
      if (originalWindow === undefined) {
        delete global.window;
      } else {
        global.window = originalWindow;
      }
    },
  };
}

test("grid draw renders obstacle shading when enabled", async () => {
  const { grid, calls, restore } = await buildGridManager();

  try {
    grid.draw();

    const obstacleFill = calls.filter(
      (entry) => entry.type === "fillRect" && entry.fillStyle === "rgba(40,40,55,0.9)",
    );
    const obstacleStroke = calls.filter(
      (entry) =>
        entry.type === "strokeRect" && entry.strokeStyle === "rgba(200,200,255,0.25)",
    );

    assert.ok(obstacleFill.length > 0, "obstacles should be filled when enabled");
    assert.ok(
      obstacleStroke.length > 0,
      "obstacle outlines should be drawn when enabled",
    );
  } finally {
    restore();
  }
});

test("grid draw omits obstacle shading when disabled", async () => {
  const { grid, calls, restore } = await buildGridManager();

  try {
    grid.draw({ showObstacles: false });

    const obstacleFill = calls.find(
      (entry) => entry.type === "fillRect" && entry.fillStyle === "rgba(40,40,55,0.9)",
    );
    const obstacleStroke = calls.find(
      (entry) =>
        entry.type === "strokeRect" && entry.strokeStyle === "rgba(200,200,255,0.25)",
    );
    const cellFill = calls.find(
      (entry) => entry.type === "fillRect" && entry.fillStyle === "#ff00ff",
    );

    assert.is(obstacleFill, undefined, "obstacle fills should be skipped when hidden");
    assert.is(
      obstacleStroke,
      undefined,
      "obstacle outlines should be skipped when hidden",
    );
    assert.ok(cellFill, "cells should still be rendered when obstacles are hidden");
  } finally {
    restore();
  }
});

test.run();
