import { suite } from "uvu";
import * as assert from "uvu/assert";

import { drawCelebrationAuras, drawOverlays } from "../src/ui/overlays.js";

const test = suite("ui overlays: celebration auras");

function createMockContext() {
  const calls = [];
  const gradients = [];

  return {
    calls,
    gradients,
    save() {
      calls.push({ type: "save" });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    arc(x, y, radius) {
      calls.push({ type: "arc", x, y, radius });
    },
    fill() {
      calls.push({ type: "fill" });
    },
    fillRect(x, y, width, height) {
      calls.push({ type: "fillRect", x, y, width, height });
    },
    strokeRect(x, y, width, height) {
      calls.push({ type: "strokeRect", x, y, width, height });
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const record = {
        type: "createRadialGradient",
        x0,
        y0,
        r0,
        x1,
        y1,
        r1,
        stops: [],
      };

      gradients.push(record);

      return {
        addColorStop(offset, color) {
          record.stops.push({ offset, color });
        },
      };
    },
    set fillStyle(value) {
      calls.push({ type: "setFillStyle", value });
    },
    get fillStyle() {
      return null;
    },
  };
}

test("drawCelebrationAuras renders gradients for top performers", () => {
  const ctx = createMockContext();
  const snapshot = {
    entries: [
      { row: 0, col: 0, fitness: 0.2, smoothedFitness: 0.3 },
      { row: 3, col: 4, fitness: 0.9, smoothedFitness: 0.92 },
      { row: 5, col: 1, fitness: 0.7, smoothedFitness: 0.71 },
      { row: 6, col: 6, fitness: 0.1 },
    ],
    maxFitness: 1,
  };

  drawCelebrationAuras(snapshot, ctx, 12);

  assert.ok(ctx.gradients.length >= 2, "creates gradients for highlighted cells");
  assert.is(
    ctx.calls.filter((call) => call.type === "arc").length,
    ctx.gradients.length,
  );
  const [firstGradient] = ctx.gradients;

  assert.ok(firstGradient.stops.length >= 3, "radial gradient contains multiple stops");
  assert.ok(/rgba\(/.test(firstGradient.stops[0].color));
});

test("drawOverlays integrates celebration auras toggle", () => {
  const ctx = createMockContext();
  const snapshot = {
    entries: [{ row: 2, col: 1, fitness: 0.8 }],
    maxFitness: 1,
  };
  const grid = {
    getLastSnapshot: () => snapshot,
  };

  drawOverlays(grid, ctx, 10, {
    showCelebrationAuras: true,
    showObstacles: false,
  });

  assert.ok(ctx.gradients.length === 1, "overlay draws celebration aura when enabled");
});

if (import.meta.url === `file://${process.argv[1]}`) {
  test.run();
}
