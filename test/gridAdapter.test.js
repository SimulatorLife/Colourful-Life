import { test } from "uvu";
import * as assert from "uvu/assert";

import GridInteractionAdapter from "../src/grid/gridAdapter.js";

const createGrid = (rows, cols) =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));

const createCell = (row, col, energy = 0) => ({ row, col, energy });

test("getCell and setCell fall back to grid mutation when manager lacks methods", () => {
  const grid = createGrid(2, 2);
  const adapter = new GridInteractionAdapter({ gridManager: { grid } });
  const cell = createCell(0, 0, 3);

  assert.is(adapter.getCell(0, 0), null);
  adapter.setCell(0, 0, cell);

  assert.is(adapter.getCell(0, 0), cell);
  assert.is(cell.row, 0);
  assert.is(cell.col, 0);
});

test("setCell with null delegates to removeCell", () => {
  const grid = createGrid(1, 1);
  const adapter = new GridInteractionAdapter({ gridManager: { grid } });
  const cell = createCell(0, 0, 2);

  adapter.setCell(0, 0, cell);
  const removed = adapter.setCell(0, 0, null);

  assert.is(removed, null);
  assert.is(adapter.getCell(0, 0), null);
});

test("removeCell returns the existing occupant when no manager hook exists", () => {
  const grid = createGrid(1, 2);
  const adapter = new GridInteractionAdapter({ gridManager: { grid } });
  const cell = createCell(0, 1, 4);

  adapter.setCell(0, 1, cell);

  const removed = adapter.removeCell(0, 1);

  assert.is(removed, cell);
  assert.is(adapter.getCell(0, 1), null);
});

test("relocateCell moves occupants only when destination empty", () => {
  const grid = createGrid(2, 2);
  const adapter = new GridInteractionAdapter({ gridManager: { grid } });
  const mover = createCell(0, 0, 5);

  adapter.setCell(0, 0, mover);
  adapter.setCell(1, 1, createCell(1, 1));

  assert.is(adapter.relocateCell(0, 0, 1, 1), false, "destination occupied");
  assert.is(adapter.relocateCell(0, 0, 1, 0), true, "destination open");
  assert.is(adapter.getCell(1, 0), mover);
  assert.is(adapter.getCell(0, 0), null);
});

test("consumeTileEnergy defers to manager consumeEnergy when available", () => {
  const calls = [];
  const manager = {
    consumeEnergy(cell, row, col, densityGrid, densityEffectMultiplier) {
      calls.push({ cell, row, col, densityGrid, densityEffectMultiplier });
    },
  };
  const adapter = new GridInteractionAdapter({ gridManager: manager });
  const cell = createCell(1, 1, 3);

  const result = adapter.consumeTileEnergy({
    cell,
    row: 1,
    col: 1,
    densityGrid: [[0, 1]],
    densityEffectMultiplier: 0.5,
  });

  assert.is(result, 1);
  assert.equal(calls, [
    {
      cell,
      row: 1,
      col: 1,
      densityGrid: [[0, 1]],
      densityEffectMultiplier: 0.5,
    },
  ]);
});

test("transferEnergy respects donor availability and recipient capacity", () => {
  const adapter = new GridInteractionAdapter({
    gridManager: { maxTileEnergy: 10 },
  });
  const donor = createCell(0, 0, 8);
  const recipient = createCell(0, 1, 7);

  const transferred = adapter.transferEnergy({ from: donor, to: recipient, amount: 6 });

  assert.is(transferred, 3, "recipient can only accept remaining capacity");
  assert.is(donor.energy, 5);
  assert.is(recipient.energy, 10);
});

test("transferEnergy handles missing recipient and clamps to donor energy", () => {
  const adapter = new GridInteractionAdapter({
    gridManager: { maxTileEnergy: 6 },
  });
  const donor = createCell(0, 0, 2);

  const transferred = adapter.transferEnergy({ from: donor, amount: 5 });

  assert.is(transferred, 2);
  assert.is(donor.energy, 0);
});

test("maxTileEnergy falls back to global GridManager constant when available", () => {
  globalThis.GridManager = { maxTileEnergy: 42 };
  const adapter = new GridInteractionAdapter({ gridManager: {} });

  assert.is(adapter.maxTileEnergy(), 42);
  delete globalThis.GridManager;
});

test("densityAt prefers provided density grid over manager helper", () => {
  const manager = {
    getDensityAt(row, col) {
      return row === 0 && col === 0 ? 0.9 : 0.1;
    },
  };
  const adapter = new GridInteractionAdapter({ gridManager: manager });

  const densityGrid = [
    [0.5, 0.4],
    [0.2, 0.1],
  ];

  assert.is(adapter.densityAt(0, 0, { densityGrid }), 0.5, "inline density grid wins");
  assert.is(
    adapter.densityAt(1, 1, { densityGrid: null }),
    0.1,
    "manager fallback used",
  );
});

test.run();
