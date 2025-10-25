import { assert, suite } from "#tests/harness";
import GridManager from "../src/grid/gridManager.js";
import SelectionManager from "../src/grid/selectionManager.js";

const test = suite("GridManager resetWorld selection zones");

function createGrid(rows = 6, cols = 6) {
  const selectionManager = new SelectionManager(rows, cols);
  const grid = new GridManager(rows, cols, {
    selectionManager,
    initialObstaclePreset: "none",
    randomizeInitialObstacles: false,
  });

  return { grid, selectionManager };
}

test("resetWorld clears active selection zones when requested", () => {
  const { grid, selectionManager } = createGrid();
  const [pattern] = selectionManager.getPatterns();

  assert.ok(pattern, "expected at least one predefined pattern");
  selectionManager.togglePattern(pattern.id, true);
  assert.is(selectionManager.hasActiveZones(), true, "pattern should be active");

  grid.resetWorld({ clearCustomZones: true });

  assert.is(
    selectionManager.hasActiveZones(),
    false,
    "active zones should be cleared during reset",
  );
});

test("resetWorld preserves selection zones by default", () => {
  const { grid, selectionManager } = createGrid();
  const [pattern] = selectionManager.getPatterns();

  selectionManager.togglePattern(pattern.id, true);

  grid.resetWorld();

  assert.is(
    selectionManager.hasActiveZones(),
    true,
    "active zones should persist without clearCustomZones",
  );
});
