# Colourful Life

Colourful Life is a browser-based ecosystem sandbox where emergent behaviour arises from simple rules, neural controllers, and environmental feedback loops. The project pairs a canvas renderer with a modular simulation core so new experiments can run in browsers, tests, or custom Node entry points.

## Contents

- [Quick start](#quick-start)
- [Core systems](#core-systems)
- [Headless and embedded usage](#headless-and-embedded-usage)
- [Developer workflow](#developer-workflow)
- [Key scripts and commands](#key-scripts-and-commands)
- [Repository layout](#repository-layout)
- [Documentation map](#documentation-map)

## Quick start

Colourful Life targets the Node.js **25.x** series (the included `.nvmrc` pins to 25.0.0). After cloning the repository:

1. Run `nvm use` (install with `nvm install` first if necessary) so your shell matches the pinned Node.js version. `node --version` should report a 25.x build before you continue.
2. Install dependencies with `npm ci` (fall back to `npm install` only when you intentionally need a non-clean install), then run `npm run prepare` once so Husky hooks stay active after fresh clones or `.husky/` updates.
3. Start the Parcel dev server with `npm run start` and open `http://localhost:1234`.
4. Keep a second terminal handy for `npm run check` before committing. The aggregate command runs `npm run lint`, `npm run format:check`, and `npm test` sequentially so you do not miss regressions. When you prefer faster feedback loops, run the individual commands (`npm test -- --watch` to rerun on file changes, `npm test path/to/file.test.js` to target a single suite) and finish with `npm run check` once you are satisfied.
5. Run `npm run clean` if the dev server misbehaves; it clears `dist/` and `.parcel-cache/` before you restart Parcel. Append `-- --dry-run` to preview the deletions when you just want to confirm the script resolves the right paths.

Parcel provides hot module reloading while you edit. Reach for `npm run build` when you need an optimized bundle in `dist/`, and skim [Key scripts and commands](#key-scripts-and-commands) for benchmarking or publishing helpers. The [developer guide](docs/developer-guide.md) expands on branching strategy, tooling, and testing expectations once the quick start is familiar.

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., the Parcel dev server or any static server you run against the `dist/` build output).

### Configuration overrides

[`src/config.js`](src/config.js) sanitizes a handful of environment variables before the simulation boots so experiments can adjust energy flow, neural temperament, and reproduction without editing source. Set them before starting the dev server or running headless scripts:

**Energy and density**

- `COLOURFUL_LIFE_MAX_TILE_ENERGY` — Raises or lowers the per-tile energy cap used by the energy system and heatmap legends.
- `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` — Controls how strongly crowding suppresses regeneration (0 disables the penalty, 1 matches the default coefficient).
- `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` — Adjusts the harvesting tax organisms pay when gathering from packed tiles so you can model cooperative or cut-throat ecosystems.

**Lifecycle and territory**

- `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` — Determines what fraction of a corpse's remaining energy returns to the grid as it decomposes.
- `COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE` — Sets how much of that recycled energy splashes into neighbouring tiles immediately instead of lingering in the decay reservoir.
- `COLOURFUL_LIFE_DECAY_MAX_AGE` — Limits how long post-mortem energy lingers before dissipating.
- `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` — Scales territorial advantage in combat. Values outside 0–1 are clamped back to the default.

**Neural activity and evolution**

- `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` — Adjusts the baseline neural activity genomes inherit before DNA modifiers apply.
- `COLOURFUL_LIFE_MUTATION_CHANCE` — Sets the default mutation probability applied when genomes reproduce without their own override.
- `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` — Tunes the normalized cutoff the stats system uses when counting organisms as "active" for a trait.
- `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` — Scales how much surplus energy parents must bank beyond the strictest genome's demand before gestation begins.

Out-of-range values fall back to the defaults resolved in [`src/config.js`](src/config.js) so overlays remain aligned with the active configuration. The [developer guide](docs/developer-guide.md#configuration-overrides) walks through how these knobs interact when running longer experiments, and the [architecture overview](docs/architecture-overview.md#energysystem) explains how the energy system consumes them during each tick.

### Life event marker overlay

Open the **Simulation Controls** panel and head to the **Overlays** section to toggle **Life Event Markers** alongside the other map overlays. The overlay drops color-matched rings for newborn organisms and subtle crosses for fallen ones, fading them over the next few ticks so you can trace population churn without overwhelming the canvas or obscuring other heatmaps. A compact legend now anchors to the canvas corner, tallying visible births, deaths, and the net population swing so you can interpret the markers at a glance. Architecture details live in [`docs/architecture-overview.md`](docs/architecture-overview.md#ui-and-overlays) for readers interested in extending the renderer.

### Aurora veil overlay

Flip on **Aurora Veil** in the Overlays panel when you want a celebratory flourish without sacrificing clarity. The effect washes the canvas with soft, high-contrast-safe ribbons that sway with the simulation clock and add a few gentle starbursts. It is fully optional, keeps alpha values low so heatmaps and life event markers stay readable, and respects the existing animation cadence so performance remains unchanged.

### Obstacle layout presets

Select a **Layout Preset** in the Obstacles panel to immediately swap the grid's obstacle mask. The dropdown now applies changes as soon as you choose a preset, streamlining the workflow when experimenting with layouts. Use **Clear Obstacles** to reset the field if you need a blank slate again.
Hit **Shuffle Layout** to roll a random preset from the catalog without reaching for the dropdown—perfect for sparking new map ideas mid-run.

### Reproductive zone overlays

Focus reproduction by enabling preset regions—from hemispheres to central sanctuaries—and combining patterns to guide evolution. Toggle **Highlight Reproductive Zones** whenever you want to keep those rules active without shading the canvas, making it easier to watch emergent behaviour in crowded worlds.

### Empty tile energy slider

Find **Empty Tile Energy** in the Energy Dynamics panel to instantly rebalance how much resource sits on empty terrain. Drag the slider to rehydrate barren ground up to the shown percentage of the tile cap, or dial it down to create harsher survival conditions. Adjustments apply immediately to vacant tiles and set the baseline used for future world regenerations, so you can experiment with lush gardens or austere wastelands without restarting the app.

### Restore default tuning

Nudged a dozen sliders into a corner and want to get back to the canonical baseline? Hit **Restore Default Tuning** in the Simulation Controls panel. The button snaps similarity thresholds, environmental multipliers, energy flow rates, mutation and combat modifiers, playback speed, and the dashboard refresh cadence back to their default values so you can restart experiments without manually retracing every tweak.

### Keyboard shortcuts

Speed through experiments without reaching for the mouse:

- **P** — Pause or resume the simulation.
- **S** — Step forward a single tick while paused.
- **[** or **-** — Slow down playback speed by the configured increment. Hold **Shift** to apply a larger change.
- **]** or **=** — Increase playback speed with the same step logic.
- **0** — Snap playback speed back to the 1× default.

## Core systems

The simulation runs on cooperating modules housed in `src/`:

- **Simulation engine** (`src/simulationEngine.js`) — Coordinates the render loop, tick cadence, and lifecycle events consumed by UI panels and automation hooks.
- **Grid manager** (`src/grid/gridManager.js`) — Maintains the cellular grid, applies movement, reproduction, energy transfer, and obstacle interactions, and surfaces leaderboard snapshots.
- **Energy system** (`src/energySystem.js`) — Computes tile-level regeneration, diffusion, and drain while blending in environmental events and density penalties.
- **Cell model** (`src/cell.js`) — Maintains per-organism state, applies DNA-driven preferences, and records telemetry consumed by fitness calculations and overlays.
- **Genetics and brains** (`src/genome.js`, `src/brain.js`) — DNA factories encode traits ranging from combat appetite to neural wiring. Brains interpret sensor inputs, adapt gains over time, and emit movement/interaction intents.
- **Interaction system** (`src/interactionSystem.js`) — Resolves cooperation, combat, and mating by blending neural intent with density, kinship, and configurable DNA traits.
- **Events & overlays** (`src/events/eventManager.js`, `src/events/eventEffects.js`, `src/events/eventContext.js`, `src/ui/overlays.js`) — Spawns floods, droughts, coldwaves, and heatwaves that shape resources and color overlays.
- **Stats & leaderboard** (`src/stats.js`, `src/stats/leaderboard.js`) — Aggregate per-tick metrics, maintain rolling history for UI charts, surface active environmental event summaries (intensity, coverage, and remaining duration), and select the top-performing organisms. Organism age readings surfaced here and in the UI are measured in simulation ticks so observers can translate them into seconds using the active tick rate.
  The Evolution Insights panel also exposes a simulation clock that reports both elapsed simulated time and the total tick count so observers no longer need to estimate pacing manually.
- **Fitness scoring** (`src/engine/fitness.mjs`) — Computes composite organism fitness used by the leaderboard, overlays, and telemetry, blending survival, reproduction, and energy trends.
- **UI manager** (`src/ui/uiManager.js`) — Builds the sidebar controls, overlays, and metrics panels. A headless adapter in `src/ui/headlessUiManager.js` mirrors the interface for tests and Node scripts.
- **UI bridge** (`src/ui/simulationUiBridge.js`) — Wires the simulation engine to either the full UI or the headless adapter, keeping metrics streams, pause state, reproduction multipliers, and slider updates in sync across environments.
- **Selection tooling** (`src/grid/selectionManager.js`, `src/grid/reproductionZonePolicy.js`) — Defines preset mating zones, keeps geometry caches in sync with grid dimensions, and exposes helpers consumed by UI controls and reproduction policies.
- **Engine environment adapters** (`src/engine/environment.js`) — Normalize canvas lookups, sizing, and timing providers so the simulation can run inside browsers, tests, and offscreen contexts without bespoke wiring.
- **Utility helpers** (`src/utils/`) — Shared math, RNG, ranking, error-reporting, and cloning helpers consumed by the engine, UI, and tests.

For an architectural deep dive—including subsystem hand-offs, data flow, and extension tips—see [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Headless and embedded usage

`createSimulation` exported from [`src/main.js`](src/main.js) stitches together the engine, UI, overlays, and lifecycle helpers. Pass `{ headless: true }` to obtain a headless controller for automation or tests and inject `{ requestAnimationFrame, cancelAnimationFrame, performanceNow }` to supply deterministic timing in non-browser environments. The helper will (see the [developer guide's headless checklist](docs/developer-guide.md#tooling) for supporting scripts and environment tips):

- Resolve or create a canvas using [`resolveCanvas`](src/engine/environment.js) and [`ensureCanvasDimensions`](src/engine/environment.js).
- Construct the grid, stats, selection manager, and event manager, exposing them on the returned controller (`{ grid, stats, selectionManager, eventManager }`).
- Mount the full UI via [`UIManager`](src/ui/uiManager.js) or build a headless adapter with [`createHeadlessUiManager`](src/ui/headlessUiManager.js).
- Link the engine and UI through [`bindSimulationToUi`](src/ui/simulationUiBridge.js) so pause state, reproduction multipliers, metrics streams, and leaderboard updates stay synchronised across browser and headless contexts.

Headless consumers can call `controller.tick()` to advance the simulation one step, `controller.resetWorld()` to clear the ecosystem (pass `{ reseed: true }` to trigger a fresh initial seeding), and subscribe to `SimulationEngine` events (`tick`, `metrics`, `leaderboard`, `state`) for instrumentation.

## The Simulation Laws

1. Only one organism may occupy a grid cell at any time; movement and spawning routines must prevent conflicts.
2. Organisms may never teleport or be relocated discontinuously; any change in position must be achieved through valid movement across adjacent cells.
3. Reproduction and child-spawning must respect required conditions: sexual parents must occupy adjacent tiles, while asexual reproducers may bud from a single organism; both paths must place offspring on empty neighbouring cells and pay plausible biological costs. Sexual lineages combine compatible genomes, asexual lineages clone and mutate their genome, and in all cases reproduction should draw down the progenitor’s energy reserves with gestation steps or cooldown periods before the next birth—mirroring how real organisms invest time and resources to produce limited, inheritable progeny.
4. Organisms cannot live forever—aging, decay, or other lifecycle rules must ensure every organism eventually dies without manual intervention.
5. Dead organisms cannot linger indefinitely—corpses must be removed through natural decay, scavenging, environmental breakdown, or other in-simulation processes so the grid eventually clears without relying on out-of-band cleanup scripts or manual purges.
6. External influence systems (global buffs, forced traits, god-mode interventions) remain disabled by default; they should only activate when users explicitly enable them via the documented UI or configuration. The only excemptions are mutations and environmental effects that are part of normal simulation dynamics.
   - The default configuration sets the event frequency multiplier to `0`, keeping environmental events dormant until a user opts in through the controls or configuration files.
7. After the initial seeding pass that populates the grid, the simulation must never conjure fresh organisms out of thin air—every new resident must descend from living lineages through the established reproduction paths. Manual spawn toggles or inputs may exist for experimentation, but they must be opt-in, disabled by default, and clearly treated as an external intervention by the user.
8. Behaviour must emerge from the organism’s encoded biology: DNA/genomes declare the sensors available to the body and define the neuron topology, connection weights, and instinctive drives that form its brain. As in real organisms, genes build the sensory organs, wire up neural circuits, and prioritise survival and reproductive urges—self-preservation, resource gathering, and the pursuit of viable mates or budding opportunities should all be routed through the genome-defined network, with their intensity modulated by lineage-specific DNA rather than hard-coded overrides or behaviour that bypasses the encoded pathways.
9. Every action carries an energy cost: locomotion, sensing, neuronal processing, reproduction, regeneration, and even passive upkeep must debit the organism’s stored reserves. Energy replenishment should come from in-simulation sources (grazing tiles, consuming prey, metabolising stored resources, photosynthesis traits, etc.), and sustained deficits must trigger attrition or death. This metabolism-first framing keeps evolution grounded—lineages that overspend burn out, while those that balance survival instincts, reproductive drives, and efficiency thrive.
10. Energy and an organism cannot share the same grid cell. When a resident occupies a tile, any stored tile energy must be absorbed into the organism, redistributed to neighbouring empty tiles, or dissipated so the grid never reports a resident and stored energy simultaneously.

## Developer workflow

- **Formatting** — Run `npm run format` before committing or rely on the included Prettier integration. `npm run format:check` verifies without writing.
- **Linting** — `npm run lint` enforces the ESLint + Prettier ruleset across JavaScript and inline HTML. Use `npm run lint:fix` to auto-resolve minor issues.
- **Testing** — `npm test` runs the energy benchmark in [`scripts/profile-energy.mjs`](scripts/profile-energy.mjs) before executing the Node.js test suites. Pass file paths or directories to narrow the run, or append `-- --watch` for continuous execution while you iterate. Add cases when behaviours change.
- **Profiling** — `node scripts/profile-energy.mjs` benchmarks the energy preparation loop. Adjust rows/cols via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, `PERF_ITERATIONS`, and the stub `cellSize` with `PERF_CELL_SIZE` environment variables. Enable the heavier SimulationEngine benchmark with `PERF_INCLUDE_SIM=1` when you specifically need tick timings.
- **Environment tuning** — Set `COLOURFUL_LIFE_MAX_TILE_ENERGY` to raise or lower the tile energy cap. Use `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` / `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` to explore alternative density pressures, `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` to retune telemetry cutoffs, `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` to calm or emphasise territorial combat bias, `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` and `COLOURFUL_LIFE_DECAY_MAX_AGE` to shape post-mortem energy recycling, `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` to globally energise or relax genomes, `COLOURFUL_LIFE_MUTATION_CHANCE` to adjust baseline evolutionary churn, and `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` to demand more or less surplus energy before births without modifying source defaults (the relaxed `1.12` baseline lifted a dense 60×60 headless probe from ~218 → 225 survivors after 120 ticks while keeping scarcity pressure intact).
- **Headless usage** — `createSimulation` accepts `{ headless: true }` to return a controller without mounting DOM controls. Inject `requestAnimationFrame`, `performanceNow`, or RNG hooks for deterministic automation.
- **Documentation** — Follow the conventions in [`docs/developer-guide.md`](docs/developer-guide.md) when updating code comments, tests, or user-facing docs.

## Repository layout

- `src/` — Simulation engine, UI construction, and supporting utilities.
  - `src/engine/` — Canvas/timing adapters (e.g., `resolveCanvas`, `ensureCanvasDimensions`, `resolveTimingProviders`) and helpers consumed by the engine and headless entry points.
  - `src/events/` — Event configuration, context helpers, and presets.
  - `src/grid/` — Grid orchestration, obstacle presets, and selection tooling exposed to other systems.
  - `src/ui/` — UI manager, control builders, overlays, the UI bridge, and debugging helpers.
- `scripts/` — Node scripts (e.g., performance profiling) that exercise the engine headlessly.
- `test/` — Node.js test suites executed via `npm test` plus shared harness utilities accessed through the `#tests/*` import aliases in `package.json`.
- `docs/` — Architecture notes, developer guides, and background reading.
- `index.html`, `styles.css` — Browser entry point and shared styles.
- `eslint.config.mjs`, `package.json` — Tooling and dependency configuration.
- `CHANGELOG.md` — Human-readable log of noteworthy fixes, features, and documentation updates between releases.

## Key scripts and commands

| Command                                                                | Purpose                                                                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run start`                                                        | Launch the Parcel development server with hot module replacement at `http://localhost:1234`.                                  |
| `npm run build`                                                        | Produce an optimized production bundle in `dist/`.                                                                            |
| `npm run check`                                                        | Run linting, formatting verification, and tests sequentially for a pre-commit confidence sweep.                               |
| `npm run clean [-- --dry-run]`                                         | Remove `dist/` and `.parcel-cache/` via `scripts/clean-parcel.mjs`, or preview the removals first with `--dry-run`.           |
| `npm run lint` / `npm run lint:fix`                                    | Run ESLint across the codebase, optionally applying autofixes.                                                                |
| `npm run format` / `npm run format:check` / `npm run format:workflows` | Apply or verify Prettier formatting for source, documentation, configuration files, and GitHub workflow definitions.          |
| `npm test`                                                             | Run the energy benchmark and then execute the Node.js test suites. Accepts file paths, directories, and `-- --watch`.         |
| `npm run benchmark`                                                    | Profile the energy preparation loop via `scripts/profile-energy.mjs`; combine with `PERF_*` variables to mirror CI scenarios. |
| `npm run deploy:public`                                                | Publish the production bundle to a public Git repository using `scripts/publish-public-build.sh`.                             |
| `npm run prepare`                                                      | Reinstall Husky hooks after cloning or when `.husky/` contents change.                                                        |

## Further reading

- [`docs/architecture-overview.md`](docs/architecture-overview.md) — Component responsibilities, UI/headless interactions, and data flow diagrams.
- [`docs/developer-guide.md`](docs/developer-guide.md) — Conventions for contributors, testing expectations, documentation tips, and tooling.
- [`docs/public-hosting.md`](docs/public-hosting.md) — Step-by-step instructions for publishing compiled builds to a public repository for GitHub Pages hosting.
- [`CHANGELOG.md`](CHANGELOG.md) — Ongoing log of notable behavioural, tooling, and documentation changes.
- Inline JSDoc and comments throughout `src/` describing exported functions, complex routines, and configuration helpers.
- Environment variable reference in [`src/config.js`](src/config.js) for tuning energy caps and regeneration penalties without patching source.

## Documentation map

- [`docs/architecture-overview.md`](docs/architecture-overview.md) details module boundaries, update loops, subsystem hand-offs, and the UI bridge.
- [`docs/developer-guide.md`](docs/developer-guide.md) covers environment setup, workflow practices, and expectations for testing and documentation.
- [`docs/public-hosting.md`](docs/public-hosting.md) explains how to publish the compiled build to a separate public repository or GitHub Pages site.
- [`CHANGELOG.md`](CHANGELOG.md) captures notable changes between releases so contributors can track evolution over time.
