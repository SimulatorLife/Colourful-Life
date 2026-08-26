import { assert, test } from "#tests/harness";
import {
  drawEnergyHeatmap,
  drawDensityHeatmap,
  drawAgeHeatmap,
  resetOverlayCaches,
} from "../src/ui/overlays.js";

function createMockSurface(width, height) {
  let fillRectCalls = 0;
  let clearRectCalls = 0;

  const ctx = {
    imageSmoothingEnabled: false,
    fillStyle: "",
    clearRect() {
      clearRectCalls += 1;
    },
    fillRect() {
      fillRectCalls += 1;
    },
  };

  Object.defineProperty(ctx, "clearRectCalls", { get: () => clearRectCalls });
  Object.defineProperty(ctx, "fillRectCalls", { get: () => fillRectCalls });

  return {
    width,
    height,
    ctx,
    getContext(type) {
      if (type === "2d") return ctx;

      return null;
    },
  };
}

function createMockSurfaceFactory() {
  const created = [];

  return {
    factory(width, height) {
      const surface = createMockSurface(width, height);

      created.push(surface);

      return { surface, ctx: surface.ctx };
    },
    surfaces: created,
    totalFillRects() {
      return created.reduce((sum, s) => sum + s.ctx.fillRectCalls, 0);
    },
    totalClearRects() {
      return created.reduce((sum, s) => sum + s.ctx.clearRectCalls, 0);
    },
  };
}

function createRecordingTargetContext() {
  let drawImageCalls = 0;
  let fillRectCalls = 0;
  const ctx = {
    fillStyle: "",
    fillRect() {
      fillRectCalls += 1;
    },
    drawImage() {
      drawImageCalls += 1;
    },
    save() {},
    restore() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
    fillText() {},
    beginPath() {},
    stroke() {},
    strokeRect() {},
    lineWidth: 1,
    font: "",
    textBaseline: "top",
    textAlign: "left",
  };

  Object.defineProperty(ctx, "drawImageCalls", { get: () => drawImageCalls });
  Object.defineProperty(ctx, "fillRectCalls", { get: () => fillRectCalls });

  return ctx;
}

function createCacheSlot(factory) {
  const slot = {
    surface: null,
    ctx: null,
    width: 0,
    height: 0,
    fingerprint: null,
    surfaceFactory: factory,
  };

  return slot;
}

// Count how many times the cache canvas paints a tile (vs. legend)
function cacheFillRectCount(factory) {
  return factory.totalFillRects();
}

test.before(() => {
  resetOverlayCaches();
});

test.after(() => {
  resetOverlayCaches();
});

test("drawEnergyHeatmap cache hit avoids per-tile fillRect on the target ctx", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const ROWS = 6;
  const COLS = 8;
  const grid = {
    rows: ROWS,
    cols: COLS,
    energyGrid: Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => ((r * COLS + c) % 4) * 1.25 + 0.5),
    ),
  };
  const targetCtx = createRecordingTargetContext();
  const FRAMES = 4;

  drawEnergyHeatmap(grid, targetCtx, 6, 5, null, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  for (let i = 1; i < FRAMES; i += 1) {
    drawEnergyHeatmap(grid, targetCtx, 6, 5, null, { cache: true, cacheSlot: slot });
  }

  assert.is(
    targetCtx.drawImageCalls,
    FRAMES,
    "each frame blits the cached surface once",
  );
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "the cache canvas should not re-render when the fingerprint matches",
  );
  assert.is(
    factory.surfaces.length,
    1,
    "the cache should reuse a single surface across frames",
  );
  assert.ok(
    fillRectsAfterFirst >= ROWS * COLS,
    "the cache canvas paints every tile on the cold frame",
  );
});

