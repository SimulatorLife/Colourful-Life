import { assert, suite } from "#tests/harness";
import { MockCanvas, MockElement, setupDom } from "./helpers/mockDom.js";

const test = suite("ui snapshot button");

test("save snapshot button downloads canvas image", async () => {
  const restore = setupDom();

  const originalCreateElement = document.createElement;
  const createdAnchors = [];
  let anchorClickCount = 0;

  document.createElement = (tagName) => {
    if (typeof tagName === "string" && tagName.toLowerCase() === "a") {
      const anchor = new MockElement("a");

      anchor.addEventListener("click", () => {
        anchorClickCount += 1;
      });
      createdAnchors.push(anchor);

      return anchor;
    }

    return originalCreateElement.call(document, tagName);
  };

  try {
    const canvas = new MockCanvas(160, 160);
    let toDataURLCalls = 0;

    canvas.toDataURL = (type = "image/png") => {
      toDataURLCalls += 1;

      return `data:${type};base64,fake-image`;
    };

    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager({}, "#app", {}, { canvasElement: canvas });

    const button = uiManager.snapshotButton;

    assert.ok(button, "snapshot button should render");
    assert.equal(button.textContent, "Save Snapshot");
    assert.equal(
      button.getAttribute("aria-keyshortcuts"),
      "C",
      "hotkey is announced to assistive tech",
    );

    button.trigger("click");

    assert.is(toDataURLCalls, 1, "canvas toDataURL is invoked once");
    assert.equal(createdAnchors.length, 1, "download link is created");

    const [anchor] = createdAnchors;

    assert.match(
      anchor.getAttribute("download"),
      "colourful-life-",
      "filename uses the colourful-life prefix",
    );
    assert.match(anchor.href, "data:image/png;base64,fake-image");
    assert.is(anchorClickCount, 1, "download link receives a click");
    assert.is(anchor.parentElement, null, "temporary link is removed after click");
  } finally {
    document.createElement = originalCreateElement;
    restore();
  }
});

test("snapshot keyboard shortcut downloads the canvas", async () => {
  const restore = setupDom();

  const originalCreateElement = document.createElement;
  const createdAnchors = [];
  let anchorClickCount = 0;

  document.createElement = (tagName) => {
    if (typeof tagName === "string" && tagName.toLowerCase() === "a") {
      const anchor = new MockElement("a");

      anchor.addEventListener("click", () => {
        anchorClickCount += 1;
      });
      createdAnchors.push(anchor);

      return anchor;
    }

    return originalCreateElement.call(document, tagName);
  };

  try {
    const canvas = new MockCanvas(120, 120);
    let toDataURLCalls = 0;

    canvas.toDataURL = () => {
      toDataURLCalls += 1;

      return "data:image/png;base64,keyboard";
    };

    const { default: UIManager } = await import("../src/ui/uiManager.js");

    const uiManager = new UIManager({}, "#app", {}, { canvasElement: canvas });

    const handlers = document.eventListeners?.keydown ?? [];

    assert.ok(handlers.length > 0, "document registers keydown listeners");

    const event = {
      key: "c",
      target: document.body,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };

    handlers.forEach((handler) => handler(event));

    assert.is(event.defaultPrevented, true, "hotkey prevents default behaviour");
    assert.is(toDataURLCalls, 1, "hotkey triggers a snapshot capture");
    assert.equal(anchorClickCount, 1, "hotkey clicks the download link");
    assert.equal(createdAnchors.length, 1, "hotkey creates a download link");
  } finally {
    document.createElement = originalCreateElement;
    restore();
  }
});

test.run();
