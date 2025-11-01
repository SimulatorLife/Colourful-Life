import { test } from "#tests/harness";
import assert from "node:assert/strict";

import { drawEnergyHeatmap } from "../src/ui/overlays.js";

function createFakeContext() {
  const texts = [];
  const gradient = { addColorStop() {} };

  return {
    texts,
    _fillStyle: null,
    _font: null,
    _textBaseline: null,
    _textAlign: null,
    set fillStyle(value) {
      this._fillStyle = value;
    },
    get fillStyle() {
      return this._fillStyle;
    },
    set font(value) {
      this._font = value;
    },
    set textBaseline(value) {
      this._textBaseline = value;
    },
    set textAlign(value) {
      this._textAlign = value;
    },
    save() {},
    restore() {},
    fillRect() {},
    createLinearGradient() {
      return gradient;
    },
    fillText(text) {
      texts.push(text);
    },
  };
}

test("energy heatmap legend reports typed array stats", () => {
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [new Float64Array([0, 1]), new Float64Array([0.5, 0.25])],
  };
  const ctx = createFakeContext();

  drawEnergyHeatmap(grid, ctx, 10, 2);

  assert.ok(
    ctx.texts.some((text) => text.includes("Max: 1.0 (50%)")),
    "expected legend to report the maximum energy",
  );
  assert.ok(
    ctx.texts.some((text) => text.includes("Mean: 0.4 (22%)")),
    "expected legend to report average energy for typed arrays",
  );
});