test("drawEnergyHeatmap cache invalidates when cellSize changes", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [0, 1],
      [2, 3],
    ],
  };
  const targetCtx = createRecordingTargetContext();

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, { cache: true, cacheSlot: slot });
  const fillRectsAtCellSize4 = cacheFillRectCount(factory);

  drawEnergyHeatmap(grid, targetCtx, 8, 5, null, { cache: true, cacheSlot: slot });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAtCellSize4,
    "a larger cellSize should re-render into a fresh cache surface",
  );
  assert.ok(
    factory.surfaces.length >= 2,
    "the cache slot should allocate a new surface to match the new dimensions",
  );
});

test("drawEnergyHeatmap cache invalidates when the grid data changes", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const gridA = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 1],
      [1, 1],
    ],
  };
  const gridB = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 2],
      [2, 3],
    ],
  };

  drawEnergyHeatmap(gridA, targetCtx, 4, 5, null, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawEnergyHeatmap(gridB, targetCtx, 4, 5, null, { cache: true, cacheSlot: slot });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "changed grid values should force a fresh render into the cache",
  );
});

test("drawEnergyHeatmap cache invalidates when maxTileEnergy changes", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [2.5, 2.5],
      [2.5, 2.5],
    ],
  };

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawEnergyHeatmap(grid, targetCtx, 4, 10, null, { cache: true, cacheSlot: slot });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "maxTileEnergy change should trigger a re-render",
  );
});

test("drawEnergyHeatmap cache invalidates on explicit dataRevision change", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 1],
      [1, 1],
    ],
  };

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 1,
  });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 2,
  });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "dataRevision change should trigger a re-render",
  );
});

test("drawEnergyHeatmap cache stays warm when an identical dataRevision repeats", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 1],
      [1, 1],
    ],
  };
  const FRAMES = 5;

  for (let i = 0; i < FRAMES; i += 1) {
    drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
      cache: true,
      cacheSlot: slot,
      dataRevision: 7,
    });
  }

  assert.is(targetCtx.drawImageCalls, FRAMES, "every frame blits via drawImage");
  assert.is(
    cacheFillRectCount(factory),
    factory.surfaces[0].ctx.fillRectCalls,
    "the cache canvas should paint exactly once across all frames",
  );
});

test("drawEnergyHeatmap falls back to direct rendering when no cache surface is available", () => {
  const targetCtx = createRecordingTargetContext();

  resetOverlayCaches();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 2],
      [3, 4],
    ],
  };

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, { cache: true });

  assert.ok(
    targetCtx.fillRectCalls >= 4,
    "the fallback path should paint each tile directly when no cache surface exists",
  );
});

test("drawDensityHeatmap cache hit avoids per-tile fillRect on the target ctx", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const ROWS = 4;
  const COLS = 5;
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: ROWS,
    cols: COLS,
    densityGrid: Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => Math.sin(r + c / 2) * 3),
    ),
  };

  drawDensityHeatmap(grid, targetCtx, 6, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawDensityHeatmap(grid, targetCtx, 6, { cache: true, cacheSlot: slot });
  drawDensityHeatmap(grid, targetCtx, 6, { cache: true, cacheSlot: slot });

  assert.is(targetCtx.drawImageCalls, 3);
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "warm density cache does not re-render the tile canvas",
  );
  assert.is(factory.surfaces.length, 1, "density cache reuses a single surface");
  assert.ok(
    fillRectsAfterFirst >= ROWS * COLS,
    "cold frame should paint every density tile into the cache",
  );
});

test("drawDensityHeatmap cache invalidates when the density data changes", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const gridA = {
    rows: 2,
    cols: 2,
    densityGrid: [
      [1, 1],
      [1, 1],
    ],
  };
  const gridB = {
    rows: 2,
    cols: 2,
    densityGrid: [
      [1, 2],
      [2, 3],
    ],
  };

  drawDensityHeatmap(gridA, targetCtx, 4, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawDensityHeatmap(gridB, targetCtx, 4, { cache: true, cacheSlot: slot });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "density data change should re-render the cache surface",
  );
});

