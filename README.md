# Colourful Life

Colourful Life is a browser-based ecosystem sandbox where emergent behaviour arises from simple rules, neural controllers, and environmental feedback loops. The project pairs a canvas renderer with a modular simulation core so new experiments can run in browsers, tests, or custom Node entry points.

## Contents

- [Quick start](#quick-start)
- [Core systems](#core-systems)
- [Developer workflow](#developer-workflow)
- [Repository layout](#repository-layout)
- [Further reading](#further-reading)

## Quick start

```bash
npm ci
npm run start    # Parcel dev server with hot reloading

# Optional helpers
npm run build    # Production bundle written to dist/
npm run format   # Format code with Prettier
npm run test     # UVU unit tests
```

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., the Parcel dev server or any static server you run against the `dist/` build output).

## Core systems

The simulation runs on cooperating modules housed in `src/`:

- **Simulation engine** (`src/simulationEngine.js`) — Coordinates the render loop, tick cadence, and lifecycle events consumed by UI panels and automation hooks.
- **Grid manager** (`src/grid/gridManager.js`) — Maintains the cellular grid, applies movement, reproduction, energy transfer, and obstacle interactions, and surfaces leaderboard snapshots.
- **Energy system** (`src/energySystem.js`) — Computes tile-level regeneration, diffusion, and drain while blending in environmental events and density penalties.
- **Genetics and brains** (`src/genome.js`, `src/brain.js`) — DNA factories encode traits ranging from combat appetite to neural wiring. Brains interpret sensor inputs, adapt gains over time, and emit movement/interaction intents.
- **Interaction system** (`src/interactionSystem.js`) — Resolves cooperation, combat, and mating by blending neural intent with density, kinship, and configurable DNA traits.
- **Events & overlays** (`src/events/eventManager.js`, `src/events/eventEffects.js`, `src/events/eventContext.js`, `src/ui/overlays.js`) — Spawns floods, droughts, coldwaves, and heatwaves that shape resources and colour overlays.
- **Stats & leaderboard** (`src/stats.js`, `src/leaderboard.js`) — Aggregate per-tick metrics, maintain rolling history for UI charts, and select the top-performing organisms.
- **UI manager** (`src/ui/uiManager.js`) — Builds the sidebar controls, overlays, and metrics panels. A headless adapter in `src/main.js` mirrors the interface for tests and Node scripts.

For an architectural deep dive—including subsystem hand-offs, data flow, and extension tips—see [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Developer workflow

- **Formatting** — Run `npm run format` before committing or rely on the included Prettier integration. `npm run format:check` verifies without writing.
- **Linting** — `npm run lint` enforces the ESLint + Prettier ruleset across JavaScript and inline HTML. Use `npm run lint:fix` to auto-resolve minor issues.
- **Testing** — `npm test` executes UVU suites under an esbuild loader. Tests cover grid utilities, selection logic, and regression harnesses. Add cases when behaviours change.
- **Profiling** — `node scripts/profile-energy.mjs` benchmarks the energy preparation loop. Adjust rows/cols via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, and `PERF_ITERATIONS` environment variables.
- **Environment tuning** — Set `COLOURFUL_LIFE_MAX_TILE_ENERGY` to raise or lower the tile energy cap for headless runs and automated experiments without modifying source defaults.
- **Headless usage** — `createSimulation` accepts `{ headless: true }` to return a controller without mounting DOM controls. Inject `requestAnimationFrame`, `performanceNow`, or RNG hooks for deterministic automation.
- **Documentation** — Follow the conventions in [`docs/developer-guide.md`](docs/developer-guide.md) when updating code comments, tests, or user-facing docs.

## Repository layout

- `src/` — Simulation engine, UI construction, and supporting utilities.
  - `src/events/` — Event configuration, context helpers, and presets.
  - `src/grid/` — Adaptors for interacting with the grid from other systems.
  - `src/ui/` — UI manager, control builders, overlays, and debugging helpers.
- `scripts/` — Node scripts (e.g., performance profiling) that exercise the engine headlessly.
- `test/` — UVU tests executed via `npm test`.
- `docs/` — Architecture notes, developer guides, and background reading.
- `index.html`, `styles.css` — Browser entry point and shared styles.
- `eslint.config.mjs`, `package.json` — Tooling and dependency configuration.

## Further reading

- [`docs/architecture-overview.md`](docs/architecture-overview.md) — Component responsibilities and data flow diagrams.
- [`docs/developer-guide.md`](docs/developer-guide.md) — Conventions for contributors, testing expectations, and documentation tips.
- Inline JSDoc and comments throughout `src/` describing exported functions, complex routines, and configuration helpers.
