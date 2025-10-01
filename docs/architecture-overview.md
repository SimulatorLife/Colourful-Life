# Architecture Overview

This document captures how the Colourful Life simulation composes its core systems and how data flows between them. Use it as a map when extending the engine, creating new UI affordances, or embedding the simulation in automated tooling.

## High-level loop

1. **SimulationEngine** (`src/simulationEngine.js`) owns the render loop. Each frame it:
   - Requests the next animation frame (or uses injected timing hooks).
   - Prepares the grid for the upcoming tick via `grid.prepareTick`.
   - Advances the grid one step, which updates organism state, tile energy, events, and overlays.
   - Emits lifecycle events (`tick`, `metrics`, `leaderboard`, `state`) consumed by UI panels and analytics.
2. **UIManager** (`src/ui/uiManager.js`) renders controls, metrics, and overlays. It dispatches user actions (pause, stamping obstacles, slider changes) back to the engine by calling `engine` helpers exposed through `createSimulation`. When the browser UI is unavailable, `createHeadlessUiManager` in `src/main.js` mirrors the same surface area so headless runs share settings and cadence management.
3. **BrainDebugger** (`src/ui/brainDebugger.js`) receives neuron snapshots from the grid and exposes them to the browser console for inspection. The debugger is optional in headless environments and doubles as the default brain snapshot collector for headless runs.

## Core subsystems

### GridManager

- Maintains a 2D array of cells (`grid`), an energy map, and obstacle masks.
- Drives reproduction, mutation, movement, combat, cooperation, and death each tick.
- Delegates complex social interactions to **InteractionSystem** and neural decision making to **Brain** instances.
- Collects leaderboard entries by combining `computeFitness` with Brain snapshots.
- Applies obstacle presets (`OBSTACLE_PRESETS`) and exposes helpers such as `burstRandomCells`, `applyObstaclePreset`, and `setLingerPenalty` that the UI surfaces.
- Integrates with `SelectionManager` and `ReproductionZonePolicy` to respect curated reproduction areas, and with wall-contact penalties configured per DNA profile.

### EnergySystem

- `computeTileEnergyUpdate` is called for each tile while the grid is preparing a tick.
- Blends base regeneration with density penalties, diffusion from neighbouring tiles, and modifiers contributed by active environmental events.
- Returns both the next energy value and any event metadata so overlays can highlight affected regions.

### Events

- **EventManager** (`src/events/eventManager.js`) spawns periodic floods, droughts, heatwaves, and coldwaves. Events carry strength, duration, and a rectangular affected area. The manager exposes a colour resolver consumed by overlays and can be configured with custom event pools.
- **eventEffects** (`src/events/eventEffects.js`) maps event types to regeneration/drain modifiers and per-cell effects (energy loss, resistance genes).
- **eventContext** (`src/events/eventContext.js`) exposes helpers used by the grid and energy systems to determine whether an event affects a tile. Headless consumers can reuse it to keep behaviour consistent without depending on DOM state.
- Overlay rendering uses `EventManager.getColor` to shade the canvas and exposes `activeEvents` for analytics.

### Genetics and Brains

- **Genome** (`src/genome.js`) encodes organism traits and generates neural wiring instructions.
- **Brain** interprets those instructions, constructing sensor/activation maps that output intents for movement, interaction, reproduction, and targeting. Neural fatigue and reinforcement profiles derived from DNA bias decisions over time, letting organisms adapt strategy without deterministic scripts.
- Brains adapt sensor gains and baselines over time using DNA-provided modulation ranges, and apply neural plasticity profiles to fold energy/fatigue outcomes back into sensor targets so experience gradually refines instincts instead of leaving them static.
- DNA derives a `neuralReinforcementProfile` alongside plasticity data; cells convert it into per-decision reward signals that bias learning toward genome-preferred actions, energy states, and targeting focus instead of relying on hard-coded heuristics.
- DNA also provides a `neuralFatigueProfile` that cells use to accumulate neural fatigue from energy budgets and activation loads; the resulting fatigue dynamically shapes risk tolerance sensors so behaviour cools off when cognition is overtaxed and sharpens again when rested. Neural policies can now intentionally choose the `rest` movement to cash in DNA-tuned recovery efficiency, letting well-fed organisms clear fatigue faster in low-pressure environments.
- Decision telemetry is available through `cell.getDecisionTelemetry`, which the debugger captures for UI display.

