export const OBSTACLE_PRESETS = [
  {
    id: 'none',
    label: 'Open Field',
    description: 'Clears all obstacles for free movement.',
  },
  {
    id: 'midline',
    label: 'Midline Wall',
    description: 'Single vertical barrier with regular gates.',
  },
  {
    id: 'corridor',
    label: 'Triple Corridor',
    description: 'Two vertical walls that divide the map into three lanes.',
  },
  {
    id: 'checkerboard',
    label: 'Checkerboard Gaps',
    description: 'Alternating impassable tiles to force weaving paths.',
  },
  {
    id: 'perimeter',
    label: 'Perimeter Ring',
    description: 'Walls around the rim that keep populations in-bounds.',
  },
];

export const OBSTACLE_SCENARIOS = [
  {
    id: 'manual',
    label: 'Manual Control',
    description: 'No scheduled obstacle changes.',
    schedule: [],
  },
  {
    id: 'mid-run-wall',
    label: 'Mid-run Wall Drop',
    description: 'Start open, then add a midline wall with gates after 600 ticks.',
    schedule: [
      { delay: 0, preset: 'none', clearExisting: true },
      { delay: 600, preset: 'midline', clearExisting: true, presetOptions: { gapEvery: 12 } },
    ],
  },
  {
    id: 'pressure-maze',
    label: 'Closing Maze',
    description: 'Perimeter walls first, then corridors, ending with checkerboard choke points.',
    schedule: [
      { delay: 0, preset: 'perimeter', clearExisting: true },
      { delay: 400, preset: 'corridor', append: true },
      { delay: 900, preset: 'checkerboard', clearExisting: true, presetOptions: { tileSize: 3 } },
    ],
  },
];

export default class ObstacleSystem {
  constructor(rows, cols, { onTileBlocked, onTileCleared } = {}) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Array.from({ length: rows }, () => Array(cols).fill(false));
    this.onTileBlocked = null;
    this.onTileCleared = null;
    this.obstacleSchedules = [];
    this.currentPreset = 'none';
    this.currentScenarioId = 'manual';

