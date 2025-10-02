# Colourful Life

Colourful Life is a browser-based ecosystem sandbox where emergent behaviour arises from simple rules, neural controllers, and environmental feedback loops. The project pairs a canvas renderer with a modular simulation core so new experiments can run in browsers, tests, or custom Node entry points.

## Contents

- [Quick start](#quick-start)
- [Core systems](#core-systems)
- [Developer workflow](#developer-workflow)
- [Key scripts and commands](#key-scripts-and-commands)
- [Repository layout](#repository-layout)
- [Documentation map](#documentation-map)

## Quick start

```bash
npm ci
npm run start    # Parcel dev server with hot reloading

# Optional helpers
npm run build    # Production bundle written to dist/
npm run clean:parcel  # Remove dist/ and the Parcel cache when builds misbehave
npm run format   # Format code with Prettier
npm run format:check  # Validate formatting without writing
npm run test     # Node.js test suites
npm run lint     # ESLint across JS modules and inline HTML
npm run lint:fix # ESLint with autofix enabled
```

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., the Parcel dev server or any static server you run against the `dist/` build output).

### Configuration overrides

Tune baseline energy and density behaviour without editing source by setting environment variables before starting the dev server or running headless scripts:

- `COLOURFUL_LIFE_MAX_TILE_ENERGY` — Raises or lowers the per-tile energy cap used by the energy system and heatmap legends.
- `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` — Adjusts how strongly local population density suppresses energy regeneration (0 disables the penalty, 1 matches the default cap).
- `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` — Tunes the harvesting penalty applied when crowded organisms attempt to consume energy from a tile, allowing experiments with more competitive or laissez-faire ecosystems.
- `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` — Adjusts the normalized cutoff the stats system uses when counting organisms as "active" for a trait, keeping telemetry aligned with looser or stricter interpretations of participation.

Values outside their accepted ranges fall back to the defaults defined in [`src/config.js`](src/config.js) so experiments remain predictable across environments and overlays stay aligned with the active configuration.

### Optional celebration glow overlay

Flip on the **Celebration Glow** checkbox in the Overlays panel to surround the most successful organisms with a soft aurora. The highlight quietly layers on top of the existing canvas without changing simulation mechanics, respects motion-sensitive setups (no flashing or animation), and avoids obscuring other overlays by using gentle transparency. Toggle it off at any time to return to the standard presentation.

### Life event marker overlay

Enable **Life Event Markers** in the Overlays panel to spotlight where births and deaths just occurred. The overlay drops color-matched rings for newborn organisms and subtle crosses for fallen ones, fading them over the next few ticks so you can trace population churn without overwhelming the canvas or obscuring other heatmaps.

## Core systems

The simulation runs on cooperating modules housed in `src/`:

- **Simulation engine** (`src/simulationEngine.js`) — Coordinates the render loop, tick cadence, and lifecycle events consumed by UI panels and automation hooks.
- **Grid manager** (`src/grid/gridManager.js`) — Maintains the cellular grid, applies movement, reproduction, energy transfer, and obstacle interactions, and surfaces leaderboard snapshots.
- **Energy system** (`src/energySystem.js`) — Computes tile-level regeneration, diffusion, and drain while blending in environmental events and density penalties.
- **Cell model** (`src/cell.js`) — Maintains per-organism state, applies DNA-driven preferences, and records telemetry consumed by fitness calculations and overlays.
- **Genetics and brains** (`src/genome.js`, `src/brain.js`) — DNA factories encode traits ranging from combat appetite to neural wiring. Brains interpret sensor inputs, adapt gains over time, and emit movement/interaction intents.
- **Interaction system** (`src/interactionSystem.js`) — Resolves cooperation, combat, and mating by blending neural intent with density, kinship, and configurable DNA traits.
- **Events & overlays** (`src/events/eventManager.js`, `src/events/eventEffects.js`, `src/events/eventContext.js`, `src/ui/overlays.js`) — Spawns floods, droughts, coldwaves, and heatwaves that shape resources and color overlays.
- **Stats & leaderboard** (`src/stats.js`, `src/leaderboard.js`) — Aggregate per-tick metrics, maintain rolling history for UI charts, surface active environmental event summaries (intensity, coverage, and remaining duration), and select the top-performing organisms. Organism age readings surfaced here and in the UI are measured in simulation ticks so observers can translate them into seconds using the active tick rate.
- **UI manager** (`src/ui/uiManager.js`) — Builds the sidebar controls, overlays, and metrics panels. A headless adapter in `src/ui/headlessUiManager.js` mirrors the interface for tests and Node scripts.
- **Selection tooling** (`src/grid/selectionManager.js`, `src/grid/reproductionZonePolicy.js`) — Defines preset and user-drawn mating zones, keeps geometry caches in sync with grid dimensions, and exposes helpers consumed by UI controls and reproduction policies.

For an architectural deep dive—including subsystem hand-offs, data flow, and extension tips—see [`docs/architecture-overview.md`](docs/architecture-overview.md).

## The 5 Simulation Laws

1. Only one organism may occupy a grid cell at any time; movement and spawning routines must prevent conflicts.
2. Organisms may never teleport or be relocated discontinuously; any change in position must be achieved through valid movement across adjacent cells.
3. Reproduction and child-spawning must respect required conditions: parents must occupy adjacent tiles, ensure offspring spawn on empty neighbouring cells.
4. Organisms cannot live forever—aging, decay, or other lifecycle rules must ensure every organism eventually dies without manual intervention.
5. External influence systems (global buffs, forced traits, god-mode interventions) remain disabled by default; they should only activate when users explicitly enable them via the documented UI or configuration. The only excemptions are mutations and environmental effects that are part of normal simulation dynamics.

## Developer workflow

- **Formatting** — Run `npm run format` before committing or rely on the included Prettier integration. `npm run format:check` verifies without writing.
- **Linting** — `npm run lint` enforces the ESLint + Prettier ruleset across JavaScript and inline HTML. Use `npm run lint:fix` to auto-resolve minor issues.
- **Testing** — `npm test` runs the Node.js test suites. Tests cover grid utilities, selection logic, and regression harnesses. Add cases when behaviours change.
- **Profiling** — `node scripts/profile-energy.mjs` benchmarks the energy preparation loop. Adjust rows/cols via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, `PERF_ITERATIONS`, and the stub `cellSize` with `PERF_CELL_SIZE` environment variables.
- **Environment tuning** — Set `COLOURFUL_LIFE_MAX_TILE_ENERGY` to raise or lower the tile energy cap. Use `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` / `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` to explore alternative density pressures and `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` to retune telemetry cutoffs without modifying source defaults.
- **Headless usage** — `createSimulation` accepts `{ headless: true }` to return a controller without mounting DOM controls. Inject `requestAnimationFrame`, `performanceNow`, or RNG hooks for deterministic automation.
- **Documentation** — Follow the conventions in [`docs/developer-guide.md`](docs/developer-guide.md) when updating code comments, tests, or user-facing docs.

## Repository layout

- `src/` — Simulation engine, UI construction, and supporting utilities.
  - `src/events/` — Event configuration, context helpers, and presets.
  - `src/grid/` — Adaptors for interacting with the grid from other systems.
  - `src/ui/` — UI manager, control builders, overlays, and debugging helpers.
- `scripts/` — Node scripts (e.g., performance profiling) that exercise the engine headlessly.
- `scripts/clean-parcel.js` — Utility invoked by `npm run clean:parcel` to wipe the Parcel cache (`.parcel-cache/`) and `dist/` outputs when builds or hot reloads drift out of sync.
- `test/` — Node.js test suites executed via `npm test`.
- `docs/` — Architecture notes, developer guides, and background reading.
- `index.html`, `styles.css` — Browser entry point and shared styles.
- `eslint.config.mjs`, `package.json` — Tooling and dependency configuration.
- `CHANGELOG.md` — Human-readable log of noteworthy fixes, features, and documentation updates between releases.

## Key scripts and commands

| Command                                   | Purpose                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run start`                           | Launches the Parcel development server with hot module replacement at `http://localhost:1234`. |
| `npm run build`                           | Produces an optimized production bundle in `dist/`.                                            |
| `npm run clean:parcel`                    | Removes `dist/` and `.parcel-cache/` to recover from stubborn Parcel caches.                   |
| `npm run lint` / `npm run lint:fix`       | Runs ESLint across the codebase, optionally applying autofixes.                                |
| `npm run format` / `npm run format:check` | Applies or verifies Prettier formatting for source, documentation, and configuration files.    |
| `npm test`                                | Runs the Node.js test suites covering simulation and UI modules.                               |
| `node scripts/profile-energy.mjs`         | Benchmarks the energy preparation loop with configurable grid sizes via environment variables. |

## Further reading

- [`docs/architecture-overview.md`](docs/architecture-overview.md) — Component responsibilities and data flow diagrams.
- [`docs/developer-guide.md`](docs/developer-guide.md) — Conventions for contributors, testing expectations, and documentation tips.
- Inline JSDoc and comments throughout `src/` describing exported functions, complex routines, and configuration helpers.
- Environment variable reference in [`src/config.js`](src/config.js) for tuning energy caps and regeneration penalties without patching source.

## Documentation map

- [`docs/architecture-overview.md`](docs/architecture-overview.md) details module boundaries, update loops, and subsystem hand-offs.
- [`docs/developer-guide.md`](docs/developer-guide.md) covers environment setup, workflow practices, and expectations for testing and documentation.
- [`CHANGELOG.md`](CHANGELOG.md) captures notable changes between releases so contributors can track evolution over time.
