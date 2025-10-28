import SimulationEngine from "./simulationEngine.js";
import UIManager from "./ui/uiManager.js";
import SelectionManager from "./grid/selectionManager.js";
import { drawOverlays } from "./ui/overlays.js";

const canvas = document.getElementById("gameCanvas");

const engine = new SimulationEngine({
  canvas,
  config: {
    cellSize: 5,
  },
  autoStart: false,
  selectionManagerFactory: (rows, cols) => new SelectionManager(rows, cols),
  drawOverlays,
});

const uiManager = new UIManager(
  {
    requestFrame: () => engine.requestFrame(),
    togglePause: () => engine.togglePause(),
    step: () => engine.step(),
    onSettingChange: (key, value) => engine.updateSetting(key, value),
  },
  "#app",
  {
    burst: (options = {}) => {
      const { count = 200, radius = 6 } = options;

      engine.burstRandomCells({ count, radius });
    },
    applyObstaclePreset: (id, options) => engine.applyObstaclePreset(id, options),
    obstaclePresets: engine.obstaclePresets,
    getCurrentObstaclePreset: () => engine.getCurrentObstaclePreset(),
    selectionManager: engine.selectionManager,
    getCellSize: () => engine.cellSize,
    getGridDimensions: () => ({
      rows: engine.rows,
      cols: engine.cols,
      cellSize: engine.cellSize,
    }),
    setWorldGeometry: (geometry) => engine.setWorldGeometry(geometry),
  },
  { canvasElement: canvas },
);

engine.on("metrics", ({ stats, metrics, environment }) => {
  if (typeof uiManager.renderMetrics === "function") {
    uiManager.renderMetrics(stats, metrics, environment);
  }
});

engine.on("leaderboard", ({ entries }) => {
  if (typeof uiManager.renderLeaderboard === "function") {
    uiManager.renderLeaderboard(entries);
  }
});

engine.on("state", ({ changes }) => {
  if (changes?.paused !== undefined) {
    uiManager.setPauseState?.(changes.paused);
  }
});

uiManager.setPauseState(engine.isPaused());

if (typeof window !== "undefined") {
  window.uiManager = uiManager;
}

const startPaused = engine.isPaused();

engine.start();
if (startPaused) engine.pause();
