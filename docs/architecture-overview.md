# Architecture Overview

This document captures how the Colourful Life simulation composes its core systems and how data flows between them. Use it as a map when extending the engine, creating new UI affordances, or embedding the simulation in automated tooling. For setup and workflow basics, start with the [README quick start](../README.md#quick-start) and the [developer guide](developer-guide.md).

## High-level loop

1. **SimulationEngine** (`src/engine/simulationEngine.js`) owns the render loop. Each frame it:
   - Requests the next animation frame (or uses injected timing hooks).
   - Prepares the grid for the upcoming tick via `grid.prepareTick`.
   - Advances the grid one step, which updates organism state, tile energy, events, and overlays.
   - Emits lifecycle events (`tick`, `metrics`, `leaderboard`, `state`) consumed by UI panels and analytics.
2. **UIManager** (`src/ui/uiManager.js`) renders controls, metrics, and overlays. It
   dispatches user actions (pause, stamping obstacles, slider changes) back to the
   engine by calling `engine` helpers exposed through `createSimulation`. When the
   browser UI is unavailable, `createHeadlessUiManager` in
   `src/ui/headlessUiManager.js` mirrors the same surface area so headless runs
   share settings and cadence management.
3. **SimulationUiBridge** (`src/ui/simulationUiBridge.js`) glues the engine to
   either the browser UI or the headless adapter. The bridge synchronises pause
   state, reproduction multipliers, metrics streams, leaderboard updates, and
   layout defaults while forwarding setting changes (e.g. updates-per-second
   sliders) back to the engine. Headless consumers receive a plain-object control
   surface with the same callbacks, making automated runs and browser sessions
   behave identically.
4. **Environment adapters** (`src/engine/environment.js`) normalise canvas
   lookup, sizing, and timing primitives so the engine can run in browsers,
   tests, or automation without bespoke wiring.

## Core subsystems

### GridManager

- Maintains a 2D array of cells (`grid`), an energy map, and obstacle masks.
- Drives reproduction, mutation, movement, combat, cooperation, and death each tick.
- Enforces energy exclusivity by immediately draining or redistributing tile reserves when a cell occupies a coordinate so no tile reports a resident and stored energy simultaneously.
- Delegates complex social interactions to **InteractionSystem** and neural decision making to **Brain** instances.
- Collects leaderboard entries by combining `computeFitness` with per-cell telemetry.
- Applies obstacle presets resolved via `resolveObstaclePresetCatalog` and exposes helpers such as
  `burstRandomCells` and `applyObstaclePreset` that the UI surfaces. Embedding contexts can pass
  `config.obstaclePresets` to extend or replace the catalog without touching core code.
- Integrates with `SelectionManager` and `ReproductionZonePolicy` to respect curated reproduction
  areas, and with wall-contact penalties configured per DNA profile.
- Reproduction candidate filtering flows through `ReproductionZonePolicy.filterSpawnCandidates`; `node scripts/profile-zone-filter.mjs` benchmarks the optimised path so large-zone layouts stay responsive.

### Cell

- Implemented in [`src/cell.js`](../src/cell.js), each `Cell` instance encapsulates DNA-derived behaviour, neural wiring, and telemetry gathered during simulation ticks.
- Maintains rolling histories for decisions, risk memories, and mating preferences so overlays and analytics modules can display recent context.
- Applies DNA-driven caps (e.g. crowding tolerance, neural fatigue profiles, diversity appetites) when responding to environment and interaction hooks.
- Emits decision traces consumed by telemetry pipelines and overlays.

### EnergySystem

- `computeTileEnergyUpdate` is called for each tile while the grid is preparing a tick.
- Blends base regeneration with density penalties, diffusion from neighbouring tiles, and modifiers contributed by active environmental events.
- Returns both the next energy value and any event metadata so overlays can highlight affected regions.
- The default regeneration coefficient (`0.0117`) pairs with a diffusion rate of
  `0.05` and a density penalty of `0.39`. Adjust these baselines via
  `resolveSimulationDefaults` or the environment overrides surfaced in
  [`src/config.js`](../src/config.js) when experimenting with alternative energy
  flows.

- Environment overrides such as `COLOURFUL_LIFE_MAX_TILE_ENERGY`,
  `COLOURFUL_LIFE_ENERGY_REGEN_RATE`,
  `COLOURFUL_LIFE_ENERGY_DIFFUSION_RATE`,
  `COLOURFUL_LIFE_ENERGY_SPARSE_SCAN_RATIO`,
  `COLOURFUL_LIFE_DENSITY_RADIUS`,
  `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY`,
  `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY`,
  `COLOURFUL_LIFE_DECAY_RETURN_FRACTION`,
  `COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE`,
  `COLOURFUL_LIFE_DECAY_RELEASE_BASE`,
  `COLOURFUL_LIFE_DECAY_RELEASE_RATE`,
  `COLOURFUL_LIFE_DECAY_MAX_AGE`,
  `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER`,
  `COLOURFUL_LIFE_REPRODUCTION_COOLDOWN_BASE`, and
  `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` flow through
  [`src/config.js`](../src/config.js), letting experiments tweak caps, regeneration
  suppression, harvesting taxes, reproduction scarcity, and trait activity
  sensitivity without patching source. The sanitized values are consumed by both
  the energy computations and overlays so telemetry stays in sync, and the
  [developer guide's configuration section](developer-guide.md#configuration-overrides)
  outlines how to combine them during longer experiments.

### Events

- **EventManager** (`src/events/eventManager.js`) spawns periodic floods, droughts, heatwaves, and coldwaves. Events carry strength, duration, and a rectangular affected area. The manager exposes a color resolver consumed by overlays and can be configured with custom event pools.
- **eventEffects** (`src/events/eventEffects.js`) maps event types to regeneration/drain modifiers and per-cell effects (energy loss, resistance genes).
- **eventModifiers** (`src/events/eventModifiers.js`) aggregates event-driven regeneration and drain multipliers,
  caching lookups so the energy grid and cell logic share a single calculation surface without importing each other.
- **eventContext** (`src/events/eventContext.js`) exposes helpers used by the grid and energy systems to determine whether an event affects a tile. Headless consumers can reuse it to keep behaviour consistent without depending on DOM state.
- Overlay rendering uses `EventManager.getColor` to shade the canvas and exposes `activeEvents` for analytics.

### Genetics and Brains

- **Genome** (`src/genome.js`) encodes organism traits and generates neural wiring instructions.
- **Brain** interprets those instructions, constructing sensor/activation maps that output intents for movement, interaction, reproduction, and targeting. Neural fatigue and reinforcement profiles derived from DNA bias decisions over time, letting organisms adapt strategy without deterministic scripts.
- Brains adapt sensor gains and baselines over time using DNA-provided modulation ranges, and apply neural plasticity profiles to fold energy/fatigue outcomes back into sensor targets so experience gradually refines instincts instead of leaving them static.
- DNA derives a `neuralReinforcementProfile` alongside plasticity data; cells convert it into per-decision reward signals that bias learning toward genome-preferred actions, energy states, and targeting focus instead of relying on hard-coded heuristics.
- DNA also provides a `neuralFatigueProfile` that cells use to accumulate neural fatigue from energy budgets and activation loads; the resulting fatigue dynamically shapes risk tolerance sensors so behaviour cools off when cognition is overtaxed and sharpens again when rested. Neural policies can now intentionally choose the `rest` movement to cash in DNA-tuned recovery efficiency, letting well-fed organisms clear fatigue faster in low-pressure environments.
- DNA now emits a `riskMemoryProfile` that couples neural sensor modulation with a short-term memory of resource trends, environmental shocks, and social support. Cells fold those memories back into risk tolerance, so scarcity, disasters, and ally presence push behaviour toward exploration, caution, or boldness based on genome-specific weights instead of hard-coded heuristics. The accumulated memories surface through `scarcityMemory` and `confidenceMemory` sensors, letting neural policies react to enduring shortages or resilience boons without bespoke scripts.
- Risk memories now actively imprint back into neural sensor gains via DNA-tuned assimilation, so prolonged scarcity, recurring disasters, or confidence streaks reshape the brain's perception instead of remaining passive telemetry. Brains gradually lean harder on the `resourceTrend`, `eventPressure`, and `riskTolerance` channels the genome cares about, tightening the loop between lived experience and future instincts.
- Neural reinforcement now tracks a DNA-tuned opportunity memory that blends recent neural rewards with energy swings, surfacing the rolling outcome through an `opportunitySignal` sensor. Brains can lean into strategies that are genuinely paying off—or cool off costly loops—without bolting on bespoke behaviour flags.
- DNA exposes a `metabolicProfile` translating activity, efficiency, and crowding genes into baseline maintenance drain and a density-driven crowding tax, so genomes comfortable in throngs waste less energy than solitary specialists when packed together.
- DNA now emits an `exploreExploitProfile` that blends exploration, foraging, movement, and restraint loci into baseline scouting bias, scarcity weighting, and scan urgency. Movement planners lean on that profile so curious lineages actively probe neighbouring tiles while conservation-minded genomes hold energy in reserve.
- DNA now exposes an `eventEnergyLossMultiplier(eventType, context)` trait that blends density, efficiency, recovery, and resistance loci into disaster susceptibility, so flood-hardened cooperators shrug off storms while reckless drifters hemorrhage energy without relying on hard-coded event penalties.
- DNA encodes an `offspringEnergyDemandFrac` that establishes a DNA-driven viability floor for reproduction. Parents refuse to spawn unless their combined energy investment clears the pickier genome's expectation, allowing nurturing lineages to favour fewer, well-funded offspring while opportunists tolerate lean births.
- `parentalInvestmentFrac` now blends parental, fertility, cooperation, recovery, gestation, efficiency, and risk loci, so supportive lineages willingly commit more energy while daring opportunists keep reserves for survival gambles.
- The environment-level `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` scales how much surplus energy above that DNA floor parents must stockpile before gestation begins, letting deployments tune scarcity without touching genome accessors.
- The environment-level `COLOURFUL_LIFE_REPRODUCTION_COOLDOWN_BASE` raises or lowers the minimum downtime parents observe after a successful birth. The actual cooldown now scales with each parent's energy investment, resilience genes, recent event pressure, and how evenly partners shared the gestation cost, so exhausted lineages recover slowly while well-fed cooperators bounce back quickly—yet the global floor and DNA-preferred delays still win when lineages evolve them.
- DNA's gestation locus now feeds `offspringEnergyTransferEfficiency`, blending metabolic, parental, and fertility traits with a heritable gestation efficiency gene. Offspring inherit only the delivered share of the parental investment, so lineages evolve toward thrifty or wasteful reproduction instead of assuming perfect energy transfer.
- Neural mate selection blends brain forecasts with DNA courtship heuristics. Each cell now previews reproduction sensors for every visible partner, folds the brain's acceptance probability into the mate's weight, and scales the influence using DNA-programmed reinforcement and sampling profiles. Populations that evolve richer neural wiring can therefore favour mates their brains predict will reciprocate, while simpler genomes continue to lean on legacy similarity heuristics.
- Successful or penalized matings imprint DNA-tuned mate affinity plasticity back into neural sensors, nudging `partnerSimilarity`, `mateSimilarity`, and `opportunitySignal` toward strategies that prove rewarding instead of freezing mate choice to static similarity heuristics.
- Baseline neural activity and mutation probability respond to the `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` and `COLOURFUL_LIFE_MUTATION_CHANCE` overrides, giving deployments coarse-grained levers for energising or calming populations and for tuning how quickly genomes mutate without editing DNA accessors.
- Post-mortem energy recycling honours the `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` and `COLOURFUL_LIFE_DECAY_MAX_AGE` overrides so deployments can dial how much energy decaying organisms return to nearby tiles and how long the reservoir persists, keeping scarcity or abundance experiments configuration-driven, while reproduction still flows through DNA-defined demand fractions modulated by both the configurable viability buffer and each genome's heritable viability temperament.
- DNA now feeds a `decayPersistenceTicks` trait into the grid so corpses from resilient, cooperative lineages linger longer before exhausting their reserve, while fragile, risk-prone genomes break down quickly. The weighted combination respects the global `COLOURFUL_LIFE_DECAY_MAX_AGE` while letting mixed remains blend their DNA-driven lifespans instead of defaulting to a single hard-coded timer.
- Decision telemetry is available through `cell.getDecisionTelemetry`, which instrumentation and overlays can consume for richer context.

### InteractionSystem

- Consumes neural output (fight/cooperate/reproduce) and resolves the outcome using combat odds, kinship, density advantages, and configurable DNA traits.
- Updates stats counters, applies energy costs, and notifies participating cells about interaction outcomes.
- Works through a `GridInteractionAdapter` to avoid tightly coupling to `GridManager` internals—useful for testing or custom grids.
- Territorial advantage in combat is governed by the `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` override. `resolveCombatTerritoryEdgeFactor` sanitizes the environment value into the 0–1 range before InteractionSystem applies it, keeping deployments from destabilising odds with extreme inputs.

### Stats and telemetry

- **Stats** (`src/stats/index.js`) accumulates per-tick metrics, maintains rolling history for charts, reports aggregate counters (births, deaths, fights, cooperations), and shares trait aggregation helpers with [`src/stats/traitAggregation.js`](../src/stats/traitAggregation.js) so dashboards and overlays reuse the same pipeline. Age-related telemetry is expressed in simulation ticks so downstream tools can map it to seconds using their chosen tick cadence.
- **Fitness** (`src/stats/fitness.js`) computes composite organism scores that blend survival, energy trends, and reproduction cadence. The leaderboard and overlays consume these scores to highlight thriving lineages.
- Life event summaries combine rolling birth/death counts with a net population delta and cadence indicator surfaced through the UI's "Life Event Log" panel, keeping the trend accessible to keyboard and assistive technology users. The Life Event Markers toggle now lives alongside the other map overlays in the Simulation Controls panel so observers can enable grid markers while dialing in canvas layers from a single location.
- Headless sampling over 300 ticks on a 60×60 grid (seed 12345) showed the prior `0.45` mating diversity threshold averaging ~0.27 diversity with five successes across 241 mate choices, while the gentler `0.42` baseline lifted diversity to ~0.30 with six successes in 269 attempts, so the default now reflects the less restrictive gate to avoid reproduction stalls in homogenised periods.
- **Leaderboard** (`src/stats/leaderboard.js`) combines `computeFitness` output with per-cell telemetry to surface top-performing organisms.

### UI and overlays

- `UIManager` uses builders in `src/ui/controlBuilders.js` to generate consistent control rows and slider behaviour.
- Overlays (`src/ui/overlays.js`) render density, energy, fitness, life-event markers, and obstacle layers on top of the main
  canvas, including contextual legends such as the energy overlay's min/mean/max summary so observers can quickly gauge resource
  availability.
- Selection tooling (`src/grid/selectionManager.js`) exposes reusable mating zones that gate reproduction.
- `ReproductionZonePolicy` (`src/grid/reproductionZonePolicy.js`) keeps `GridManager`'s reproduction flow decoupled from the selection implementation by translating zone checks into simple allow/deny results.
- `config.js` consolidates slider bounds, simulation defaults, and runtime-tunable constants such as diffusion and regeneration rates so UI and headless contexts remain in sync.
- The `src/utils/` directory houses deterministic helpers (`createRNG`, `createRankedBuffer`, `cloneTracePayload`, etc.) reused across the simulation, UI, and tests.
- Simulation Controls hosts the shared "Dashboard Refresh Interval" slider exposed via `leaderboardIntervalMs`, keeping cadence tuning beside the other global knobs while still driving Evolution Insights and the leaderboard updates from one place.

- The overlay pipeline is orchestrated by `drawOverlays`, which delegates to granular helpers (`drawEventOverlays`,
  `drawEnergyHeatmap`, `drawDensityHeatmap`, `drawFitnessHeatmap`) and reuses color ramps such as `densityToRgba`. Each helper
  exposes legends or palette selection so UI extensions can stay consistent without reimplementing scaling logic.

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

- `scripts/profile-energy.mjs` benchmarks the grid preparation loop. Tune dimensions via `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, `PERF_ITERATIONS`, and adjust the stub cell size with `PERF_CELL_SIZE`.
- `npm run clean` delegates to Parcel's built-in clean routine to remove `dist/` and `.parcel-cache/` when the bundler cache becomes inconsistent.
- Additional helpers in `scripts/` showcase headless usage patterns. Each script is documented inline with configuration tips, and `scripts/profile-energy.mjs` is the canonical benchmarking harness used during performance profiling.

For further guidance, browse the inline JSDoc across `src/` and the tests under `test/` to see concrete usage patterns.
