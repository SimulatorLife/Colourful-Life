import { assert, test } from "#tests/harness";
import SelectionManager from "../src/grid/selectionManager.js";

function createManager(rows = 6, cols = 6, options) {
  return new SelectionManager(rows, cols, options);
}

test("activating built-in patterns restricts eligibility and updates descriptions", () => {
  const manager = createManager();

  assert.is(manager.hasActiveZones(), false, "no zones active by default");
  assert.is(manager.describeActiveZones(), "All tiles eligible");
  assert.is(
    manager.isInActiveZone(0, 0),
    true,
    "all tiles allowed when no zones active",
  );

  assert.is(manager.togglePattern("eastHalf", true), true);
  assert.ok(manager.hasActiveZones());
  assert.is(
    manager.isInActiveZone(2, 1),
    false,
    "west half should be inactive when eastHalf enabled",
  );
  assert.is(manager.isInActiveZone(2, 4), true, "east half should remain eligible");
  assert.is(manager.describeActiveZones(), "Eastern Hemisphere");

  manager.togglePattern("cornerPatches", true);
  assert.is(
    manager.describeActiveZones(),
    "Eastern Hemisphere, Corner Refuges",
    "multiple active patterns are listed by name",
  );
  assert.is(manager.isInActiveZone(0, 0), true, "corner refuge should be active");

  manager.togglePattern("eastHalf", false);
  manager.togglePattern("cornerPatches", false);
  assert.is(manager.hasActiveZones(), false);
  assert.is(manager.describeActiveZones(), "All tiles eligible");
  assert.is(
    manager.isInActiveZone(2, 1),
    true,
    "all tiles eligible after patterns disabled",
  );
});

test("togglePattern coerces boolean-like inputs", () => {
  const manager = createManager();
  const [pattern] = manager.getPatterns();

  assert.ok(pattern, "expected predefined pattern metadata");

  assert.is(
    manager.togglePattern(pattern.id, "false"),
    false,
    'string "false" should disable the pattern',
  );
  assert.is(manager.hasActiveZones(), false, "pattern remains inactive");

  assert.is(
    manager.togglePattern(pattern.id, "true"),
    true,
    'string "true" should enable the pattern',
  );
  assert.ok(manager.hasActiveZones(), "pattern activates after string true");

  assert.is(
    manager.togglePattern(pattern.id, 0),
    false,
    "numeric zero should disable the pattern",
  );
  assert.is(manager.hasActiveZones(), false, "numeric zero deactivates zones");

  assert.is(
    manager.togglePattern(pattern.id, 1),
    true,
    "numeric one should enable the pattern",
  );
  assert.ok(manager.hasActiveZones(), "numeric one activates the pattern");

  assert.is(
    manager.togglePattern(pattern.id),
    false,
    "omitting explicit state should continue to toggle",
  );
  assert.is(manager.hasActiveZones(), false, "toggle without argument deactivates");
});

test("central sanctuary pattern concentrates eligibility in the core", () => {
  const manager = createManager(12, 12);

  assert.is(
    manager.togglePattern("centralSanctuary", true),
    true,
    "pattern can be enabled",
  );

  const renderData = manager.getActiveZoneRenderData();

  assert.is(renderData.length, 1, "central sanctuary contributes one zone");

  const { geometry } = renderData[0];

  assert.ok(geometry, "geometry is available for the pattern");
  assert.ok(geometry.bounds, "bounds describe the active core region");
  assert.ok(
    geometry.bounds.startRow > 0 && geometry.bounds.startCol > 0,
    "core should sit away from the edges",
  );
  assert.ok(
    geometry.bounds.endRow < manager.rows - 1 &&
      geometry.bounds.endCol < manager.cols - 1,
    "core should leave a perimeter of inactive tiles",
  );

  const insideRow = Math.floor((geometry.bounds.startRow + geometry.bounds.endRow) / 2);
  const insideCol = Math.floor((geometry.bounds.startCol + geometry.bounds.endCol) / 2);

  assert.is(
    manager.isInActiveZone(insideRow, insideCol),
    true,
    "center of the sanctuary remains eligible",
  );

  const above = geometry.bounds.startRow - 1;
  const left = geometry.bounds.startCol - 1;
  const below = geometry.bounds.endRow + 1;
  const right = geometry.bounds.endCol + 1;

  if (above >= 0) {
    assert.is(
      manager.isInActiveZone(above, insideCol),
      false,
      "tiles above the sanctuary should be excluded",
    );
  }

  if (left >= 0) {
    assert.is(
      manager.isInActiveZone(insideRow, left),
      false,
      "tiles left of the sanctuary should be excluded",
    );
  }

  if (below < manager.rows) {
    assert.is(
      manager.isInActiveZone(below, insideCol),
      false,
      "tiles below the sanctuary should be excluded",
    );
  }

  if (right < manager.cols) {
    assert.is(
      manager.isInActiveZone(insideRow, right),
      false,
      "tiles right of the sanctuary should be excluded",
    );
  }
});

