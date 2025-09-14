function getNeighbors(grid, x, y) {
  const neighbors = [];
  const gridHeight = grid.length;
  const gridWidth = grid[0].length;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
        neighbors.push(grid[ny][nx]);
      }
    }
  }

  return neighbors;
}

module.exports = getNeighbors;
