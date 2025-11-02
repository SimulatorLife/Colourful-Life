import { assert, test } from "#tests/harness";
import { setupDom } from "./helpers/mockDom.js";

function captureBaseline() {
  const hasDocument = Object.prototype.hasOwnProperty.call(globalThis, "document");
  const hasNode = Object.prototype.hasOwnProperty.call(globalThis, "Node");
  const hasHTMLElement = Object.prototype.hasOwnProperty.call(
    globalThis,
    "HTMLElement",
  );
  const hasWindow = Object.prototype.hasOwnProperty.call(globalThis, "window");

  return {
    hasDocument,
    document: hasDocument ? globalThis.document : undefined,
    hasNode,
    Node: hasNode ? globalThis.Node : undefined,
    hasHTMLElement,
    HTMLElement: hasHTMLElement ? globalThis.HTMLElement : undefined,
    hasWindow,
    window: hasWindow ? globalThis.window : undefined,
  };
}

test("setupDom restores baseline when nested contexts resolve out of order", () => {
  const baseline = captureBaseline();
  const restoreOuter = setupDom();
  const restoreInner = setupDom();
  const innerSnapshot = {
    document: globalThis.document,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    window: globalThis.window,
  };

  try {
    restoreOuter();

    assert.is(globalThis.document, innerSnapshot.document);
    assert.is(globalThis.Node, innerSnapshot.Node);
    assert.is(globalThis.HTMLElement, innerSnapshot.HTMLElement);
    assert.is(globalThis.window, innerSnapshot.window);
  } finally {
    restoreInner();

    if (baseline.hasDocument) {
      assert.is(globalThis.document, baseline.document);
    } else {
      assert.is(globalThis.document, undefined);
    }

    if (baseline.hasNode) {
      assert.is(globalThis.Node, baseline.Node);
    } else {
      assert.is(globalThis.Node, undefined);
    }

    if (baseline.hasHTMLElement) {
      assert.is(globalThis.HTMLElement, baseline.HTMLElement);
    } else {
      assert.is(globalThis.HTMLElement, undefined);
    }

    if (baseline.hasWindow) {
      assert.is(globalThis.window, baseline.window);
    } else {
      assert.is(globalThis.window, undefined);
    }
  }

  // Clean up in case restoreInner throws.
  restoreOuter();

  if (baseline.hasDocument) {
    assert.is(globalThis.document, baseline.document);
  } else {
    assert.is(globalThis.document, undefined);
  }

  if (baseline.hasNode) {
    assert.is(globalThis.Node, baseline.Node);
  } else {
    assert.is(globalThis.Node, undefined);
  }

  if (baseline.hasHTMLElement) {
    assert.is(globalThis.HTMLElement, baseline.HTMLElement);
  } else {
    assert.is(globalThis.HTMLElement, undefined);
  }

  if (baseline.hasWindow) {
    assert.is(globalThis.window, baseline.window);
  } else {
    assert.is(globalThis.window, undefined);
  }
});
