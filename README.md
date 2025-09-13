# Colourful Life

This repository is a playground of JavaScript cellular automata.  The various experiments have been merged into a single consolidated simulation:

- `index.html` – colorful cells form organisms that evolve through genes, simple neuron-like movement, energy-based survival, and breeding while facing environmental events.

The `fallingSand/` directory contains a falling-sand and Game of Life hybrid implemented with both p5.js and canvas-only versions.

## Key Concepts

- **Grid-based cells**: simulations use a 2D array to track cells/particles and update them each frame.
- **Genes and mutation**: advanced versions assign each cell genetic traits that blend and mutate during reproduction.
- **Neuron-inspired movement**: gene weights influence direction choices, giving each organism a rudimentary nervous system.
- **Energy and evolution**: organisms gather energy from tiles, spend it to move and reproduce, and perish when depleted.
- **Environmental events**: floods, droughts, heatwaves, and coldwaves affect regions and influence cell survival.
- **Rendering loop**: `requestAnimationFrame` drives updates and drawing to an HTML `<canvas>`.

## Development

The project uses [Parcel](https://parceljs.org/) for local development:

```bash
npm ci
npm run start    # Parcel dev server
npm run build    # Production build
npm run serve    # Simple static server (no bundling)
```

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., Parcel dev server or `npm run serve`).

## Ideas for Exploration

- Add new gene traits or environmental events.
- Experiment with performance optimizations like typed arrays or offscreen canvases.
- Extract logic into modules and consider adding tests or UI controls.
