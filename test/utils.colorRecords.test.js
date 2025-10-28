import { assert, test } from "#tests/harness";

async function loadColorRecordsModule(label) {
  const moduleUrl = new URL("../src/utils/colorRecords.js", import.meta.url);

  moduleUrl.searchParams.set(
    "case",
    `${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  );

  return import(moduleUrl.href);
}

test("resolveColorRecord returns the empty sentinel for invalid input", async () => {
  const { resolveColorRecord, EMPTY_COLOR_RECORD } =
    await loadColorRecordsModule("invalid");

  assert.is(resolveColorRecord(undefined), EMPTY_COLOR_RECORD);
  assert.is(resolveColorRecord(null), EMPTY_COLOR_RECORD);
  assert.is(resolveColorRecord(42), EMPTY_COLOR_RECORD);
  assert.is(resolveColorRecord(""), EMPTY_COLOR_RECORD);
  assert.is(resolveColorRecord("   \n"), EMPTY_COLOR_RECORD);
  assert.is(resolveColorRecord("#xyz"), EMPTY_COLOR_RECORD);
});

test("resolveColorRecord caches normalized color strings", async () => {
  const { resolveColorRecord, EMPTY_COLOR_RECORD } =
    await loadColorRecordsModule("cache");

  const first = resolveColorRecord("  #112233  ");

  assert.is.not(first, EMPTY_COLOR_RECORD);

  const second = resolveColorRecord("#112233");

  assert.is(second, first, "trimmed lookups should reuse cached color records");

  const rgbFirst = resolveColorRecord("rgba(10, 20, 30, 0.5)");
  const rgbSecond = resolveColorRecord("rgba(10, 20, 30, 0.5)");

  assert.is(
    rgbSecond,
    rgbFirst,
    "identical color strings should always reuse the cache",
  );
});

test("resolveColorRecord parses short and long hex values with alpha", async () => {
  const { resolveColorRecord } = await loadColorRecordsModule("hex");

  const short = resolveColorRecord("#1a2f");

  assert.equal(short.rgba, [0x11, 0xaa, 0x22, 0xff]);

  const long = resolveColorRecord("#11223344");

  assert.equal(long.rgba, [0x11, 0x22, 0x33, 0x44]);
});

test("resolveColorRecord clamps rgba component and alpha ranges", async () => {
  const { resolveColorRecord } = await loadColorRecordsModule("clamp");

  const record = resolveColorRecord("rgba(300, 20, 50, 200%)");

  assert.equal(record.rgba, [255, 20, 50, 255]);
});

test("resolveColorRecord handles percentage rgb components", async () => {
  const { resolveColorRecord } = await loadColorRecordsModule("percent");

  const rgbPercent = resolveColorRecord("rgb(100%, 0%, 25%)");

  assert.equal(rgbPercent.rgba, [255, 0, 64, 255]);

  const rgbaPercent = resolveColorRecord("rgba(12.5%, 50%, 0%, 50%)");

  assert.equal(rgbaPercent.rgba, [32, 128, 0, 128]);
});

test("resolveCellColorRecord memoizes per cell and reacts to color changes", async () => {
  const { resolveCellColorRecord, resolveColorRecord, EMPTY_COLOR_RECORD } =
    await loadColorRecordsModule("cell-cache");

  const cell = { color: "rgba(10, 20, 30, 0.5)" };

  const first = resolveCellColorRecord(cell);

  assert.is(first, resolveColorRecord("rgba(10, 20, 30, 0.5)"));

  const again = resolveCellColorRecord(cell);

  assert.is(again, first, "repeated lookups reuse memoized records");

  cell.color = "  #ff00ff  ";

  const updated = resolveCellColorRecord(cell);

  assert.equal(updated.rgba, [255, 0, 255, 255]);
  assert.is.not(updated, first, "changing color should produce a new record");

  const stabilized = resolveCellColorRecord(cell);

  assert.is(stabilized, updated, "memoized value should update after a change");

  cell.color = null;

  const cleared = resolveCellColorRecord(cell);

  assert.is(
    cleared,
    EMPTY_COLOR_RECORD,
    "non-string colors should fall back to empty record",
  );
  assert.is(resolveCellColorRecord(cell), cleared, "empty sentinel remains memoized");

  assert.is(resolveCellColorRecord({ color: "   " }), EMPTY_COLOR_RECORD);
  assert.is(resolveCellColorRecord(null), EMPTY_COLOR_RECORD);
});
