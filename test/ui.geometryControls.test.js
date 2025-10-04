import { assert, suite } from "#tests/harness";
import { MockCanvas, setupDom } from "./helpers/mockDom.js";

const test = suite("ui geometry controls");

function findButtonByText(root, text) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift();

    if (!node) continue;
    if (node.tagName === "BUTTON" && node.textContent === text) return node;
    if (Array.isArray(node.children)) queue.push(...node.children);
  }

  return null;
}

function findNumberInputByLabel(root, label) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.shift();

    if (!node) continue;
    if (node.className?.includes?.("control-row")) {
      const [name, line] = node.children || [];

      if (name?.textContent === label) {
        if (Array.isArray(line?.children)) {
          return line.children.find((child) => child?.tagName === "INPUT") ?? null;
        }
      }
    }

    if (Array.isArray(node.children)) queue.push(...node.children);
  }

  return null;
}

test("Apply Geometry preserves population by default", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const geometryCalls = [];

    const uiManager = new UIManager(
      {
        requestFrame: () => {},
        togglePause: () => false,
        step: () => {},
        onSettingChange: () => {},
      },
      "#app",
      {
        setWorldGeometry: (options) => {
          geometryCalls.push(options);

          return {
            cellSize: options.cellSize ?? 5,
            rows: options.rows ?? 60,
            cols: options.cols ?? 60,
          };
        },
        getCellSize: () => 5,
        getGridDimensions: () => ({ rows: 60, cols: 60, cellSize: 5 }),
      },
      { canvasElement: new MockCanvas(300, 300) },
    );

    const rowsInput = findNumberInputByLabel(uiManager.controlsPanel, "Rows");
    const applyButton = findButtonByText(uiManager.controlsPanel, "Apply Geometry");

    assert.ok(rowsInput, "rows input should exist");
    assert.ok(applyButton, "apply button should exist");

    rowsInput.value = "80";
    rowsInput.dispatchEvent({ type: "input" });

    applyButton.dispatchEvent({ type: "click" });

    assert.equal(geometryCalls.length, 1, "geometry apply should invoke action");
    assert.is(geometryCalls[0].reseed, false, "default click preserves population");

    rowsInput.value = "90";
    rowsInput.dispatchEvent({ type: "input" });

    applyButton.dispatchEvent({ type: "click", shiftKey: true });

    assert.equal(geometryCalls.length, 2, "second apply should invoke action again");
    assert.is(geometryCalls[1].reseed, true, "shift-click requests reseed");
  } finally {
    restore();
  }
});

test("setGridGeometry mirrors engine dimensions outside UI bounds", async () => {
  const restore = setupDom();

  try {
    const { default: UIManager } = await import("../src/ui/uiManager.js");
    const geometryCalls = [];

    const uiManager = new UIManager(
      { requestFrame: () => {} },
      "#app",
      {
        setWorldGeometry: (options) => {
          geometryCalls.push(options);

          return {
            cellSize: options.cellSize ?? 5,
            rows: options.rows ?? 60,
            cols: options.cols ?? 60,
          };
        },
        getCellSize: () => 5,
        getGridDimensions: () => ({ rows: 60, cols: 60, cellSize: 5 }),
      },
      { canvasElement: new MockCanvas(240, 240) },
    );

    uiManager.setGridGeometry({ rows: 20, cols: 18, cellSize: 3 });

    const controls = uiManager.geometryControls ?? {};
    const {
      rowsInput,
      colsInput,
      cellSizeInput,
      applyButton,
      summaryEl,
      summaryNoteEl,
    } = controls;

    assert.ok(uiManager.geometryControls, "geometry controls should be defined");

    assert.ok(rowsInput, "rows input should be present");
    assert.ok(colsInput, "columns input should be present");
    assert.ok(cellSizeInput, "cell size input should be present");
    assert.ok(applyButton, "apply button should exist");

    assert.is(rowsInput.value, "20", "rows input should reflect actual grid rows");
    assert.is(colsInput.value, "18", "cols input should reflect actual grid cols");
    assert.is(
      cellSizeInput.value,
      "3",
      "cell size input should reflect actual cell size",
    );
    assert.is(uiManager.gridRows, 20, "UI manager should store the raw row count");
    assert.is(uiManager.gridCols, 18, "UI manager should store the raw column count");
    assert.is(
      uiManager.currentCellSize,
      3,
      "UI manager should store the raw cell size",
    );
    assert.is(applyButton.disabled, true, "syncing geometry should not queue an apply");

    const summaryState = summaryEl?.getAttribute("data-state");

    assert.is(summaryState, "current", "geometry summary should report current state");

    const summaryNote = summaryNoteEl?.textContent ?? "";

    assert.ok(
      summaryNote.includes("Adjusted to stay within limits"),
      "summary should describe adjustments when values exceed UI bounds",
    );
  } finally {
    restore();
  }
});

test.run();
