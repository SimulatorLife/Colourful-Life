# Obstacle Presets

This project ships with built-in obstacle presets so you can quickly reproduce
terrain changes similar to the "walls mid-run" demo video.

## Getting started

1. Install dependencies and start the development server:

   ```bash
   npm ci
   npm run start
   ```

2. Open the Parcel URL (typically `http://localhost:1234`) in your browser.
3. Use the **Obstacles** panel in the right-hand sidebar to manage layouts
   while the simulation is running.

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

## Wall pressure penalty

Use the **Wall Linger Penalty** slider to drain a small amount of energy each
simulation tick that a cell attempts to walk into a wall. The penalty scales
with repeated contact so organisms hugging barriers feel increasing pressure to
move elsewhere. The current value is also accessible at runtime via
`window.grid.setLingerPenalty(value)`.

## Tips

- Toggle **Show Obstacles** to blend the mask into the energy/density overlays.
- The preset metadata is exported from `GridManager` as `OBSTACLE_PRESETS` if
  you want to build custom UI or automated tests.
