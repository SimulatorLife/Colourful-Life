import { assert, suite } from "#tests/harness";
import { drawFitnessHeatmap, selectTopFitnessEntries } from "../src/ui/overlays.js";

const test = suite("ui overlays: fitness heatmap");

function createRecordingContext(rows, cols, cellSize) {
  let currentFillStyle = null;
  const operations = [];

  return {
    operations,
    get fillStyle() {
      return currentFillStyle;
    },
    set fillStyle(value) {
      currentFillStyle = value;
      operations.push({ type: "fillStyle", value });
    },
    fillRect(x, y, width, height) {
      operations.push({
        type: "fillRect",
        x,
        y,
        width,
        height,
        fillStyle: currentFillStyle,
      });
    },
    save() {
      operations.push({ type: "save" });
    },
    restore() {
      operations.push({ type: "restore" });
    },
    createLinearGradient(x0, y0, x1, y1) {
      const gradientStops = [];
      const gradient = {
        addColorStop(offset, color) {
          gradientStops.push({ offset, color });
          operations.push({ type: "gradientStop", offset, color });
        },
      };

      operations.push({
        type: "createLinearGradient",
        x0,
        y0,
        x1,
        y1,
        stops: gradientStops,
      });

      return gradient;
    },
    fillText(text, x, y) {
      operations.push({ type: "fillText", text, x, y });
    },
    set font(value) {
      operations.push({ type: "font", value });
    },
    set textBaseline(value) {
      operations.push({ type: "textBaseline", value });
    },
    set textAlign(value) {
      operations.push({ type: "textAlign", value });
    },
    measureText(text) {
      const width = typeof text === "string" ? text.length * 6 : 0;

      return { width };
    },
  };
}

test("selectTopFitnessEntries ranks entries and respects keepCount", () => {
  const entries = [
    { row: 0, col: 0, fitness: 42.2 },
    { row: 1, col: 1, fitness: 35.5 },
    { row: 2, col: 2, fitness: 12.1 },
    { row: 0, col: 1, fitness: 28.4 },
    { row: 1, col: 2, fitness: 33.7 },
    { row: 2, col: 0, fitness: 10.6 },
    null,
    "noise",
  ];

  const top = selectTopFitnessEntries(entries, 3);

  assert.equal(
    top.map((entry) => ({ row: entry.row, col: entry.col, fitness: entry.fitness })),
    [
      { row: 0, col: 0, fitness: 42.2 },
      { row: 1, col: 1, fitness: 35.5 },
      { row: 1, col: 2, fitness: 33.7 },
    ],
  );
});

test("selectTopFitnessEntries handles empty input and zero limits", () => {
  assert.equal(selectTopFitnessEntries([], 5), []);
  assert.equal(selectTopFitnessEntries(null, 3), []);
  assert.equal(selectTopFitnessEntries([{ row: 0, col: 0, fitness: 1 }], 0), []);
});

test("drawFitnessHeatmap highlights top performers and renders a legend", () => {
  const snapshot = {
    rows: 3,
    cols: 3,
    maxFitness: 42.2,
    entries: [
      { row: 0, col: 0, fitness: 42.2 },
      { row: 1, col: 1, fitness: 35.5 },
      { row: 1, col: 2, fitness: 33.7 },
      { row: 0, col: 1, fitness: 28.4 },
      { row: 2, col: 2, fitness: 12.1 },
      { row: 2, col: 0, fitness: 10.6 },
    ],
  };
  const cellSize = 6;
  const ctx = createRecordingContext(snapshot.rows, snapshot.cols, cellSize);

  drawFitnessHeatmap(snapshot, ctx, cellSize, { topPercent: 0.5 });

  const shadingOperation = ctx.operations.find(
    (op) =>
      op.type === "fillRect" &&
      op.width === snapshot.cols * cellSize &&
      op.height === snapshot.rows * cellSize,
  );

  assert.ok(shadingOperation, "canvas is dimmed before highlighting top cells");
  assert.is(shadingOperation.fillStyle, "rgba(0,0,0,0.45)");

  const highlightedCells = ctx.operations.filter(
    (op) =>
      op.type === "fillRect" &&
      op.width === cellSize &&
      op.height === cellSize &&
      typeof op.fillStyle === "string" &&
      op.fillStyle.startsWith("hsl("),
  );

  assert.is(
    highlightedCells.length,
    3,
    "top percent selects three leaderboard entries",
  );
  assert.equal(
    highlightedCells.map((op) => ({
      row: op.y / cellSize,
      col: op.x / cellSize,
      fillStyle: op.fillStyle,
    })),
    [
      { row: 0, col: 0, fillStyle: "hsl(52, 88%, 82.0%)" },
      { row: 1, col: 1, fillStyle: "hsl(52, 88%, 67.0%)" },
      { row: 1, col: 2, fillStyle: "hsl(52, 88%, 52.0%)" },
    ],
  );

  const legendLines = ctx.operations
    .filter((op) => op.type === "fillText")
    .map((op) => op.text);

  assert.ok(
    legendLines.includes("Highlighting 3/6 cells (~50.0%)"),
    "legend quantifies highlight coverage",
  );
  assert.ok(
    legendLines.includes("Palette strongest → weaker"),
    "legend documents palette direction",
  );
  assert.ok(
    legendLines.some((text) => text.startsWith("Peak fitness 42.20")),
    "legend reports max fitness with fixed precision",
  );
});
