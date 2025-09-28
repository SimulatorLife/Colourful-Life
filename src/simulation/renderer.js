import { drawOverlays as defaultDrawOverlays } from '../overlays.js';
import GridManager from '../gridManager.js';

export default function createRenderer({
  gridRenderer,
  drawOverlays = defaultDrawOverlays,
  selectionManager,
  eventManager,
  ctx,
  cellSize,
} = {}) {
  if (!gridRenderer || typeof gridRenderer.draw !== 'function') {
    throw new Error('Renderer requires a grid renderer with a draw method.');
  }

  if (!ctx) {
    throw new Error('Renderer requires a canvas context.');
  }

  const effectiveSelectionManager = selectionManager ?? gridRenderer.selectionManager ?? null;
  const effectiveEventManager = eventManager ?? gridRenderer.eventManager ?? null;
  const effectiveCellSize = cellSize ?? gridRenderer.cellSize ?? 5;

  return {
    renderFrame({ snapshot, state }) {
      const effectiveState = state ?? {};

      gridRenderer.draw({ showObstacles: effectiveState.showObstacles ?? true });
      drawOverlays(gridRenderer, ctx, effectiveCellSize, {
        showEnergy: effectiveState.showEnergy ?? false,
        showDensity: effectiveState.showDensity ?? false,
        showFitness: effectiveState.showFitness ?? false,
        showObstacles: effectiveState.showObstacles ?? true,
        maxTileEnergy: GridManager.maxTileEnergy,
        snapshot,
        activeEvents: effectiveEventManager?.activeEvents ?? [],
        getEventColor: effectiveEventManager?.getColor?.bind(effectiveEventManager),
        mutationMultiplier: effectiveState.mutationMultiplier ?? 1,
        selectionManager: effectiveSelectionManager,
      });
    },
  };
}
