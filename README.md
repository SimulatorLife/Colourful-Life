# Colourful Life

This repository is a JavaScript playground simulation, inspired by cellular automata.

## Project Vision

To guide ongoing development, the simulation is anchored around four interlocking pillars that describe the desired experience, learning takeaways, interaction model, and structural organization.

### Desired Emotional Experience

- **Curiosity and wonder**: Each run should entice viewers to linger, notice emergent patterns, and feel a sense of discovery as behaviours unfold organically.
- **Empathy for digital life**: Subtle cues—colour shifts, energy trails, population booms and busts—should encourage players to care about the organisms' survival journeys.
- **Agency without overwhelm**: Controls ought to feel empowering yet approachable, reinforcing that small nudges can spark dramatic ecological shifts without demanding expert-level micromanagement.

### Learning Goals

- **Emergent complexity**: Highlight how simple local rules produce unexpected ecosystem-level dynamics, echoing principles from cellular automata and evolutionary biology.
- **Resource-feedback loops**: Demonstrate how energy flow, environmental events, and population density intertwine to create cascading consequences.
- **Adaptive strategies**: Showcase genetic variation, mutation, and behaviour weights so users internalize how diversity supports resilience.

### Interaction Principles

- **Tactile experimentation**: Provide intuitive sliders, toggles, and stamping tools that invite quick iteration and playful tinkering.
- **Transparent feedback**: Mirror every user action with visible responses (e.g., overlays updating in real time, organisms reacting promptly) to reinforce cause and effect.
- **Meaningful influence**: Allow interventions at multiple scales—individual cells, regional terrain, global climate—so users can role-play as caretaker, disruptor, or scientist.

### Structural & Organizational Tenets

- **Modular architecture**: Keep simulation logic, rendering, UI layers, and data models decoupled to support headless runs, scripted scenarios, and future extensions.
- **Scenario-driven content**: Organize presets, obstacle maps, and environmental scripts as reusable modules that can be mixed and scheduled over time.
- **Progressive disclosure**: Structure panels and documentation so beginners see essential controls first, while advanced tools (genetic inspectors, debug overlays) remain close at hand for deeper dives.
- **Simplicity as a feature**: Prefer lean modules with clear responsibilities over sprawling managers. Before adding a new system, seek opportunities to refactor, reuse existing behaviours, or generalize small utilities so the codebase stays approachable.
- **Quality-first iteration**: Reserve time each cycle to tighten tests, remove duplication, and resolve edge-case bugs. Shiny additions wait until the current experience feels polished, stable, and well-documented.

## Key Concepts

- **Grid-based cells**: simulations use a 2D array to track cells/particles and update them each frame.
- **Genes and mutation**: advanced versions assign each cell genetic traits that deterministically recombine, blend, and mutate
  during reproduction.
  - Each genome also encodes a similarity preference band (kin-loving to novelty-seeking) and tolerance width, so populations can drift toward inbreeding or outbreeding strategies as conditions change.
- **Neuron-inspired movement**: gene weights influence direction choices, giving each organism a rudimentary nervous system.
- **Energy and evolution**: organisms gather energy from tiles, spend it to move and reproduce, and perish when depleted.
  - Death leaves residue: when a cell dies (age, starvation, or combat), a fraction of its remaining energy is deposited back into the tile as nutrients. Environmental events modulate how much residue persists.
  - Events shape resources: floods boost tile regeneration; droughts and heatwaves suppress it and add per-tile drain; coldwaves slow cycling and preserve residues. Reproduction probability scales with local tile energy and current event pressure.
  - Sunlight coupling: a day–night cycle injects external energy. Occupied tiles route a portion directly to the occupant (photosynthesis weighted by the green gene), with the rest entering the environment. High local density and occupied tiles reduce soil regeneration (competition/shading).
