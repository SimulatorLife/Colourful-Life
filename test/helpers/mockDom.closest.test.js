import { assert, test } from "#tests/harness";
import { MockElement } from "./mockDom.js";

test("mock elements support closest traversal", () => {
  const root = new MockElement("section");

  root.classList.add("control-line");

  const child = new MockElement("div");
  const grandchild = new MockElement("button");

  root.appendChild(child);
  child.appendChild(grandchild);

  assert.is(
    grandchild.closest(".control-line"),
    root,
    "closest should return the nearest ancestor with the matching class",
  );

  assert.is(
    grandchild.closest("section"),
    root,
    "tag selectors should be matched case-insensitively",
  );

  assert.is(
    child.closest("#missing"),
    null,
    "closest should return null when no ancestor matches",
  );
});
