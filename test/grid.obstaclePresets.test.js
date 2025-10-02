import { assert, test } from "#tests/harness";

const obstaclePresetsModulePromise = import("../src/grid/obstaclePresets.js");

test("resolveObstaclePresetCatalog clones defaults when no overrides provided", async () => {
  const { resolveObstaclePresetCatalog, OBSTACLE_PRESETS } =
    await obstaclePresetsModulePromise;

  const catalog = resolveObstaclePresetCatalog();

  assert.ok(Array.isArray(catalog));
  assert.is.not(
    catalog,
    OBSTACLE_PRESETS,
    "default resolution should not reuse the exported constant array",
  );
  assert.is(catalog.length, OBSTACLE_PRESETS.length);

  catalog.forEach((entry, index) => {
    assert.is.not(
      entry,
      OBSTACLE_PRESETS[index],
      "default entries should be cloned to avoid shared mutation",
    );
    assert.equal(entry, OBSTACLE_PRESETS[index]);
  });
});

test("resolveObstaclePresetCatalog merges overrides while preserving defaults", async () => {
  const { resolveObstaclePresetCatalog } = await obstaclePresetsModulePromise;

  const overrides = [
    { id: "midline", label: "Bridge Run", description: "Custom midline variant." },
    { id: "custom-maze", label: "Custom Maze", description: 123 },
  ];

  const catalog = resolveObstaclePresetCatalog(overrides);
  const midline = catalog.find((preset) => preset.id === "midline");
  const custom = catalog.find((preset) => preset.id === "custom-maze");

  assert.ok(midline, "overrides should preserve existing preset identifiers");
  assert.is(midline.label, "Bridge Run");
  assert.is(midline.description, "Custom midline variant.");

  assert.ok(custom, "new presets should be appended to the catalog");
  assert.is(custom.label, "Custom Maze");
  assert.not.ok(
    "description" in custom,
    "non-string descriptions should be omitted during normalization",
  );

  const defaultIds = new Set([
    "none",
    "midline",
    "corridor",
    "checkerboard",
    "perimeter",
    "sealed-quadrants",
    "sealed-chambers",
    "corner-islands",
  ]);

  defaultIds.forEach((id) => {
    assert.ok(
      catalog.some((preset) => preset.id === id),
      `default preset ${id} should remain available after overrides`,
    );
  });
});

test("resolveObstaclePresetCatalog respects includeDefaults flag and trims identifiers", async () => {
  const { resolveObstaclePresetCatalog } = await obstaclePresetsModulePromise;

  const catalog = resolveObstaclePresetCatalog({
    includeDefaults: false,
    presets: [
      "checkerboard",
      { id: " custom-zone ", label: "   ", description: "island pockets" },
      null,
      "",
    ],
  });

  assert.equal(
    catalog.map((preset) => preset.id),
    ["checkerboard", "custom-zone"],
    "catalog should only include sanitized preset identifiers",
  );

  const custom = catalog.find((preset) => preset.id === "custom-zone");

  assert.is(
    custom.label,
    "custom-zone",
    "blank labels should fall back to the identifier",
  );
  assert.is(custom.description, "island pockets");
});

test("resolveObstaclePresetCatalog falls back to defaults when catalog would be empty", async () => {
  const { resolveObstaclePresetCatalog, OBSTACLE_PRESETS } =
    await obstaclePresetsModulePromise;

  const catalog = resolveObstaclePresetCatalog({
    includeDefaults: false,
    presets: [null],
  });

  assert.is(
    catalog,
    OBSTACLE_PRESETS,
    "empty custom catalogs should reuse the default preset list",
  );
});