test("drawAgeHeatmap cache hit avoids per-tile fillRect on the target ctx", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    grid: [
      [
        { age: 10, lifespan: 100 },
        { age: 50, lifespan: 100 },
      ],
      [
        { age: 25, lifespan: 100 },
        { age: 80, lifespan: 100 },
      ],
    ],
  };

  drawAgeHeatmap(grid, targetCtx, 4, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawAgeHeatmap(grid, targetCtx, 4, { cache: true, cacheSlot: slot });
  drawAgeHeatmap(grid, targetCtx, 4, { cache: true, cacheSlot: slot });

  assert.is(targetCtx.drawImageCalls, 3);
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "warm age cache does not re-render the tile canvas",
  );
  assert.is(factory.surfaces.length, 1, "age cache reuses a single surface");
});

test("drawAgeHeatmap cache invalidates when an organism ages", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 1,
    cols: 2,
    grid: [
      [
        { age: 10, lifespan: 100 },
        { age: 50, lifespan: 100 },
      ],
    ],
  };

  drawAgeHeatmap(grid, targetCtx, 4, { cache: true, cacheSlot: slot });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  grid.grid[0][1].age = 80;
  drawAgeHeatmap(grid, targetCtx, 4, { cache: true, cacheSlot: slot });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "age change should re-render the cache surface",
  );
});

test("overlay tile cache reduces per-frame fillRect cost on a dense 64x64 grid", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const ROWS = 64;
  const COLS = 64;
  const grid = {
    rows: ROWS,
    cols: COLS,
    energyGrid: Array.from({ length: ROWS }, (_, r) =>
      Array.from({ length: COLS }, (_, c) => ((r + c) % 7) * 0.4 + 0.5),
    ),
  };
  const FRAMES = 30;

  for (let i = 0; i < FRAMES; i += 1) {
    drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
      cache: true,
      cacheSlot: slot,
      dataRevision: 42,
    });
  }

  assert.is(targetCtx.drawImageCalls, FRAMES, "every frame blits the cached surface");
  assert.is(factory.surfaces.length, 1, "single cache surface reused across frames");
  assert.ok(
    cacheFillRectCount(factory) >= ROWS * COLS,
    "the cache canvas paints all tiles on the cold frame",
  );
  // After the cold frame, no additional fillRects should be issued because
  // every subsequent frame is a cache hit.
  const expectedColdFrameFillRects = factory.surfaces[0].ctx.fillRectCalls;

  assert.is(
    cacheFillRectCount(factory),
    expectedColdFrameFillRects,
    "warm frames must not issue any new fillRects into the cache canvas",
  );
  assert.is(
    factory.totalClearRects(),
    1,
    "subsequent frames should not re-clear and re-paint the cache canvas",
  );
});

test("drawEnergyHeatmap cache hit reuses cached stats without rescan", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 2],
      [3, 4],
    ],
  };

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 7,
  });
  const cachedStatsAfterFirst = slot.cachedMetadata;
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  assert.ok(cachedStatsAfterFirst, "first frame stores stats on the cache slot");
  assert.is(cachedStatsAfterFirst.min, 1);
  assert.is(cachedStatsAfterFirst.max, 4);
  assert.is(cachedStatsAfterFirst.average, 2.5);

  // Mutate the grid so a re-scan would produce different stats. The
  // dataRevision shortcut should make this a hit, leaving the cached stats
  // object reference intact.
  grid.energyGrid[0][0] = 999;

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 7,
  });

  assert.is(
    slot.cachedMetadata,
    cachedStatsAfterFirst,
    "cache hit must reuse the cached stats reference instead of recomputing",
  );
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "cache hit must not re-render the cache canvas",
  );
  assert.is(targetCtx.drawImageCalls, 2, "both frames blit via drawImage");
});

