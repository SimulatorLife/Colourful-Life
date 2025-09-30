# Architecture Overview

This document captures how the Colourful Life simulation composes its core systems and how data flows between them. Use it as a map when extending the engine, creating new UI affordances, or embedding the simulation in automated tooling.

## High-level loop

1. **SimulationEngine** (`src/simulationEngine.js`) owns the render loop. Each frame it:
   - Requests the next animation frame (or uses injected timing hooks).
   - Prepares the grid for the upcoming tick via `grid.prepareTick`.
   - Advances the grid one step, which updates organism state, tile energy, events, and overlays.
   - Emits lifecycle events (`tick`, `metrics`, `leaderboard`, `state`) consumed by UI panels and analytics.
2. **UIManager** (`src/uiManager.js`) renders controls, metrics, and overlays. It dispatches user actions (pause, stamping obstacles, slider changes) back to the engine by calling `engine` helpers exposed through `createSimulation`.
3. **BrainDebugger** (`src/brainDebugger.js`) receives neuron snapshots from the grid and exposes them to the browser console for inspection. The debugger is optional in headless environments.

## Core subsystems

### GridManager

- Maintains a 2D array of cells (`grid`), an energy map, and obstacle masks.
- Drives reproduction, mutation, movement, combat, cooperation, and death each tick.
- Delegates complex social interactions to **InteractionSystem** and neural decision making to **Brain** instances.
- Collects leaderboard entries by combining `computeFitness` with Brain snapshots.
- Applies obstacle presets (`OBSTACLE_PRESETS`) and exposes helpers such as `burstRandomCells`, `applyObstaclePreset`, and `setLingerPenalty` that the UI surfaces.

### EnergySystem

- `computeTileEnergyUpdate` is called for each tile while the grid is preparing a tick.
- Blends base regeneration with density penalties, diffusion from neighbouring tiles, and modifiers contributed by active environmental events.
- Returns both the next energy value and any event metadata so overlays can highlight affected regions.

### Events

- **EventManager** spawns periodic floods, droughts, heatwaves, and coldwaves. Events carry strength, duration, and a rectangular affected area.
- **eventEffects** maps event types to regeneration/drain modifiers and per-cell effects (energy loss, resistance genes).
- Overlay rendering uses `EventManager.getColor` to shade the canvas and exposes `activeEvents` for analytics.

### Genetics and Brains

- **Genome** (`src/genome.js`) encodes organism traits and generates neural wiring instructions.
- **Brain** interprets those instructions, constructing sensor/activation maps that output intents for movement, interaction, reproduction, and targeting.
- Brains adapt sensor gains and baselines over time using DNA-provided modulation ranges.
- Decision telemetry is available through `cell.getDecisionTelemetry`, which the debugger captures for UI display.

### InteractionSystem

- Consumes neural output (fight/cooperate/reproduce) and resolves the outcome using combat odds, kinship, density advantages, and configurable DNA traits.
- Updates stats counters, applies energy costs, and notifies participating cells about interaction outcomes.
- Works through a `GridInteractionAdapter` to avoid tightly coupling to `GridManager` internals—useful for testing or custom grids.

### UI and overlays

- `UIManager` uses builders in `src/ui/controlBuilders.js` to generate consistent control rows and slider behaviour.
- Overlays (`src/overlays.js`) render density, energy, fitness, and obstacle layers on top of the main canvas.
- Selection tooling (`src/selectionManager.js`) exposes reusable mating zones and user-drawn rectangles that gate reproduction.

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
- **Additional overlays** — Export a renderer from `src/overlays.js` and register it in `SimulationEngine`'s draw pipeline.
- **Alternative UIs** — Implement a UI adapter mirroring the methods documented in `createHeadlessUiManager` and pass it through `config.ui`.
- **Data exports** — Subscribe to `SimulationEngine` events to stream metrics, leaderboard entries, or raw grid snapshots to external consumers.

## Related scripts

- `scripts/profile-energy.mjs` benchmarks the grid preparation loop. Tune dimensions via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, and `PERF_ITERATIONS`.

For further guidance, browse the inline JSDoc across `src/` and the tests under `test/` to see concrete usage patterns.
