import { assert, test } from "#tests/harness";
import { summarizeSelectionZoneCoverage } from "../src/ui/overlays.js";

test("summaries capture coverage fractions and union area", () => {
  const entries = [
    {
      zone: { id: "alpha", name: "Alpha Basin", color: "rgba(255, 0, 0, 0.25)" },
      geometry: {
        rects: [{ row: 0, col: 0, rowSpan: 3, colSpan: 3 }],
      },
    },
    {
      zone: { id: "delta" },
      geometry: {
        rects: [{ row: 2, col: 2, rowSpan: 3, colSpan: 3 }],
      },
    },
  ];

  const summary = summarizeSelectionZoneCoverage(entries, { rows: 6, cols: 6 });

  assert.is(summary.totalTiles, 36);
  assert.is(summary.entries.length, 2);
  assert.equal(summary.entries[0], {
    label: "Alpha Basin",
    color: "rgba(255, 0, 0, 0.25)",
    tileCount: 9,
    coverage: 0.25,
  });
  assert.equal(summary.entries[1], {
    label: "delta",
    color: "rgba(120, 190, 255, 0.2)",
    tileCount: 9,
    coverage: 0.25,
  });
  assert.is(summary.totalTileCount, 18);
  assert.is(summary.unionTileCount, 17);
});

test("summaries ignore empty geometry and can disable union tracking", () => {
  const entries = [
    {
      zone: { id: "empty" },
      geometry: { rects: [] },
    },
    {
      zone: { id: "thin" },
      geometry: {
        rects: [
          { row: 0, col: 1, rowSpan: 1, colSpan: 2 },
          { row: 1, col: 1, rowSpan: 0, colSpan: 3 },
        ],
      },
    },
  ];

  const summary = summarizeSelectionZoneCoverage(entries, {
    rows: 4,
    cols: 4,
    computeUnion: false,
  });

  assert.is(summary.unionTileCount, null);
  assert.is(summary.entries.length, 1);
  assert.equal(summary.entries[0], {
    label: "thin",
    color: "rgba(120, 190, 255, 0.2)",
    tileCount: 2,
    coverage: 0.125,
  });
});
