# Obstacle Demo Scripts

This project now ships with built-in obstacle presets and scripted scenarios so
you can reproduce terrain changes similar to the "walls mid-run" demo video.

## Getting started

1. Install dependencies and start the development server:

   ```bash
   npm ci
   npm run start
   ```

2. Open the Parcel URL (typically `http://localhost:1234`) in your browser.
3. Use the **Obstacles & Scenarios** panel in the right-hand sidebar to manage
   layouts and schedules while the simulation is running.

## Static obstacle layouts

Select **Layout Preset** and click **Apply Layout** to immediately stamp a mask.
All presets are also available from the console as
`window.grid.applyObstaclePreset('<id>', options)`.

| ID             | Description                                            |
| -------------- | ------------------------------------------------------ |
| `none`         | Clears the grid for free movement.                     |
| `midline`      | Drops a single vertical wall with evenly spaced gates. |
| `corridor`     | Builds two walls to create three long corridors.       |
| `checkerboard` | Alternates blocked tiles to force zig-zag routes.      |
| `perimeter`    | Encircles the edge to keep organisms in bounds.        |

Example console usage:

```js
// Tighten the midline wall by reducing the gap spacing
window.grid.applyObstaclePreset('midline', { presetOptions: { gapEvery: 8 } });
```

## Scenario scripts

Scenario scripts schedule multiple layout changes so you can watch the
population adapt. Pick a script and press **Run Scenario** (or call
`window.grid.runObstacleScenario('<id>')`).

- `manual` – Clears any pending schedules so you can control layouts manually.
- `mid-run-wall` – Starts with an open field, then drops the midline wall after
  ~600 ticks.
- `pressure-maze` – Adds a perimeter, narrows the map into corridors, then ends
  with a checkerboard choke to mimic a closing maze.

## Wall pressure penalty

Use the **Wall Linger Penalty** slider to drain a small amount of energy each
simulation tick that a cell attempts to walk into a wall. The penalty scales
with repeated contact so organisms hugging barriers feel increasing pressure to
move elsewhere. The current value is also accessible at runtime via
`window.grid.setLingerPenalty(value)`.

## Tips

- Toggle **Show Obstacles** to blend the mask into the energy/density overlays.
- The preset and scenario metadata are exported from `GridManager` as
  `OBSTACLE_PRESETS` and `OBSTACLE_SCENARIOS` if you want to build custom UI or
  automated tests.
