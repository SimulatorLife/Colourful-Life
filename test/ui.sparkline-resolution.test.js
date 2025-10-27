import { suite, assert } from "#tests/harness";
import UIManager from "../src/ui/uiManager.js";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const sparkSuite = suite("ui manager: sparklines");

let restoreDom;

sparkSuite.before(() => {
  restoreDom = setupDom();
  if (global.window) {
    global.window.devicePixelRatio = 2;
  }
});

sparkSuite.after(() => {
  if (typeof restoreDom === "function") {
    restoreDom();
  }
});

sparkSuite("drawSpark scales canvas to match display size", () => {
  const manager = new UIManager({}, "#app");
  const canvas = new MockCanvas(220, 48);

  canvas.boundingRect = { left: 0, top: 0, width: 300, height: 60 };
  Object.defineProperty(canvas, "clientWidth", { value: 300, configurable: true });
  Object.defineProperty(canvas, "clientHeight", { value: 60, configurable: true });

  const context = canvas.getContext("2d");

  manager.drawSpark(canvas, [0, 1, 2, 3], "#fff");

  assert.is(canvas.width, 600);
  assert.is(canvas.height, 120);
  assert.equal(context.lastTransform, { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
});

sparkSuite.run();
