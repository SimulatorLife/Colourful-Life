# Changelog

All notable changes to this project will be documented in this file. The format
roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where practical.

## [Unreleased]

### Added

- Optional Aurora Celebration Veil overlay that tints the canvas with a low-contrast,
  energy- and birth-responsive aurora while keeping other telemetry readable and
  disabled by default.
- Simulation clock in Evolution Insights showing elapsed simulated time and the
  cumulative tick count so pacing stays visible without mental math.
- Regression tests ensuring the insights, life events, and leaderboard panels
  queue updates while collapsed so performance optimisations remain covered.
- Documentation audit covering the README, developer guide, architecture overview, and changelog to highlight headless usage, cache-reset tooling, supporting modules such as the cell model, and the overlay rendering pipeline.
- Regression guard for the `npm run clean` workflow: the clean script now supports `--dry-run` and is verified by automated tests so agentic changes cannot regress cache cleanup.
- DNA-tuned opportunity memory that feeds a new `opportunitySignal` sensor, letting neural policies lean on real reward history and energy swings instead of scripted behaviour knobs.
  - DNA-driven combat learning profile that imprints fight outcomes into neural targeting and risk sensors, encouraging organisms to adapt their strategy dynamically instead of relying on fixed aggression presets.
  - DNA-shaped foraging imprint that records harvest outcomes into neural sensor gains so scarcity, crowding, and energy reserve cues emerge from lived resource history instead of static gathering heuristics.
- Birth and death cadence sparklines in the Evolution Insights dashboard backed by new stats history series so reproduction surges and attrition spikes are visible at a glance.
- Environment override documentation in the README and developer guide for `COLOURFUL_LIFE_MAX_TILE_ENERGY`, `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY`, `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY`, and `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` so experiments can adjust regeneration, harvesting behaviour, and telemetry thresholds without editing source while keeping overlays accurate.
- Developer guide call-out pointing contributors to the overlay JSDoc style so future canvas helpers stay self-documenting.
- Changelog tracking ongoing project evolution.
- Life event dashboard summary combining births, deaths, and net population cadence derived from a new stats helper so observers can spot surges or collapses without scanning individual log entries.
- Simulation law formalising energy exclusivity along with code and tests that ensure tiles occupied by organisms never report stored energy.
- README guidance for embedding and headless automation, plus repository layout notes covering the engine environment adapters and shared utilities.
- Architecture overview coverage for the environment adapters and life event summaries to keep subsystem documentation aligned with the current UI.
- JSDoc coverage for the canvas/timing environment helpers so every exported function documents its contract for browser and headless consumers.

### Changed

- Tightened the primary documentation (README, developer guide, architecture notes) to streamline quick-start guidance, highlight subsystem profiling harnesses, and document the shared trait aggregation helpers used by Stats.
- Moved the "Pause When Hidden" toggle from the Simulation Controls panel to the pause overlay so focus behaviour can be tweaked beside the autopause hint that appears while the grid is halted.
- Refreshed the README, developer guide, and architecture overview to streamline
  the quick-start flow, trim stale metrics, and clarify where configuration
  overrides live so primary docs mirror the current architecture.
- Clarified quick-start guidance and contributor workflow docs to call out `npm run check`, the built-in energy benchmark that precedes `npm test`, and focused watch/file-path options for faster feedback while developing.
- Amplified the low-diversity reproduction penalty when parents accumulate mate novelty pressure so lineages stuck in repetitive pairings feel stronger pressure to diversify.
- Relocated the "Life Event Markers" toggle into the Simulation Controls overlay
  stack so the grid markers live beside the other canvas layers they
  complement.
- Retired the standalone Dashboard Settings panel and relocated the shared
  "Dashboard Refresh Interval" slider into Evolution Insights so cadence tuning
  sits beside the metrics it drives while still flagging the leaderboard's
  matching update schedule.
- Clarified the Node.js 25.0.0 requirement in the developer guide and added the
  `COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE` override to the README so onboarding
  steps and configuration references match the current runtime and
  environment hooks.
- Expanded configuration coverage across the README, developer guide, and
  architecture overview to include the energy regeneration, diffusion, and decay
  release overrides alongside updated quick-start and tooling guidance.
- Collapsed dashboard panels now defer metrics, life events, and leaderboard
  rendering work, cutting 50 closed-panel metrics refreshes from ~73.9 ms to
  ~0.84 ms by queueing the latest payload until the panel is reopened.
- README, architecture overview, and developer guide now cross-link workflow
  basics and highlight quick verification commands (`npm test`, `npm run lint`,
  `npm run format:check`) so contributors land on accurate setup guidance
  without bouncing between documents.
- Automatic reseeding has been removed from decay pools, grid resets, and
  geometry changes; the world now stays empty unless `reseed: true` is
  explicitly requested, keeping lineage growth compliant with Simulation Law 7.