- **Density-aware behavior**: local population density increases aggression, reduces reproduction probability, nudges movement toward caution, and slightly raises energy costs.
- **Environmental events**: floods, droughts, heatwaves, and coldwaves affect regions and influence cell survival.
- **Rendering loop**: `requestAnimationFrame` drives updates and drawing to an HTML `<canvas>`.
- **Obstacles & terrain**: apply obstacle presets and timed scenarios to recreate wall drops or chokepoints while the movement AI respects blocked tiles and optional wall-pressure energy penalties.

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

## Project Structure

- `src/` — Core simulation logic, including the grid engine, configuration defaults, and headless utilities such as `createSimulation`.
- `ui/` — Modular UI components and styles that wire controls, overlays, and inspector panels to the simulation state.
- `demo/` — Scenario guides, presets, and walkthroughs such as [`demo/obstacle-scenarios.md`](demo/obstacle-scenarios.md) for stress-testing behaviours.
- `test/` — UVU-based unit and regression suites covering grid utilities, behaviour modules, and factory wiring.
- `fallingSand/` — Legacy sandbox experiments that inspired the current ecosystem rules and rendering.
- `styles.css`, `index.html` — Entry-point assets for Parcel, defining the base layout and bootstrapping the browser experience.

### Formatting

This repo uses [Prettier](https://prettier.io/) for consistent formatting. Run `npm run format` before committing, or add it to your editor's "format on save" using the Prettier extension.

### Modular & headless usage

The browser entry point now imports a `createSimulation` factory from `src/main.js`. The factory accepts a canvas element and optional configuration, returning handles for the grid, UI manager, and lifecycle controls. This keeps the simulation logic reusable in Node-based tooling, unit tests, or custom launchers.

For headless scripts, pass `headless: true` (to skip DOM UI wiring) and inject timing hooks if the default `requestAnimationFrame` shim is not desired:

```js
import { createSimulation } from './src/main.js';

const canvas = new OffscreenCanvas(300, 300);
const simulation = createSimulation({
  canvas,
  headless: true,
  autoStart: false,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
});

// Advance a single simulation tick.
simulation.step();
```

### Configuration defaults

Energy-related defaults for the simulation are centralized in `src/config.js`. The UI sliders read `ENERGY_REGEN_RATE_DEFAULT` and `ENERGY_DIFFUSION_RATE_DEFAULT` from this shared module so that the controls always reflect the same baseline values used by the grid manager.

### Obstacles & scenarios

- The **Obstacles & Scenarios** panel in the sidebar lets you stamp obstacle layouts, queue scripted terrain changes (e.g., drop a wall mid-run), and adjust the **Wall Linger Penalty** slider that drains energy from organisms repeatedly pushing against barriers.
- Toggle **Show Obstacles** in the overlay section to blend the mask into the main canvas or pair it with the density/energy heatmaps.
- Full walkthroughs—including console snippets for custom presets—live in [`demo/obstacle-scenarios.md`](demo/obstacle-scenarios.md).

## Testing & Quality

- `npm test` — Runs the [UVU](https://github.com/lukeed/uvu) suites in `test/` via the esbuild loader.
- `npm run lint` / `npm run lint:fix` — Lints JavaScript and HTML sources with ESLint (optionally auto-fixing).
- `npm run format:check` — Verifies Prettier formatting without writing changes; pair with `npm run format` before commits.
- Husky + lint-staged — Automatically format and lint staged files on commit to keep diffs clean.

## Onboarding Tips

- **Recommended Node version**: Node.js 18 LTS (or newer) matches the tooling expectations in `package.json` and Parcel 2 support.
- **Headless simulation**: Use `headless: true` with `createSimulation` (see example above) to run deterministic smoke tests or scripted experiments without the DOM.
- **Scenario exploration**: Start with [`demo/obstacle-scenarios.md`](demo/obstacle-scenarios.md) to learn how obstacle presets, wall penalties, and timed events shape emergent behaviour.
- **Dev server shortcuts**: `npm run start` launches Parcel with hot module reloading; `npm run serve` spins up the lightweight Node server for static demos.
