# Colourful Life

Colourful Life is a browser-based ecosystem sandbox where emergent behaviour arises from simple rules, neural controllers, and environmental feedback loops. The project pairs a canvas renderer with a modular simulation core so new experiments can run in browsers, tests, or custom Node entry points. The [architecture overview](docs/architecture-overview.md) walks through the major subsystems when you need a deeper tour.

## Contents

- [Quick start](#quick-start)
- [Core systems](#core-systems)
- [Headless and embedded usage](#headless-and-embedded-usage)
- [Developer workflow](#developer-workflow)
- [Key scripts and commands](#key-scripts-and-commands)
- [Repository layout](#repository-layout)
- [Documentation map](#documentation-map)

## Quick start

Colourful Life targets the Node.js **25.x** series (the included `.nvmrc` pins to 25.0.0). After cloning:

1. Run `nvm use` (install with `nvm install` if necessary) so `node --version` reports 25.x.
2. Install dependencies with `npm ci` (reach for `npm install` only when you intentionally touch the lockfile), then run `npm run prepare` once to restore Husky hooks after fresh clones or `.husky/` edits.
3. Start developing with `npm run start` and open `http://localhost:1234`.
4. While iterating, lean on focused loops and finish with a full check before you commit:
   - `npm run lint` — ESLint with the shared ruleset (or `npm run lint:fix` for safe autofixes).
   - `npm run format:check` — Verify Prettier formatting without writing.
   - `npm test -- --watch` or `npm test -- path/to/file.test.js` — Exercise targeted Node.js test suites with the energy benchmark.
   - `npm run check` — Chain linting, formatting verification, the energy benchmark, and the Node.js test suites before you push.

5. If Parcel hot reloading stalls, run `npm run clean -- --dry-run` to preview the cache cleanup, then rerun without `--dry-run` to remove stale artifacts.

Parcel provides hot module reloading while you edit. Reach for `npm run build` when you need an optimized bundle in `dist/`, then browse [Key scripts and commands](#key-scripts-and-commands) for benchmarking or publishing helpers. The [developer guide](docs/developer-guide.md) expands on branching strategy, tooling, profiling harnesses, and testing expectations once the quick start is familiar, including when to lean on each feedback loop.

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., the Parcel dev server or any static server you run against the `dist/` build output).

### Configuration overrides

[`src/config.js`](src/config.js) sanitizes a handful of environment variables before the simulation boots so experiments can adjust energy flow, neural temperament, and reproduction without editing source. Set them before starting the dev server or running headless scripts:

**Energy and density**

- `COLOURFUL_LIFE_MAX_TILE_ENERGY` — Raises or lowers the per-tile energy cap shown in the energy overlay and consumed during regeneration.
- `COLOURFUL_LIFE_ENERGY_REGEN_RATE` — Overrides the baseline tile regeneration rate before density penalties and events apply.
- `COLOURFUL_LIFE_ENERGY_DIFFUSION_RATE` — Controls how much energy diffuses to neighbouring tiles each tick.
- `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` — Controls how strongly crowding suppresses regeneration (`0` disables the penalty, `1` mirrors the default coefficient).
- `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` — Adjusts the harvesting tax organisms pay on packed tiles so you can model cooperative or cut-throat ecosystems.

**Lifecycle and territory**

- `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` — Determines what fraction of a corpse's remaining energy returns to the grid as it decomposes.
- `COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE` — Sets how much of that recycled energy splashes into neighbouring tiles immediately instead of lingering in the decay reservoir.
- `COLOURFUL_LIFE_DECAY_RELEASE_BASE` — Tunes the baseline amount of energy returned whenever decay releases stored reserves.
- `COLOURFUL_LIFE_DECAY_RELEASE_RATE` — Scales how aggressively decay reservoirs release energy each tick.
- `COLOURFUL_LIFE_DECAY_MAX_AGE` — Limits how long post-mortem energy lingers before dissipating.
- `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` — Scales territorial advantage in combat (values outside 0–1 are clamped to the default).

**Neural activity and evolution**

- `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` — Adjusts the baseline neural activity genomes inherit before DNA modifiers apply.
- `COLOURFUL_LIFE_MUTATION_CHANCE` — Sets the default mutation probability applied when genomes reproduce without their own override.
- `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` — Tunes the normalized cutoff the stats system uses when counting organisms as "active" for a trait.
- `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` — Scales how much surplus energy parents must bank beyond the strictest genome's demand before gestation begins.
- `COLOURFUL_LIFE_REPRODUCTION_COOLDOWN_BASE` — Establishes the minimum number of ticks parents must rest between births unless their genomes demand a longer recovery, letting you globally relax or tighten reproductive pacing.

Out-of-range values fall back to the defaults resolved in [`src/config.js`](src/config.js) so overlays remain aligned with the active configuration. The [developer guide](docs/developer-guide.md#configuration-overrides) walks through how these knobs interact during longer experiments, and the [architecture overview](docs/architecture-overview.md#energysystem) explains how the energy system consumes them during each tick.

### Life event marker overlay

Open the **Simulation Controls** panel and head to the **Overlays** section to toggle **Life Event Markers** alongside the other map overlays. The overlay drops color-matched rings for newborn organisms and subtle crosses for fallen ones, fading them over the next few ticks so you can trace population churn without overwhelming the canvas or obscuring other heatmaps. A compact legend now anchors to the canvas corner, tallying visible births, deaths, and the net population swing so you can interpret the markers at a glance. Architecture details live in [`docs/architecture-overview.md`](docs/architecture-overview.md#ui-and-overlays) for readers interested in extending the renderer. Need longer-lasting telemetry or a quicker clear? Nudge the **Life Event Fade Window** slider to keep markers on-screen for dozens more ticks or trim them down to a blink-and-you-miss-it pulse.

### Age heatmap overlay

Curious which colonies are dominated by elders close to the end of their lifespan? Flip on **Show Age Heatmap** in the Overlays panel to bathe older organisms in a warm glow that intensifies as their age approaches their encoded lifespan. The overlay leaves newborn tiles untouched, pairs with a legend in the opposite corner of the canvas, and layers cleanly with the existing energy and density guides so you can track lineage longevity without sacrificing other telemetry.

### Aurora celebration veil

When you want a celebratory mood without drowning the grid in noise, enable **Aurora Celebration Veil** from the Overlays panel. The canvas gains a low-contrast aurora that shimmers brighter as the world’s average energy climbs and recent births outpace losses. The veil defaults to a subdued teal so the simulation remains legible, ramps up saturation only when the ecosystem is thriving, and keeps alpha low enough that heatmaps, markers, and reproductive zones stay readable for motion-sensitive viewers.

### Grid line overlay

Need precise spatial context while you tune density or energy flows? Flip on **Show Grid Lines** inside the Overlays panel to outline every tile with a low-contrast lattice. Minor separators stay subtle while a slightly brighter line highlights each fifth row and column so you can judge distances at a glance without obscuring the heatmaps beneath.

### Obstacle layout presets

Select a **Layout Preset** in the Obstacles panel to immediately swap the grid's obstacle mask. The dropdown now applies changes as soon as you choose a preset, streamlining the workflow when experimenting with layouts. Use **Clear Obstacles** to reset the field if you need a blank slate again.
Hit **Shuffle Layout** to roll a random preset from the catalog without reaching for the dropdown—perfect for sparking new map ideas mid-run.

### Reproductive zone overlays

Focus reproduction by enabling preset regions—from hemispheres to central sanctuaries—and combining patterns to guide evolution. Toggle **Highlight Reproductive Zones** whenever you want to keep those rules active without shading the canvas, making it easier to watch emergent behaviour in crowded worlds.

### Empty tile energy slider

Find **Empty Tile Energy** in the Energy Dynamics panel to instantly rebalance how much resource sits on empty terrain. Drag the slider to rehydrate barren ground up to the shown percentage of the tile cap, or dial it down to create harsher survival conditions. Adjustments apply immediately to vacant tiles and set the baseline used for future world regenerations, so you can experiment with lush gardens or austere wastelands without restarting the app.

### Restore default tuning

Nudged a dozen sliders into a corner and want to get back to the canonical baseline? Hit **Restore Default Tuning** in the Simulation Controls panel. The button snaps similarity thresholds, environmental multipliers, energy flow rates, mutation and combat modifiers, playback speed, and the dashboard refresh cadence back to their default values so you can restart experiments without manually retracing every tweak.

### Keyboard shortcut reference

A collapsible **Keyboard Shortcuts** card now lives at the top of Simulation Controls. Expand it whenever you need a refresher on the current hotkeys—pause/resume, single-step, spawn bursts, and the speed controls all surface with the exact keys configured for your layout. Custom keymaps appear automatically, so you can lean on the cheat sheet without worrying about stale documentation.

## Core systems

The simulation runs on cooperating modules housed in `src/`:

- **Simulation engine** (`src/simulationEngine.js`) — Coordinates the render loop, tick cadence, and lifecycle events consumed by UI panels and automation hooks.
- **Grid manager** (`src/grid/gridManager.js`) — Maintains the cellular grid, applies movement, reproduction, energy transfer, and obstacle interactions, and surfaces snapshots for telemetry and overlays.
- **Energy system** (`src/energySystem.js`) — Computes tile-level regeneration, diffusion, and drain while blending in environmental events and density penalties.
- **Cell model** (`src/cell.js`) — Maintains per-organism state, applies DNA-driven preferences, and records telemetry consumed by fitness calculations and overlays.
- **Genetics and brains** (`src/genome.js`, `src/brain.js`) — DNA factories encode traits ranging from combat appetite to neural wiring. Brains interpret sensor inputs, adapt gains over time, and emit movement/interaction intents.
- **Interaction system** (`src/interactionSystem.js`) — Resolves cooperation, combat, and mating by blending neural intent with density, kinship, and configurable DNA traits.
- **Events & overlays** (`src/events/eventManager.js`, `src/events/eventEffects.js`, `src/events/eventContext.js`, `src/ui/overlays.js`) — Spawns floods, droughts, coldwaves, and heatwaves that shape resources and color overlays.
- **Stats & leaderboard** (`src/stats/index.js`, `src/stats/leaderboard.js`) — Aggregate per-tick metrics, maintain rolling history for UI charts, surface environmental summaries, select the top-performing organisms, and share trait aggregation helpers with [`src/stats/traitAggregation.js`](src/stats/traitAggregation.js) for telemetry.
- **Fitness scoring** (`src/engine/fitness.mjs`) — Computes composite organism fitness used by the leaderboard, overlays, and telemetry.
- **UI manager** (`src/ui/uiManager.js`) — Builds the sidebar controls, overlays, and metrics panels. A headless adapter in `src/ui/headlessUiManager.js` mirrors the interface for tests and Node scripts.
- **UI bridge** (`src/ui/simulationUiBridge.js`) — Wires the simulation engine to either the full UI or the headless adapter, keeping metrics streams, pause state, reproduction multipliers, and slider updates in sync across environments.
- **Selection tooling** (`src/grid/selectionManager.js`, `src/grid/reproductionZonePolicy.js`) — Defines preset mating zones, keeps geometry caches in sync with grid dimensions, and exposes helpers consumed by UI controls and reproduction policies.
- **Engine environment adapters** (`src/engine/environment.js`) — Normalize canvas lookups, sizing, and timing providers so the simulation can run inside browsers, tests, and offscreen contexts without bespoke wiring.
- **Utility helpers** (`src/utils/`) — Shared math, RNG, ranking, error-reporting, and cloning helpers consumed by the engine, UI, and tests.

For an architectural deep dive—including subsystem hand-offs, data flow, and extension tips—see [`docs/architecture-overview.md`](docs/architecture-overview.md).

## Headless and embedded usage

`createSimulation` exported from [`src/main.js`](src/main.js) stitches together the engine, UI, overlays, and lifecycle helpers. Pass `{ headless: true }` to obtain a headless controller for automation or tests and inject `{ requestAnimationFrame, cancelAnimationFrame, performanceNow }` to supply deterministic timing in non-browser environments. The helper will (see the developer guide's [tooling section](docs/developer-guide.md#tooling) for supporting scripts and environment tips):

- Resolve or create a canvas using [`resolveCanvas`](src/engine/environment.js) and [`ensureCanvasDimensions`](src/engine/environment.js), overriding the default `gameCanvas` lookup by passing `defaultCanvasId` when needed.
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
- **Environment tuning** — Set `COLOURFUL_LIFE_MAX_TILE_ENERGY` to raise or lower the tile energy cap. Use `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` / `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` to explore alternative density pressures, `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` to retune telemetry cutoffs, `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` to calm or emphasise territorial combat bias, `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` and `COLOURFUL_LIFE_DECAY_MAX_AGE` to shape post-mortem energy recycling, `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` to globally energise or relax genomes, `COLOURFUL_LIFE_MUTATION_CHANCE` to adjust baseline evolutionary churn, `COLOURFUL_LIFE_REPRODUCTION_COOLDOWN_BASE` to raise or lower the minimum post-birth recovery, and `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` to demand more or less surplus energy before births without modifying source defaults.
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

| Command/Script                               | Purpose                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm run start`                              | Launch the Parcel development server at `http://localhost:1234`.                                         |
| `npm run build`                              | Produce an optimized production bundle in `dist/`.                                                       |
| `npm run check`                              | Run linting, formatting verification, the energy benchmark, and the Node.js test suites.                 |
| `npm run clean [-- --dry-run]`               | Remove `dist/` and `.parcel-cache/`, or preview the removals first with `--dry-run`.                     |
| `npm run lint` / `npm run lint:fix`          | Run ESLint across the codebase, optionally applying autofixes.                                           |
| `npm run format` / `npm run format:check`    | Apply or verify Prettier formatting for source, docs, configs, and workflow definitions.                 |
| `npm test`                                   | Run the energy benchmark, then execute the Node.js test suites (paths, dirs, and watch flags supported). |
| `npm run benchmark`                          | Profile the energy preparation loop; combine with `PERF_*` variables to mirror CI scenarios.             |
| `node scripts/profile-density-cache.mjs`     | Benchmark cached density lookups in `GridManager` to confirm the density grid remains fast.              |
| `node scripts/profile-trait-aggregation.mjs` | Measure the trait aggregation pipeline that powers Stats overlays and dashboards.                        |
| `node scripts/profile-zone-filter.mjs`       | Benchmark the reproduction zone candidate filter used by `ReproductionZonePolicy`.                       |
| `npm run deploy:public`                      | Publish the production bundle using `scripts/publish-public-build.sh`.                                   |
| `npm run prepare`                            | Reinstall Husky hooks after cloning or when `.husky/` contents change.                                   |

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
