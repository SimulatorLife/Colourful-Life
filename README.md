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
npm run serve    # Lightweight static server
npm run test     # UVU unit tests
```

> ℹ️ Browsers block `file://` module imports. Always launch the simulation through Parcel (`npm run start`) or the static server (`npm run serve`).

## Core systems

The simulation runs on a set of cooperating modules housed in `src/`:

- **Grid manager** (`src/gridManager.js`) — Maintains the cellular grid, applies movement, reproduction, energy transfer, and obstacle interactions, and coordinates snapshots for the leaderboard.
- **Energy system** (`src/energySystem.js`) — Computes tile-level regeneration, diffusion, and drain while blending in environmental events and density penalties.
- **Genetics and brains** (`src/genome.js`, `src/brain.js`) — DNA factories encode traits ranging from combat appetite to neural wiring. Brains interpret sensor inputs, adapt gains over time, and emit movement/interaction intents.
- **Interaction system** (`src/interactionSystem.js`) — Resolves cooperation, combat, and mating by blending neural intent with density, kinship, and configurable DNA traits.
- **Events & overlays** (`src/eventManager.js`, `src/overlays.js`) — Spawns floods, droughts, coldwaves, and heatwaves that shape resources and colour overlays.
- **UI manager** (`src/uiManager.js`) — Builds the sidebar controls, overlays, and metrics panels. A headless adapter in `src/main.js` mirrors the interface for tests and Node scripts.

For an architectural deep dive—including subsystem hand-offs, data flow, and extension tips—see [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Developer workflow

- **Formatting** — Run `npm run format` before committing or rely on the included Prettier integration. `npm run format:check` verifies without writing.
- **Linting** — `npm run lint` enforces the ESLint + Prettier ruleset across JavaScript and inline HTML. Use `npm run lint:fix` to auto-resolve minor issues.
- **Testing** — `npm test` executes UVU suites under an esbuild loader. Tests cover grid utilities, selection logic, and regression harnesses.
- **Profiling** — `node scripts/profile-energy.mjs` benchmarks the energy preparation loop. Adjust rows/cols via `PERF_ROWS` and `PERF_COLS` environment variables.
- **Headless usage** — `createSimulation` accepts `{ headless: true }` to return a controller without mounting DOM controls. Inject `requestAnimationFrame`, `performanceNow`, or RNG hooks for deterministic automation.

## Repository layout

- `src/` — Simulation engine, UI construction, and supporting utilities.
  - `src/ui/` — DOM builders used by `UIManager`.
  - `src/grid/` — Adaptors for interacting with the grid from other systems.
- `scripts/` — Node scripts (e.g., performance profiling) that exercise the engine headlessly.
- `test/` — UVU tests executed via `npm test`.
- `index.html`, `styles.css` — Browser entry point and shared styles.
- `docs/` — Long-form documentation and historical notes.

## Further reading

- [`docs/architecture-overview.md`](docs/architecture-overview.md) — Component responsibilities and data flow diagrams.
- [`docs/archived-benchmarks.md`](docs/archived-benchmarks.md) — Context on retired benchmark scripts.
- Inline JSDoc and comments throughout `src/` describing exported functions, complex routines, and configuration helpers.
