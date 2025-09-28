export default class GridRenderer {
  constructor({ ctx, cellSize }) {
    this.ctx = ctx;
    this.cellSize = cellSize;
  }

  draw({ gridState, showObstacles = true } = {}) {
    if (!gridState) return;
    const ctx = this.ctx;
    const cellSize = this.cellSize;

    if (!ctx || !Number.isFinite(cellSize)) return;

    ctx.clearRect(0, 0, gridState.cols * cellSize, gridState.rows * cellSize);

    if (showObstacles && gridState.obstacles) {
      ctx.fillStyle = 'rgba(40,40,55,0.9)';
      for (let row = 0; row < gridState.rows; row++) {
        for (let col = 0; col < gridState.cols; col++) {
          if (!gridState.obstacles[row][col]) continue;
          ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
      ctx.strokeStyle = 'rgba(200,200,255,0.25)';
      ctx.lineWidth = Math.max(1, cellSize * 0.1);
      for (let row = 0; row < gridState.rows; row++) {
        for (let col = 0; col < gridState.cols; col++) {
          if (!gridState.obstacles[row][col]) continue;
          ctx.strokeRect(col * cellSize + 0.5, row * cellSize + 0.5, cellSize - 1, cellSize - 1);
        }
      }
    }

    for (let row = 0; row < gridState.rows; row++) {
      for (let col = 0; col < gridState.cols; col++) {
        const cell = gridState.grid[row][col];

        if (!cell) continue;
        ctx.fillStyle = cell.color;
        ctx.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
      }
    }
  }
}