test("setDimensions preserves active patterns and refreshes geometry", () => {
  const manager = createManager(8, 8);

  manager.togglePattern("eastHalf", true);
  const initialRender = manager.getActiveZoneRenderData();

  assert.is(
    initialRender.length,
    1,
    "pattern should contribute geometry before resize",
  );

  manager.setDimensions(12, 10);

  assert.is(manager.rows, 12);
  assert.is(manager.cols, 10);
  assert.is(manager.hasActiveZones(), true, "active zones persist after resizing");
  assert.is(manager.describeActiveZones(), "Eastern Hemisphere");

  const resizedRender = manager.getActiveZoneRenderData();

  assert.is(resizedRender.length, 1, "geometry regenerated for active pattern");
  const { zone, geometry } = resizedRender[0];

  assert.is(zone.id, "eastHalf");
  assert.ok(geometry, "geometry available after resizing");
  assert.is(manager.zoneGeometryCache.size, 1, "cache populated for active pattern");
  assert.is(
    manager.isInActiveZone(0, 8),
    true,
    "cells in the eastern half remain eligible",
  );
  assert.is(
    manager.isInActiveZone(0, 1),
    false,
    "western cells become ineligible after resize",
  );

  assert.ok(
    geometry.bounds.endCol < manager.cols,
    "geometry bounds updated to reflect new dimensions",
  );
});

test("validateReproductionArea enforces zone boundaries for parents and spawn", () => {
  const manager = createManager();

  manager.togglePattern("eastHalf", true);

  assert.equal(manager.validateReproductionArea({ parentA: { row: 2, col: 1 } }), {
    allowed: false,
    role: "parentA",
    reason: "Parent is outside the reproductive zone",
  });

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 1, col: 3 },
      parentB: { row: 3, col: 2 },
    }),
    {
      allowed: false,
      role: "parentB",
      reason: "Mate is outside the reproductive zone",
    },
  );

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 1, col: 3 },
      parentB: { row: 2, col: 4 },
      spawn: { row: 0, col: 1 },
    }),
    {
      allowed: false,
      role: "spawn",
      reason: "Spawn tile is outside the reproductive zone",
    },
  );

  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 2, col: 4 },
      parentB: { row: 3, col: 5 },
      spawn: { row: 1, col: 3 },
    }),
    { allowed: true },
  );

  manager.togglePattern("eastHalf", false);
  assert.equal(
    manager.validateReproductionArea({
      parentA: { row: 2, col: 0 },
      spawn: { row: 4, col: 0 },
    }),
    { allowed: true },
    "with no active zones, any tile should be allowed",
  );
});

test("pattern geometry caches reuse entries and expose deterministic rectangles", () => {
  const manager = createManager(4, 6);

  assert.is(
    manager.togglePattern("unknown-pattern"),
    false,
    "unknown ids return false",
  );

  manager.togglePattern("eastHalf", true);

  const renderData = manager.getActiveZoneRenderData();

  assert.is(renderData.length, 1, "eastHalf pattern contributes one active zone");

  const { zone, geometry } = renderData[0];

  assert.is(zone.id, "eastHalf");
  assert.ok(geometry, "geometry should be available");
  assert.equal(geometry.bounds, { startRow: 0, endRow: 3, startCol: 3, endCol: 5 });
  assert.equal(
    geometry.rects,
    Array.from({ length: 4 }, (_, row) => ({ row, col: 3, rowSpan: 1, colSpan: 3 })),
    "each row is represented by a contiguous rectangle covering the eastern half",
  );

  assert.is(
    manager.zoneGeometryCache.size,
    1,
    "geometry cache should store the active pattern",
  );
  const cachedEntry = manager.zoneGeometryCache.get("eastHalf");

  assert.ok(cachedEntry, "eastHalf geometry is cached by id");
  assert.is(
    cachedEntry.geometry,
    geometry,
    "cache should reuse the same geometry object",
  );

  const secondPass = manager.getActiveZoneRenderData()[0].geometry;

  assert.is(secondPass, geometry, "subsequent requests reuse cached geometry");
});

