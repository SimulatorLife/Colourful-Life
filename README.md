# Colourful Life

This repository is a playground of JavaScript cellular automata.  Several HTML files demonstrate progressively more complex simulations:

- `colourful-life.html` – a multi-color Game of Life variant where offspring mutate their color.
- `colourful_life_v2.html` – introduces a `Genes` class and basic inheritance/mutation.
- `colourful_life_genes.html` – adds explicit classes and movement/behavior logic.
- `index.html` – the most feature-rich simulation with environmental events, hunger, reproduction, and social behavior.
- `life-v2.html` – an unrelated experiment with organisms that roam and replicate.

The `fallingSand/` directory contains a falling-sand and Game of Life hybrid implemented with both p5.js and canvas-only versions.

## Key Concepts

- **Grid-based cells**: simulations use a 2D array to track cells/particles and update them each frame.
- **Genes and mutation**: advanced versions assign each cell genetic traits that blend and mutate during reproduction.
- **Environmental events**: floods, droughts, heatwaves, and coldwaves affect regions and influence cell survival.
- **Rendering loop**: `requestAnimationFrame` drives updates and drawing to an HTML `<canvas>`.

## Development

The project uses [Parcel](https://parceljs.org/) for local development:

```bash
npm run start    # serve index.html with Parcel
npm run build    # build assets for production
```

## Ideas for Exploration

- Add new gene traits or environmental events.
- Experiment with performance optimizations like typed arrays or offscreen canvases.
- Extract logic into modules and consider adding tests or UI controls.

