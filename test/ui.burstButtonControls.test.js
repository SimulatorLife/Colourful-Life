import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui burst button controls");

test("burst button announces shortcuts and triggers bursts", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const burstCalls = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        burst: (options) => {
          burstCalls.push(options);
        },
      },
      { canvasElement: new MockCanvas(320, 320) },
    );

    const burstButton = uiManager.burstButton;

    assert.ok(burstButton, "burst button should render");
    assert.is(burstButton.textContent, "Burst New Cells");

    const burstLabel = burstButton.getAttribute("aria-label");

    assert.ok(
      burstLabel.includes("Shortcut: B."),
      "burst button label should surface keyboard shortcut",
    );
    assert.ok(
      burstLabel.includes("Hold Shift for a stronger burst"),
      "burst button label should describe the shift modifier",
    );
    assert.is(burstButton.title, burstLabel, "title should mirror aria-label");
    assert.is(
      burstButton.getAttribute("aria-keyshortcuts"),
      "B",
      "aria-keyshortcuts should advertise the burst hotkey",
    );

    burstButton.trigger("click");

    assert.equal(
      burstCalls,
      [{ count: 200, radius: 6 }],
      "default click should trigger a standard burst",
    );

    burstButton.trigger("click", { shiftKey: true });

    assert.equal(
      burstCalls,
      [
        { count: 200, radius: 6 },
        { count: 400, radius: 9 },
      ],
      "shift-click should trigger an intensified burst",
    );

    const keydownHandlers = global.document.eventListeners?.keydown ?? [];

    assert.ok(
      keydownHandlers.length > 0,
      "UI manager should register a document keydown handler",
    );

    const keyboardEvent = {
      key: "b",
      shiftKey: true,
      target: global.document.body,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };

    keydownHandlers.forEach((handler) => handler(keyboardEvent));

    assert.is(
      keyboardEvent.defaultPrevented,
      true,
      "burst hotkey should prevent default browser actions",
    );
    assert.equal(
      burstCalls,
      [
        { count: 200, radius: 6 },
        { count: 400, radius: 9 },
        { count: 400, radius: 9 },
      ],
      "keyboard hotkey should trigger the stronger burst when shift is held",
    );
  } finally {
    restore();
  }
});

test("burst button respects configurable presets", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const burstCalls = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        burst: (options) => {
          burstCalls.push(options);
        },
      },
      {
        canvasElement: new MockCanvas(320, 320),
        burstOptions: {
          primary: { count: 75, radius: 3.5 },
          shift: {
            count: 180,
            radius: 7.5,
            hint: "Hold Shift for a wide scatter.",
            shortcutHint: "Hold Shift for a wide scatter, including shortcuts.",
          },
        },
      },
    );

    const burstButton = uiManager.burstButton;

    assert.ok(burstButton, "burst button should render");
    assert.match(
      burstButton.getAttribute("aria-label"),
      /wide scatter/,
      "custom hint should surface in the button label",
    );

    burstButton.trigger("click");
    burstButton.trigger("click", { shiftKey: true });

    assert.equal(
      burstCalls,
      [
        { count: 75, radius: 3.5 },
        { count: 180, radius: 7.5 },
      ],
      "configured burst presets should be forwarded to the action handler",
    );
  } finally {
    restore();
  }
});

test.run();
