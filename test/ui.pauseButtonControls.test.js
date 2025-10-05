import { assert, suite } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";

const test = suite("ui pause button controls");

test("pause toggle updates accessible state and delegates to simulation", async () => {
  const restore = setupDom();

  try {
    const toggleCalls = [];
    let pausedState = false;

    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        togglePause() {
          pausedState = !pausedState;
          toggleCalls.push(pausedState);

          return pausedState;
        },
      },
      "#app",
    );

    const pauseButton = uiManager.pauseButton;
    const stepButton = uiManager.stepButton;

    assert.ok(pauseButton, "pause button should render");
    assert.ok(stepButton, "step button should render");

    assert.is(pauseButton.textContent, "Pause");
    assert.is(pauseButton.getAttribute("aria-pressed"), "false");
    const pauseShortcuts = pauseButton.getAttribute("aria-keyshortcuts");

    assert.equal(pauseShortcuts.split(/\s+/), ["P", "Space"]);

    const pauseAnnouncement = pauseButton.getAttribute("aria-label");

    assert.is(pauseAnnouncement, "Pause the simulation. Shortcut: P or Space.");
    assert.is(pauseButton.title, pauseAnnouncement);
    assert.is(stepButton.disabled, true, "step should be disabled until paused");

    pauseButton.trigger("click");

    assert.equal(toggleCalls, [true], "togglePause callback should be invoked");
    assert.is(uiManager.isPaused(), true);
    assert.is(pauseButton.textContent, "Resume");
    assert.is(pauseButton.getAttribute("aria-pressed"), "true");

    const resumeAnnouncement = pauseButton.getAttribute("aria-label");

    assert.is(resumeAnnouncement, "Resume the simulation. Shortcut: P or Space.");
    assert.is(pauseButton.title, resumeAnnouncement);
    assert.is(stepButton.disabled, false, "step should enable while paused");

    pauseButton.trigger("click");

    assert.equal(toggleCalls, [true, false], "togglePause callback should run again");
    assert.is(uiManager.isPaused(), false);
    assert.is(pauseButton.textContent, "Pause");
    assert.is(pauseButton.getAttribute("aria-pressed"), "false");
    assert.is(pauseButton.getAttribute("aria-label"), pauseAnnouncement);
    assert.is(stepButton.disabled, true, "step should disable when resumed");
  } finally {
    restore();
  }
});

test.run();
