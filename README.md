# Colourful Life

This repository is a JavaScript playground simulation, inspired by cellular automata.

## Key Concepts

- **Grid-based cells**: simulations use a 2D array to track cells/particles and update them each frame.
- **Genes and mutation**: advanced versions assign each cell genetic traits that deterministically recombine, blend, and mutate during reproduction.
  - Each genome also encodes a similarity preference band (kin-loving to novelty-seeking) and tolerance width, so populations can drift toward inbreeding or outbreeding strategies as conditions change.
- **Neuron-inspired movement**: gene weights influence direction choices, giving each organism a rudimentary nervous system.
- **Energy and evolution**: organisms gather energy from tiles, spend it to move and reproduce, and perish when depleted.
  - Death leaves residue: when a cell dies (age, starvation, or combat), a fraction of its remaining energy is deposited back into the tile as nutrients. Environmental events modulate how much residue persists.
  - Events shape resources: floods boost tile regeneration; droughts and heatwaves suppress it and add per-tile drain; coldwaves slow cycling and preserve residues. Reproduction probability scales with local tile energy and current event pressure.
  - Sunlight coupling: a day–night cycle injects external energy. Occupied tiles route a portion directly to the occupant (photosynthesis weighted by the green gene), with the rest entering the environment. High local density and occupied tiles reduce soil regeneration (competition/shading).
- **Density-aware behavior**: local population density increases aggression, reduces reproduction probability, nudges movement toward caution, and slightly raises energy costs.
- **Environmental events**: floods, droughts, heatwaves, and coldwaves affect regions and influence cell survival.
- **Rendering loop**: `requestAnimationFrame` drives updates and drawing to an HTML `<canvas>`.

## Development

The project uses [Parcel](https://parceljs.org/) for local development:

```bash
npm ci
npm run start    # Parcel dev server
npm run build    # Production build
npm run serve    # Simple static server (no bundling)
npm run format   # Format code with Prettier
npm run format:check  # Check formatting without writing
```

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., Parcel dev server or `npm run serve`).

### Formatting

This repo uses [Prettier](https://prettier.io/) for consistent formatting. Run `npm run format` before committing, or add it to your editor's "format on save" using the Prettier extension.

### Configuration defaults

Energy-related defaults for the simulation are centralized in `src/config.js`. The UI sliders read
`ENERGY_REGEN_RATE_DEFAULT` and `ENERGY_DIFFUSION_RATE_DEFAULT` from this shared module so that the
controls always reflect the same baseline values used by the grid manager.
