# Changelog

All notable changes to this project will be documented in this file. The format
roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where practical.

## [Unreleased]

### Added

- Regression tests ensuring the insights, life events, and leaderboard panels
  queue updates while collapsed so performance optimisations remain covered.
- Documentation audit covering the README, developer guide, architecture overview, and changelog to highlight headless usage, cache-reset tooling, supporting modules such as the cell model, and the overlay rendering pipeline.
- Regression guard for the `npm run clean` workflow: the clean script now supports `--dry-run` and is verified by automated tests so agentic changes cannot regress cache cleanup.
- DNA-tuned opportunity memory that feeds a new `opportunitySignal` sensor, letting neural policies lean on real reward history and energy swings instead of scripted behaviour knobs.
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

- Collapsed dashboard panels now defer metrics, life events, and leaderboard
  rendering work, cutting 50 closed-panel metrics refreshes from ~73.9 ms to
  ~0.84 ms by queueing the latest payload until the panel is reopened.
- Documentation now calls out the `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR`,
  `COLOURFUL_LIFE_ACTIVITY_BASE_RATE`, and `COLOURFUL_LIFE_MUTATION_CHANCE`
  overrides across the README, developer guide, and architecture notes so
  deployments know how to tune combat bias, neural energy, and mutation rates
  without spelunking source.
- Refreshed documentation across the README, developer guide, and architecture
  notes to highlight the UI bridge, fitness scoring module, Husky hook setup,
  and new formatting scripts so contributor workflows mirror the current code.
- Reproduction acceptance now blends neural policy intent with the genome's
  baseline instincts using DNA-tuned weights that react to opportunity,
  scarcity, neural fatigue, and network confidence, replacing the former
  fixed average so reproductive behaviour adapts dynamically per organism.
- Expanded inline documentation for maintenance scripts to clarify intent and
  usage.
- Expanded JSDoc coverage for overlay helpers (celebration glow, life events,
  density/energy/fitness heatmaps, selection zones) so exported drawing
  utilities remain self-documenting.
- Relocated the "Dashboard Refresh Interval" slider into Evolution Insights so
  cadence controls live alongside the analytics they govern while keeping the
  leaderboard on the shared refresh schedule.
- Lowered the default energy regeneration rate to `0.012`, trimmed diffusion to
  `0.05`, and raised the density penalty to `0.42` so crowded hubs return less
  energy each tick while sparse tiles still recover reliably.
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
- Added an opt-in auto-reseeding path for `GridManager` so headless stability
  harnesses can replenish populations once they fall below the legal floor
  without interfering with tests that expect a dormant world.

### Fixed

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
- Relocated the "Pause When Hidden" toggle beneath the playback controls so the
  auto-pause behaviour lives alongside the Pause/Step actions it complements
  while remaining easy to discover, and kept it disabled by default so
  unattended, long-running simulations continue advancing when the browser tab
  loses focus.
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
    world (`src/events/eventManager.js`, `src/ui/overlays.js`, `src/stats.js`).
  - Browser UI controls and a headless adapter exposed via `createSimulation`
    (`src/ui/uiManager.js`, `src/main.js`).
