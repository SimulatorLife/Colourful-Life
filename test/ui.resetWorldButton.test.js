import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";

const test = suite("ui reset world button");

test("regenerate world button shows busy feedback while resetting", async () => {
  const restore = setupDom();

  try {
    const rafQueue = [];

    window.requestAnimationFrame = (callback) => {
      if (typeof callback === "function") {
        rafQueue.push(callback);
      }

      return rafQueue.length;
    };

    const resetWorldCalls = [];
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        resetWorld: (options) => {
          resetWorldCalls.push(options);
        },
      },
      "#app",
    );

    const button = uiManager.resetWorldButton;

    assert.ok(button, "reset world button should render");
    assert.not.ok(button.disabled, "button starts enabled");
    assert.is(button.getAttribute("data-busy"), null);

    button.trigger("click");

    assert.equal(resetWorldCalls, [{ randomizeObstacles: false }]);
    assert.is(button.disabled, true, "button disables while busy");
    assert.is(button.getAttribute("aria-disabled"), "true");
    assert.is(button.getAttribute("data-busy"), "true");
    assert.is(button.getAttribute("data-busy-mode"), null);
    assert.is(button.textContent, "Regenerating…");
    assert.match(
      button.getAttribute("aria-label"),
      "Regenerating the world",
      "busy label announces the in-progress action",
    );

    button.trigger("click");

    assert.equal(
      resetWorldCalls,
      [{ randomizeObstacles: false }],
      "additional clicks while busy should be ignored",
    );

    while (rafQueue.length > 0) {
      const next = rafQueue.shift();

      if (typeof next === "function") next(0);
    }

    assert.is(button.disabled, false, "button re-enables after reset");
    assert.is(button.getAttribute("aria-disabled"), "false");
    assert.is(button.getAttribute("data-busy"), null);
    assert.is(button.getAttribute("data-busy-mode"), null);
    assert.is(button.textContent, "Regenerate World");
    assert.is(button.getAttribute("aria-label"), null);

    button.trigger("click", { shiftKey: true });

    assert.equal(resetWorldCalls, [
      { randomizeObstacles: false },
      { randomizeObstacles: true },
    ]);
    assert.is(button.getAttribute("data-busy"), "true");
    assert.is(button.getAttribute("data-busy-mode"), "randomize");
    assert.match(
      button.getAttribute("aria-label"),
      "new obstacle layout",
      "busy label reflects randomization",
    );

    while (rafQueue.length > 0) {
      const next = rafQueue.shift();

      if (typeof next === "function") next(0);
    }

    assert.is(button.disabled, false);
    assert.is(button.getAttribute("aria-disabled"), "false");
    assert.is(button.textContent, "Regenerate World");
  } finally {
    restore();
  }
});

test.run();