- Documentation now calls out the `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR`,
  `COLOURFUL_LIFE_ACTIVITY_BASE_RATE`, and `COLOURFUL_LIFE_MUTATION_CHANCE`
  overrides across the README, developer guide, and architecture notes so
  deployments know how to tune combat bias, neural energy, and mutation rates
  without spelunking source.
- Tightened the README and developer guide quick-start steps to highlight the Node.js 25.x baseline, consolidate recurring Husky
  setup, and cross-link configuration details to the architecture overview so onboarding stays accurate.
- Refreshed documentation across the README, developer guide, and architecture
  notes to highlight the UI bridge, fitness scoring module, Husky hook setup,
  and new formatting scripts so contributor workflows mirror the current code.
- Grouped configuration override guidance across the README, developer guide,
  and architecture overview while tightening the quick-start flow to call out
  `npm run prepare`, cache resets, and the supporting documentation map.
- Streamlined the README quick start, developer guide, and public hosting
  instructions to surface npm script aliases (including `npm run benchmark` and
  `npm run deploy:public`), clarify publishing steps, and reduce duplicated
  onboarding guidance.
- Reproduction acceptance now blends neural policy intent with the genome's
  baseline instincts using DNA-tuned weights that react to opportunity,
  scarcity, neural fatigue, and network confidence, replacing the former
  fixed average so reproductive behaviour adapts dynamically per organism.
- Expanded inline documentation for maintenance scripts to clarify intent and
  usage.
- Expanded JSDoc coverage for overlay helpers (celebration glow, life events,
  density/energy/fitness heatmaps, selection zones) so exported drawing
  utilities remain self-documenting.
- Moved the "Low Diversity Penalty ×" slider into the Similarity Thresholds
  section so reproduction tuning lives alongside the diversity cutoff and
  ally/enemy similarity sliders.
- Lowered the default energy regeneration rate to `0.0117`, trimmed diffusion to
  `0.05`, and set the density penalty to `0.39` so crowded hubs return less
  energy each tick while sparse tiles still recover reliably.
- Raised the default decay return fraction to `0.89` after the dense 40×40
  headless probe (`PERF_INCLUDE_SIM=1 PERF_SIM_ROWS=40 PERF_SIM_COLS=40
PERF_SIM_WARMUP=20 PERF_SIM_ITERATIONS=80 PERF_SIM_DENSITY=0.68 node
scripts/profile-energy.mjs`) lifted survivors from 135 → 137 and trimmed the
  ms-per-tick average from ~135 ms → ~99 ms by recycling a touch more
  corpse energy into contested hubs without flooding calm regions.
- Increased the reproduction viability buffer by 15 % so offspring only spawn
  when parents stockpile meaningful reserves instead of skimming the minimum
  threshold.
- Nudged the low-diversity reproduction multiplier floor from `0.55` to `0.57`
  after a 600-tick headless probe (30×30 grid, seed 1337) lifted the post-
  warmup population floor from 47 to 76 and trimmed recent starvation from
  0.104 to 0.077, giving bottlenecked colonies enough births to stabilise
  without erasing similarity pressure despite brief starvation spikes.
- Elevated the low-diversity reproduction multiplier floor to `0.55` and wired
  cathartic scarcity relief directly into the reproduction cooldowns, allowing
  bottlenecked populations to recover while leaving the diversity pressure
  intact during healthy runs.

### Removed

- Removed the Aurora Veil overlay toggle and renderer to reduce UI clutter and
  maintenance overhead for a purely celebratory effect that duplicated the
  existing overlay plumbing without surfacing simulation data.
- Retired the unused `scripts/measure-brain-evaluate.mjs` and
  `scripts/profile-population-cells.mjs` profiling harnesses so the scripts
  directory only contains actively maintained automation entry points.
- Retired unused profiling and memory benchmarking harnesses
  (`scripts/bench-segmented-events.mjs`, `scripts/benchmark-trait-aggregates.mjs`,
  `scripts/eventManagerMemoryBenchmark.mjs`, `scripts/measure-decay-active-memory.mjs`,
  `scripts/measure-diversity-memory.js`, `scripts/measure-fitness-overlay-memory.mjs`,
  `scripts/measure-target-pool.mjs`, `scripts/profile-density.mjs`,
  `scripts/profile-draw-spark.mjs`, `scripts/profile-memory.mjs`,
  `scripts/profile-render-loop.mjs`, `scripts/profile-sensor-feedback.mjs`, and
  `scripts/profile-snapshot-memory.mjs`) so the scripts directory focuses on the
  maintained automation entry points.
- Retired the unused `scripts/brain-memory-profile.mjs` harness now superseded by
  the energy and density profiling scripts, keeping the automation catalog
  limited to maintained entry points.
- Removed the unused `scripts/profile-target-similarity-memory.mjs` probe now
  that the density and target selection instrumentation lives in the stats and
  regression suites, keeping the scripts directory limited to maintained
  profiling entry points.