test("drawEnergyHeatmap recomputes stats when dataRevision changes", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 2],
      [3, 4],
    ],
  };

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 1,
  });
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 2,
  });

  assert.ok(
    cacheFillRectCount(factory) > fillRectsAfterFirst,
    "changing dataRevision forces a full re-render into the cache canvas",
  );
  assert.is(targetCtx.drawImageCalls, 2, "both frames still blit via drawImage");
});

test("drawDensityHeatmap cache hit reuses cached samples without rescan", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    densityGrid: [
      [1, 2],
      [3, 4],
    ],
  };

  drawDensityHeatmap(grid, targetCtx, 4, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 3,
  });
  const cachedSamplesAfterFirst = slot.cachedMetadata;
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  assert.ok(cachedSamplesAfterFirst, "first frame stores density samples on slot");
  assert.is(cachedSamplesAfterFirst.originalMin, 1);
  assert.is(cachedSamplesAfterFirst.originalMax, 4);

  // Mutate the grid so a re-scan would produce different min/max. The
  // dataRevision shortcut should make this a hit.
  grid.densityGrid[0][0] = 999;

  drawDensityHeatmap(grid, targetCtx, 4, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 3,
  });

  assert.is(
    slot.cachedMetadata,
    cachedSamplesAfterFirst,
    "cache hit must reuse the cached samples reference instead of recomputing",
  );
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "cache hit must not re-render the density cache canvas",
  );
});

test("drawAgeHeatmap cache hit reuses cached summary without rescan", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const targetCtx = createRecordingTargetContext();
  const grid = {
    rows: 2,
    cols: 2,
    grid: [
      [
        { age: 10, lifespan: 100 },
        { age: 20, lifespan: 100 },
      ],
      [
        { age: 30, lifespan: 100 },
        { age: 40, lifespan: 100 },
      ],
    ],
  };

  drawAgeHeatmap(grid, targetCtx, 4, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 5,
  });
  const cachedAfterFirst = slot.cachedMetadata;
  const fillRectsAfterFirst = cacheFillRectCount(factory);

  assert.ok(cachedAfterFirst, "first frame stores age summary on slot");
  assert.ok(cachedAfterFirst.stats, "summary includes stats");
  assert.ok(cachedAfterFirst.scratch, "summary includes scratch buffer");

  const cachedStatsRef = cachedAfterFirst.stats;
  const cachedScratchRef = cachedAfterFirst.scratch;

  // Mutate the grid - cache hit should preserve cached references.
  grid.grid[0][0].age = 99;

  drawAgeHeatmap(grid, targetCtx, 4, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 5,
  });

  assert.is(
    slot.cachedMetadata,
    cachedAfterFirst,
    "cache hit must reuse the cached summary container",
  );
  assert.is(
    slot.cachedMetadata.stats,
    cachedStatsRef,
    "cached stats object reference is preserved on hit",
  );
  assert.is(
    slot.cachedMetadata.scratch,
    cachedScratchRef,
    "cached scratch buffer reference is preserved on hit",
  );
  assert.is(
    cacheFillRectCount(factory),
    fillRectsAfterFirst,
    "cache hit must not re-render the age cache canvas",
  );
});

test("overlay cache slots expose structural fingerprint and revision metadata after a render", () => {
  const factory = createMockSurfaceFactory();
  const slot = createCacheSlot(factory.factory);
  const grid = {
    rows: 2,
    cols: 2,
    energyGrid: [
      [1, 2],
      [3, 4],
    ],
  };
  const targetCtx = createRecordingTargetContext();

  drawEnergyHeatmap(grid, targetCtx, 4, 5, null, {
    cache: true,
    cacheSlot: slot,
    dataRevision: 11,
  });

  assert.ok(slot.structuralFingerprint, "structural fingerprint is stored on miss");
  assert.is(slot.dataRevision, 11, "dataRevision is stored on miss");
  assert.ok(slot.fingerprint, "full fingerprint is stored on miss");
  assert.ok(slot.cachedMetadata, "metadata is stored on miss");
});