test("geometry cache invalidates on toggles and dimension changes", () => {
  const manager = createManager(4, 6);

  manager.togglePattern("eastHalf", true);
  const initialGeometry = manager.getActiveZoneRenderData()[0].geometry;

  manager.togglePattern("eastHalf", false);
  assert.is(
    manager.zoneGeometryCache.has("eastHalf"),
    false,
    "disabling removes cached geometry",
  );

  manager.togglePattern("eastHalf", true);
  const geometryAfterRetoggle = manager.getActiveZoneRenderData()[0].geometry;

  assert.ok(
    geometryAfterRetoggle !== initialGeometry,
    "retoggling recomputes geometry",
  );

  manager.setDimensions(10, 10);
  manager.togglePattern("eastHalf", true);
  const geometryAfterResize = manager.getActiveZoneRenderData()[0].geometry;

  assert.equal(geometryAfterResize.bounds, {
    startRow: 0,
    endRow: 9,
    startCol: 5,
    endCol: 9,
  });
});

test("zone contains predicates throwing are handled gracefully", () => {
  const manager = createManager(3, 3);
  const originalWarn = console.warn;
  const warnings = [];

  console.warn = (...args) => {
    warnings.push(args);
  };

  manager.patterns.set("custom", {
    id: "custom",
    name: "Custom Zone",
    color: "rgba(255,255,255,0.1)",
    contains(row, col) {
      if (row === 1 && col === 1) {
        throw new Error("boom");
      }

      return row === col;
    },
    active: false,
  });

  try {
    assert.is(manager.togglePattern("custom", true), true);

    assert.is(
      manager.isInActiveZone(1, 1),
      false,
      "thrown predicate results in tile treated as outside",
    );

    const renderData = manager.getActiveZoneRenderData();

    assert.is(renderData.length, 1, "custom zone contributes render data");

    const { geometry } = renderData[0];

    assert.equal(
      geometry.rects,
      [
        { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
        { row: 2, col: 2, rowSpan: 1, colSpan: 1 },
      ],
      "tiles throwing during evaluation are skipped",
    );

    assert.ok(warnings.length >= 1, "warnings emitted when predicate throws");
    assert.match(
      warnings[0][0],
      /Selection zone "Custom Zone" predicate threw/,
      "warning identifies the zone",
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("constructor options allow registering custom patterns", () => {
  const manager = createManager(6, 6, {
    patterns: [
      {
        id: "diagonalOnly",
        name: "Diagonal Bloom",
        description: "Limit reproduction to the main diagonal.",
        contains: (row, col) => row === col,
        color: "rgba(255, 255, 255, 0.2)",
        active: true,
      },
    ],
  });

  const patterns = manager.getPatterns();
  const diagonal = patterns.find((pattern) => pattern.id === "diagonalOnly");

  assert.ok(diagonal, "custom pattern should be registered");
  assert.is(diagonal.active, true, "custom pattern honours initial active flag");
  assert.is(manager.describeActiveZones(), "Diagonal Bloom");
  assert.is(manager.isInActiveZone(2, 2), true, "diagonal tiles remain eligible");
  assert.is(
    manager.isInActiveZone(2, 3),
    false,
    "off-diagonal tiles are excluded by the custom predicate",
  );

  manager.setDimensions(8, 8);

  const resizedPatterns = manager.getPatterns();
  const afterResize = resizedPatterns.find((pattern) => pattern.id === "diagonalOnly");

  assert.ok(afterResize, "custom pattern persists after resizing");
  assert.is(afterResize.active, true, "active state survives dimension changes");
  assert.is(
    manager.isInActiveZone(3, 3),
    true,
    "predicate recalculates with new bounds",
  );
  assert.is(
    manager.isInActiveZone(3, 4),
    false,
    "tiles outside the diagonal remain ineligible after resizing",
  );
});

test("definePatterns hook re-runs when the grid dimensions change", () => {
  const invocations = [];
  const manager = createManager(5, 7, {
    definePatterns({ rows, cols, addPattern }) {
      invocations.push({ rows, cols });
      addPattern({
        id: "outerRing",
        name: "Outer Ring",
        contains: (row, col) =>
          row === 0 || col === 0 || row === rows - 1 || col === cols - 1,
      });
    },
  });

  assert.is(invocations.length, 1, "hook invoked during construction");
  assert.equal(invocations[0], { rows: 5, cols: 7 });

  manager.togglePattern("outerRing", true);

  assert.is(manager.isInActiveZone(0, 3), true, "edge tiles remain eligible");
  assert.is(manager.isInActiveZone(2, 3), false, "interior tiles are excluded");

  manager.setDimensions(4, 6);

  assert.is(invocations.length, 2, "hook re-invoked after resizing");
  assert.equal(invocations[1], { rows: 4, cols: 6 });
  assert.is(
    manager.isInActiveZone(0, 2),
    true,
    "edge predicate recalculates after resize",
  );
  assert.is(
    manager.isInActiveZone(2, 2),
    false,
    "interior remains excluded after resize",
  );
});
