import { assert, suite } from "#tests/harness";
import { MockCanvas, MockPointerEvent, setupDom } from "./helpers/mockDom.js";

const test = suite("ui selection drawing");

test("selection drawing respects canvas CSS scaling", async () => {
  const restore = setupDom();

  try {
    const [{ default: UIManager }, { default: SelectionManager }] = await Promise.all([
      import("../src/ui/uiManager.js"),
      import("../src/grid/selectionManager.js"),
    ]);

    const selectionManager = new SelectionManager(120, 120);
    const canvas = new MockCanvas(600, 600);

    canvas.boundingRect = { left: 0, top: 0, width: 300, height: 300 };

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      { selectionManager, getCellSize: () => 5 },
      { canvasElement: canvas },
    );

    uiManager.drawZoneButton.trigger("click");

    const pointerDown = new MockPointerEvent({
      clientX: 50,
      clientY: 50,
      pointerId: 1,
    });
    const pointerMove = new MockPointerEvent({
      clientX: 250,
      clientY: 250,
      pointerId: 1,
    });
    const pointerUp = new MockPointerEvent({
      clientX: 250,
      clientY: 250,
      pointerId: 1,
    });

    canvas.trigger("pointerdown", pointerDown);
    canvas.trigger("pointermove", pointerMove);
    canvas.trigger("pointerup", pointerUp);

    assert.is(selectionManager.customZones.length, 1, "custom zone should be created");
    const bounds = selectionManager.customZones[0].bounds;

    assert.equal(bounds, {
      startRow: 20,
      endRow: 100,
      startCol: 20,
      endCol: 100,
    });
  } finally {
    restore();
  }
});
