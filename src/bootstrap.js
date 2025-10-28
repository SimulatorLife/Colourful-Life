import { createSimulation } from "./main.js";

createSimulation({
  canvas: document.getElementById("gameCanvas"),
  config: {
    cellSize: 5,
  },
});
