import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";
import { findSliderByLabel } from "./helpers/controlQueries.js";

const test = suite("ui life event slider dedup");

test("setLifeEventFadeTicks and setLifeEventLimit share their normalization flow", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const notifications = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: (key, value) => {
          notifications.push([key, value]);
        },
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(600, 600) },
    );

    const fadeSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Marker Fade Window",
    );
    const limitSlider = findSliderByLabel(
      uiManager.controlsPanel,
      "Life Event Marker Limit",
    );

    assert.ok(fadeSlider, "fade slider should render");
    assert.ok(limitSlider, "limit slider should render");
    assert.is(
      fadeSlider,
      uiManager.lifeEventFadeSlider,
      "fade slider reference should match the rendered control",
    );
    assert.is(
      limitSlider,
      uiManager.lifeEventLimitSlider,
      "limit slider reference should match the rendered control",
    );

    uiManager.setLifeEventFadeTicks(48.4);
    assert.is(uiManager.getLifeEventFadeTicks(), 48);
    assert.is(fadeSlider.value, "48");

    uiManager.setLifeEventFadeTicks(0);
    assert.is(uiManager.getLifeEventFadeTicks(), 1, "fade ticks should floor to 1");
    assert.is(fadeSlider.value, "1");

    uiManager.setLifeEventLimit(12.9);
    assert.is(uiManager.getLifeEventLimit(), 12);
    assert.is(limitSlider.value, "12");

    uiManager.setLifeEventLimit(-3);
    assert.is(uiManager.getLifeEventLimit(), 0, "limit should floor to 0");
    assert.is(limitSlider.value, "0");

    uiManager.setLifeEventFadeTicks("not-a-number");
    assert.is(
      uiManager.getLifeEventFadeTicks(),
      48,
      "invalid fade inputs should keep the prior value",
    );

    uiManager.setLifeEventLimit("not-a-number");
    assert.is(
      uiManager.getLifeEventLimit(),
      0,
      "invalid limit inputs should keep the prior value",
    );

    const fadeNotifications = notifications.filter(
      ([key]) => key === "lifeEventFadeTicks",
    );
    const limitNotifications = notifications.filter(
      ([key]) => key === "lifeEventLimit",
    );

    assert.deepEqual(
      fadeNotifications,
      [
        ["lifeEventFadeTicks", 48],
        ["lifeEventFadeTicks", 1],
      ],
      "fade setter should notify only on meaningful changes",
    );

    assert.deepEqual(
      limitNotifications,
      [
        ["lifeEventLimit", 12],
        ["lifeEventLimit", 0],
      ],
      "limit setter should notify only on meaningful changes",
    );
  } finally {
    restore();
  }
});

test("life event setters respect notify=false without re-scheduling", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    let requestFrameCount = 0;
    const notifications = [];
    const uiManager = new UIManager(
      {
        requestFrame: () => {
          requestFrameCount += 1;
        },
        togglePause: () => false,
        step: () => {},
        onSettingChange: (key, value) => {
          notifications.push([key, value]);
        },
      },
      "#app",
      {},
      { canvasElement: new MockCanvas(600, 600) },
    );

    requestFrameCount = 0;
    notifications.length = 0;

    uiManager.setLifeEventFadeTicks(72, { notify: false });
    uiManager.setLifeEventLimit(18, { notify: false });

    assert.equal(notifications, [], "notify:false should suppress observers");
    assert.is(requestFrameCount, 2, "each setter should still schedule a frame");
    assert.is(uiManager.getLifeEventFadeTicks(), 72);
    assert.is(uiManager.getLifeEventLimit(), 18);
  } finally {
    restore();
  }
});