- Retired the Trait Focus overlay and associated headless controls; trait
  expression metrics now live exclusively in the dashboard cards and
  sparklines, eliminating the per-frame gene sampling pass that duplicated
  Stats work while offering the same insights.
- The `COLOURFUL_LIFE_DECAY_SPAWN_MIN_ENERGY` override and decay-triggered
  reseeding hook have been retired; decay now only returns energy, leaving
  population recovery to living lineages or explicit reseed requests.
- Removed the unused `scripts/benchmarks/stats-trait-aggregate.bench.mjs`
  benchmark harness so historical trait aggregation experiments don't linger in
  the tree now that automated coverage protects the optimised implementation.
- Removed the unused `scripts/profile-findTargets-scan.mjs` benchmark and
  retired the legacy `scripts/profile-find-targets.mjs` harness so the
  profiling suite sticks to the maintained energy benchmark without duplicate
  scan logic lingering in the repository.
- Retired the unused `scripts/profile-active-snapshot.mjs` benchmarking helper
  to shrink the maintenance surface for profiling utilities.
- Trimmed the stale `scripts/profile-traits.js` benchmark harness now that
  Stats trait aggregation is covered by automated tests, keeping the profiling
  suite focused on maintained scenarios.

### Fixed

- Auto-seeded organisms now draw enough energy to clear their DNA-driven
  starvation threshold before entering the tick loop, preventing the visual
  flash where fresh spawns vanished immediately after appearing when tile
  reserves were too low under the reduced max tile energy cap.
- Ensured senescence always progresses by feeding GridManager the unclamped age
  fraction, guaranteeing hazard escalation, and by enforcing a hard death cap
  once organisms triple their DNA lifespan so immobile lineages cannot linger
  indefinitely.
- Dead organisms now decompose organically, returning energy to nearby tiles so
  corpses never linger indefinitely and the headless population stability
  harness retains a viable energy budget.
- Prevented the Corner Islands obstacle preset from evicting every organism by
  recalculating the final layout before blocking tiles, preserving residents
  inside the carved pockets while still sealing the surrounding terrain.
- Removed horizontal scroll bars from sidebar panels by clamping their width
  and allowing controls to flex within the available space so each panel stays
  within a single view.
- Realigned the Simulation Controls show/hide toggle by moving scrollbar
  gutter spacing into the scrollable body so its header button lines up with
  the other panel toggles.

### Removed

- Retired the "Draw Custom Zone" controls, simulation hooks, and documentation
  because the advanced drawing workflow saw almost no use, players preferred a
  more observational experience with simple presets, and the extra UI surfaced
  little value while bloating the sidebar.
- Lowered the default mating diversity threshold from `0.45` to `0.42` after a
  300-tick headless run (60×60 grid, seed 12345) nudged mean diversity from
  ~0.27 to ~0.30 and raised successful matings from 5/241 to 6/269, easing
  reproduction stalls while preserving the diversity incentive in crowded
  stretches.
- Relocated the "Pause When Hidden" toggle to live directly beneath the
  playback controls in the Simulation Controls panel so the focus-dependent
  behaviour sits alongside the cadence actions it influences, and kept it
  disabled by default so unattended, long-running simulations continue
  advancing when the browser tab loses focus.
- Shifted the playback speed slider beneath the Pause/Step controls so cadence
  adjustments live with the playback actions they influence.
- Removed the wall linger penalty control and supporting plumbing from the
  engine, UI, and headless adapter after determining it duplicated existing
  movement costs and defaulted to zero, simplifying obstacle behaviour while
  keeping the low-diversity reproduction slider as the primary tuning surface.
- Deleted the legacy CommonJS energy profiling harness in favour of the
  environment-aware ES module variant so only the supported benchmarking tool
  remains in `scripts/profile-energy.mjs`.
- Normalised README command tables and cross-links so contributor workflow references stay easy to scan.
- Consolidated the obstacle layout preset control so selecting a preset immediately applies it, removing the extra "Apply Layout" button to simplify the UI and reduce the number of steps required to test different masks.

## [0.1.0]

### Added

- Initial release of Colourful Life featuring:
  - A modular simulation engine (`src/simulationEngine.js`) coordinating the
    render loop and lifecycle events.
  - Grid management with energy diffusion, reproduction, combat, and genetic
    diversity systems (`src/grid/gridManager.js`).
  - Neural genome, brain, and interaction systems powering emergent behaviour
    (`src/genome.js`, `src/brain.js`, `src/interactionSystem.js`).
  - Environmental events, overlays, and statistics modules to visualise the
    world (`src/events/eventManager.js`, `src/ui/overlays.js`, `src/stats/index.js`).
  - Browser UI controls and a headless adapter exposed via `createSimulation`
    (`src/ui/uiManager.js`, `src/main.js`).
