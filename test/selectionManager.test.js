import { test } from "uvu";
import * as assert from "uvu/assert";
import SelectionManager from "../src/selectionManager.js";

function createManager(rows = 6, cols = 6) {
  return new SelectionManager(rows, cols);
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

test("addCustomRectangle clamps coordinates and exposes accurate bounds/contains", () => {
  const manager = createManager();
  const zone = manager.addCustomRectangle(-2, -5, 12, 9);

  assert.ok(zone, "custom zone should be created");
  assert.is(zone.id, "custom-0");
  assert.equal(zone.bounds, { startRow: 0, endRow: 5, startCol: 0, endCol: 5 });
  assert.is(zone.contains(0, 0), true, "clamped origin should be contained");
  assert.is(zone.contains(5, 5), true, "clamped corner should be contained");
  assert.is(zone.contains(3, 3), true);
  assert.is(
    zone.contains(5, 6),
    false,
    "coordinates outside bounds should fail contains",
  );

  assert.is(
    manager.getActiveZones().length,
    1,
    "custom zones contribute to active zones",
  );
  assert.is(manager.hasCustomZones(), true, "custom zone presence is reflected");

  manager.clearCustomZones();
  assert.is(manager.getActiveZones().length, 0, "clearCustomZones removes user zones");
  assert.is(
    manager.hasCustomZones(),
    false,
    "custom zone tracker resets after clearing",
  );
  assert.is(manager.describeActiveZones(), "All tiles eligible");
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

test("geometry cache invalidates on toggles, dimension changes, and custom zone resets", () => {
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

  const customZone = manager.addCustomRectangle(2, 2, 4, 4);
  const renderData = manager.getActiveZoneRenderData();

  const customEntry = renderData.find((entry) => entry.zone.id === customZone.id);

  assert.ok(customEntry, "custom zone should appear in render data");
  assert.equal(
    customEntry.geometry.bounds,
    customZone.bounds,
    "custom geometry mirrors bounds",
  );

  manager.clearCustomZones();
  assert.is(
    manager.zoneGeometryCache.size,
    0,
    "clearing custom zones resets geometry cache",
  );

  const renderAfterReset = manager.getActiveZoneRenderData();

  assert.is(
    renderAfterReset.length,
    1,
    "pattern remains active after clearing custom zones",
  );
  assert.equal(
    renderAfterReset[0].geometry.bounds,
    { startRow: 0, endRow: 9, startCol: 5, endCol: 9 },
    "pattern geometry recomputes after cache reset",
  );
});

test("addCustomRectangle returns null for invalid coordinates and retains counters", () => {
  const manager = createManager();

  const result = manager.addCustomRectangle(NaN, 1, 3, 4);

  assert.is(result, null, "invalid coordinates short-circuit custom zone creation");
  assert.is(
    manager.customZones.length,
    0,
    "custom zone counter does not increment on failure",
  );
  assert.is(manager.zoneGeometryCache.size, 0, "geometry cache remains untouched");
});

test.run();