    this.setCallbacks({ onTileBlocked, onTileCleared });
  }

  getGrid() {
    return this.grid;
  }

  setCallbacks({ onTileBlocked, onTileCleared } = {}) {
    this.onTileBlocked = typeof onTileBlocked === 'function' ? onTileBlocked : null;
    this.onTileCleared = typeof onTileCleared === 'function' ? onTileCleared : null;
  }

  isObstacle(row, col) {
    return Boolean(this.grid?.[row]?.[col]);
  }

  isTileBlocked(row, col) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return true;

    return this.isObstacle(row, col);
  }

  setObstacle(row, col, blocked = true, { evict = true } = {}) {
    if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) return false;
    const wasBlocked = this.grid[row][col];

    if (blocked) {
      this.grid[row][col] = true;
      if (!wasBlocked && this.onTileBlocked) {
        this.onTileBlocked({ row, col, evict });
      }
    } else {
      this.grid[row][col] = false;
      if (wasBlocked && this.onTileCleared) {
        this.onTileCleared({ row, col });
      }
    }

    return true;
  }

  clearObstacles() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.grid[r][c]) continue;
        this.grid[r][c] = false;
        if (this.onTileCleared) this.onTileCleared({ row: r, col: c });
      }
    }

    this.currentPreset = 'none';
  }

  paintWallLine(
    axis,
    index,
    {
      spanStart = 0,
      spanEnd = axis === 'vertical' ? this.rows - 1 : this.cols - 1,
      gapEvery = 0,
      gapOffset = 0,
      thickness = 1,
      evict = true,
    } = {}
  ) {
    const isVertical = axis === 'vertical';
    const primaryLimit = isVertical ? this.rows : this.cols;
    const secondaryLimit = isVertical ? this.cols : this.rows;
    const normalizedStart = Math.max(0, Math.floor(spanStart));
    const normalizedEnd = Math.min(primaryLimit - 1, Math.floor(spanEnd));
    const thicknessValue = Math.max(1, Math.floor(thickness));

    for (let offset = 0; offset < thicknessValue; offset++) {
      const secondaryIndex = index + offset;

      if (secondaryIndex < 0 || secondaryIndex >= secondaryLimit) continue;
      for (let primary = normalizedStart; primary <= normalizedEnd; primary++) {
        if (gapEvery > 0) {
          const idx = primary - normalizedStart + gapOffset;

          if (idx % gapEvery === 0) continue;
        }

        if (isVertical) {
          this.setObstacle(primary, secondaryIndex, true, { evict });
        } else {
          this.setObstacle(secondaryIndex, primary, true, { evict });
        }
      }
    }
  }

  paintVerticalWall(col, options = {}) {
    this.paintWallLine('vertical', col, options);
  }

  paintHorizontalWall(row, options = {}) {
    this.paintWallLine('horizontal', row, options);
  }

  paintCheckerboard({
    tileSize = 2,
    offsetRow = 0,
    offsetCol = 0,
    blockParity = 0,
    evict = true,
  } = {}) {
    const size = Math.max(1, Math.floor(tileSize));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const tileR = Math.floor((r + offsetRow) / size);
        const tileC = Math.floor((c + offsetCol) / size);
        const parity = (tileR + tileC) % 2;

        if (parity === blockParity) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  paintPerimeter({ thickness = 1, evict = true } = {}) {
    const t = Math.max(1, Math.floor(thickness));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const onEdge = r < t || r >= this.rows - t || c < t || c >= this.cols - t;

        if (onEdge) this.setObstacle(r, c, true, { evict });
      }
    }
  }

  applyPreset(
    presetId,
    { clearExisting = true, append = false, presetOptions = {}, evict = true } = {}
  ) {
    if (clearExisting && !append) this.clearObstacles();
    const options = presetOptions || {};

    switch (presetId) {
      case 'none':
        if (clearExisting) this.clearObstacles();
        break;
      case 'midline': {
        const col = Math.floor(this.cols / 2);
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 10));
        const gapOffset = Math.floor(options.gapOffset ?? gapEvery / 2);
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintVerticalWall(col, { gapEvery, gapOffset, thickness, evict });
        break;
      }
      case 'corridor': {
        const gapEvery = Math.max(0, Math.floor(options.gapEvery ?? 12));
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));
        const first = Math.max(1, Math.floor(this.cols / 3));
        const second = Math.min(this.cols - 2, Math.floor((2 * this.cols) / 3));

        this.paintVerticalWall(first, { gapEvery, thickness, evict });
        this.paintVerticalWall(second, {
          gapEvery,
          thickness,
          evict,
          gapOffset: Math.floor(gapEvery / 2),
        });
        break;
      }
      case 'checkerboard': {
        const tileSize = Math.max(1, Math.floor(options.tileSize ?? 2));
        const offsetRow = Math.floor(options.offsetRow ?? 0);
        const offsetCol = Math.floor(options.offsetCol ?? 0);
        const blockParity = Math.floor(options.blockParity ?? 0) % 2;

        this.paintCheckerboard({ tileSize, offsetRow, offsetCol, blockParity, evict });
        break;
      }
      case 'perimeter': {
        const thickness = Math.max(1, Math.floor(options.thickness ?? 1));

        this.paintPerimeter({ thickness, evict });
        break;
      }
      default:
        break;
    }

    this.currentPreset = presetId;
  }

  clearScheduledObstacles() {
    this.obstacleSchedules = [];
  }

  scheduleObstaclePreset(
    currentTick,
    {
      delay = 0,
      preset = 'none',
      presetOptions = {},
      clearExisting = true,
      append = false,
      evict = true,
    } = {}
  ) {
    const triggerTick = currentTick + Math.max(0, Math.floor(delay));

    this.obstacleSchedules.push({
      triggerTick,
      preset,
      clearExisting,
      append,
      presetOptions,
      evict,
    });
    this.obstacleSchedules.sort((a, b) => a.triggerTick - b.triggerTick);
  }

  processScheduledObstacles(currentTick) {
    if (!Array.isArray(this.obstacleSchedules) || this.obstacleSchedules.length === 0) return;

    while (
      this.obstacleSchedules.length > 0 &&
      this.obstacleSchedules[0].triggerTick <= currentTick
    ) {
      const next = this.obstacleSchedules.shift();

      this.applyPreset(next.preset, {
        clearExisting: next.clearExisting,
        append: next.append,
        presetOptions: next.presetOptions,
        evict: next.evict,
      });
    }
  }

  runScenario(scenarioId, currentTick, { resetSchedule = true } = {}) {
    const scenario = OBSTACLE_SCENARIOS.find((s) => s.id === scenarioId);

    if (!scenario) return false;
    if (resetSchedule) this.clearScheduledObstacles();
    this.currentScenarioId = scenario.id;

    for (let i = 0; i < scenario.schedule.length; i++) {
      const step = scenario.schedule[i];
      const delay = Math.max(0, Math.floor(step.delay ?? 0));
      const opts = {
        clearExisting: step.clearExisting,
        append: step.append,
        presetOptions: step.presetOptions,
        evict: step.evict ?? true,
      };

      if (delay === 0) this.applyPreset(step.preset, opts);
      else
        this.scheduleObstaclePreset(currentTick, {
          delay,
          preset: step.preset,
          presetOptions: step.presetOptions,
          clearExisting: step.clearExisting,
          append: step.append,
          evict: step.evict ?? true,
        });
    }

    if (scenario.schedule.length === 0) this.currentPreset = 'none';

    return true;
  }
}
