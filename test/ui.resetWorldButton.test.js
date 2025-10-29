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

test("keyboard shortcut regenerates the world", async () => {
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
    assert.equal(
      button.getAttribute("aria-keyshortcuts"),
      "R",
      "hotkey is announced to assistive tech",
    );

    const keydownHandlers = document.eventListeners?.keydown ?? [];

    assert.ok(keydownHandlers.length > 0, "document listens for keyboard shortcuts");

    const event = {
      key: "r",
      shiftKey: true,
      target: document.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };

    keydownHandlers.forEach((handler) => handler(event));

    assert.equal(
      resetWorldCalls,
      [{ randomizeObstacles: true }],
      "hotkey triggers a randomized regeneration",
    );
    assert.is(event.defaultPrevented, true, "hotkey prevents default browser behavior");
    assert.is(button.getAttribute("data-busy"), "true", "hotkey enters busy state");
    assert.is(
      button.getAttribute("data-busy-mode"),
      "randomize",
      "hotkey inherits shift modifier",
    );

    while (rafQueue.length > 0) {
      const next = rafQueue.shift();

      if (typeof next === "function") next(0);
    }

    assert.equal(
      button.getAttribute("aria-disabled"),
      "false",
      "busy state clears after regeneration",
    );
  } finally {
    restore();
  }
});

test.run();
