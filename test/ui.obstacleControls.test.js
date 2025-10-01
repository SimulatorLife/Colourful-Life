import { suite } from "uvu";
import * as assert from "uvu/assert";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui obstacle controls");

test("linger penalty slider renders without obstacle presets", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      { obstaclePresets: [], getCellSize: () => 5 },
      { canvasElement: new MockCanvas(400, 400) },
    );

    assert.ok(uiManager.lingerPenaltySlider, "slider should be created");
    assert.is(uiManager.lingerPenaltySlider.tagName, "INPUT");
    assert.is(uiManager.lingerPenaltySlider.type, "range");
    assert.ok(
      uiManager.lingerPenaltySlider.parentElement,
      "slider should be attached to the DOM",
    );
  } finally {
    restore();
  }
});

test.run();