### InteractionSystem

- Consumes neural output (fight/cooperate/reproduce) and resolves the outcome using combat odds, kinship, density advantages, and configurable DNA traits.
- Updates stats counters, applies energy costs, and notifies participating cells about interaction outcomes.
- Works through a `GridInteractionAdapter` to avoid tightly coupling to `GridManager` internals—useful for testing or custom grids.

### Stats and telemetry

- **Stats** (`src/stats.js`) accumulates per-tick metrics, maintains rolling history for charts, and reports aggregate counters (births, deaths, fights, cooperations).
- **Leaderboard** (`src/leaderboard.js`) combines `computeFitness` output with brain snapshots to surface top-performing organisms.
- **BrainDebugger** (`src/ui/brainDebugger.js`) mirrors neuron traces into the browser console for inspection. `SimulationEngine` forwards snapshots each tick when the debugger is available, and the debugger doubles as the default brain snapshot collector for headless runs.

### UI and overlays

- `UIManager` uses builders in `src/ui/controlBuilders.js` to generate consistent control rows and slider behaviour.
- Overlays (`src/ui/overlays.js`) render density, energy, fitness, and obstacle layers on top of the main canvas.
- Selection tooling (`src/ui/selectionManager.js`) exposes reusable mating zones and user-drawn rectangles that gate reproduction.
- `ReproductionZonePolicy` (`src/grid/reproductionZonePolicy.js`) keeps `GridManager`'s reproduction flow decoupled from the selection implementation by translating zone checks into simple allow/deny results.
- `config.js` consolidates slider bounds, simulation defaults, and runtime-tunable constants such as diffusion and regeneration rates so UI and headless contexts remain in sync.
- `utils.js` houses deterministic helpers (`createRNG`, `createRankedBuffer`, `cloneTracePayload`, etc.) reused across the simulation, UI, and tests.

## Headless and scripted usage

The factory exported by `src/main.js` (`createSimulation`) returns a controller with:

- `engine`, `grid`, `eventManager`, `stats`, and `selectionManager` references.
- Lifecycle helpers: `start`, `stop`, `pause`, `resume`, `tick`, and `destroy`.
- A headless UI façade when `{ headless: true }` is passed, mirroring slider getters/setters without touching the DOM.

When running outside the browser:

- Supply a canvas-like object (e.g., `OffscreenCanvas`) or provide `config.canvasWidth`/`config.canvasHeight` so the engine can size itself.
- Inject deterministic RNG/timing hooks to produce reproducible runs.
- Skip DOM wiring by omitting `document`/`window` or passing explicit mocks.

## Extending the simulation

- **New traits or behaviours** — Extend `genome.js` to encode the trait and add corresponding hooks in `Cell`/`InteractionSystem`.
- **Additional overlays** — Export a renderer from `src/ui/overlays.js` and register it in `SimulationEngine`'s draw pipeline.
- **Alternative UIs** — Implement a UI adapter mirroring the methods documented in `createHeadlessUiManager` and pass it through `config.ui`.
- **Data exports** — Subscribe to `SimulationEngine` events to stream metrics, leaderboard entries, or raw grid snapshots to external consumers.

## Related scripts

- `scripts/profile-energy.mjs` benchmarks the grid preparation loop. Tune dimensions via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, and `PERF_ITERATIONS`.
- `scripts/clean-parcel.js` clears `dist/` and `.parcel-cache/` and underpins the `npm run clean:parcel` command for recovering from stubborn Parcel state.
- Additional helpers in `scripts/` showcase headless usage patterns. Each script is documented inline with configuration tips.

For further guidance, browse the inline JSDoc across `src/` and the tests under `test/` to see concrete usage patterns.
