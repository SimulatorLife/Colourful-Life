import { assert, test } from "#tests/harness";
import { resolveBootstrapOptions, __test__ } from "../src/bootstrapConfig.js";

test("resolveBootstrapOptions falls back to defaults", () => {
  const canvas = { tagName: "CANVAS" };
  const documentRef = {
    getElementById(id) {
      return id === __test__.DEFAULT_CANVAS_ID ? canvas : null;
    },
  };

  const options = resolveBootstrapOptions({ documentRef });

  assert.is(options.canvas, canvas);
  assert.equal(options.config, { cellSize: __test__.DEFAULT_BOOT_CONFIG.cellSize });
  assert.is(options.defaultCanvasId, __test__.DEFAULT_CANVAS_ID);
});

test("resolveBootstrapOptions merges global overrides", () => {
  const canvas = { tagName: "CANVAS" };
  const documentRef = {
    getElementById(id) {
      return id === "customCanvas" ? canvas : null;
    },
    querySelector() {
      return null;
    },
  };
  const options = resolveBootstrapOptions({
    documentRef,
    globalOptions: {
      canvasId: "customCanvas",
      config: { cellSize: 8, updatesPerSecond: 90 },
      headless: true,
    },
  });

  assert.is(options.canvas, canvas);
  assert.equal(options.config, { cellSize: 8, updatesPerSecond: 90 });
  assert.is(options.defaultCanvasId, "customCanvas");
  assert.is(options.headless, true);
});

test("resolveBootstrapOptions accepts string canvas selector", () => {
  const canvas = { tagName: "CANVAS" };
  const documentRef = {
    getElementById() {
      return null;
    },
    querySelector(selector) {
      return selector === "#alt" ? canvas : null;
    },
  };

  const options = resolveBootstrapOptions({
    documentRef,
    globalOptions: { canvas: "#alt", config: { cellSize: 6 } },
  });

  assert.is(options.canvas, canvas);
  assert.equal(options.config, { cellSize: 6 });
  assert.is(options.defaultCanvasId, __test__.DEFAULT_CANVAS_ID);
});

test("resolveBootstrapOptions preserves explicit defaultCanvasId", () => {
  const options = resolveBootstrapOptions({
    globalOptions: {
      defaultCanvasId: "preferred",
      canvasId: "ignored",
      config: { cellSize: 9 },
    },
  });

  assert.is(options.defaultCanvasId, "preferred");
  assert.equal(options.config, { cellSize: 9 });
  assert.is(options.canvas, null);
});
