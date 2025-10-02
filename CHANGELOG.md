# Changelog

All notable changes to this project will be documented in this file. The format
roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where practical.

## [Unreleased]

### Added

- Documentation audit covering the README, developer guide, and architecture
  overview to highlight headless usage, cache-reset tooling, supporting
  modules, and the overlay rendering pipeline.
- Environment override documentation in the README and developer guide for
  `COLOURFUL_LIFE_MAX_TILE_ENERGY`, `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY`, and
  `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` so experiments can adjust
  regeneration and harvesting behaviour without editing source while keeping
  overlays accurate.
- Changelog tracking ongoing project evolution.

### Changed

- Expanded inline documentation for maintenance scripts to clarify intent and
  usage.
- Added JSDoc coverage for overlay helpers to keep exported drawing utilities
  self-documenting.
- Raised the default energy regeneration rate from `0.007` to `0.0075` after a
  200-tick headless run showed populations crashing to ~60 survivors (avg tile
  energy ~0.88) versus roughly 300 organisms and ~1.08 average energy with the
  higher baseline, improving ecosystem stability without removing scarcity
  pressure, and nudged it again to `0.0082` after tile-only probes settled
  closer to 3.0 energy versus 2.86 under moderate density, reducing early
  starvation cascades without saturating the map.
- Relocated the leaderboard refresh slider into the Evolution Insights panel,
  renaming it "Insights Refresh Interval" so cadence controls live alongside
  the metrics and leaderboard they influence.
- Moved the "Pause When Hidden" toggle next to the playback controls so
  auto-pause behaviour is discoverable alongside the Pause and Step actions.
- Removed the wall linger penalty control and supporting plumbing from the
  engine, UI, and headless adapter after determining it duplicated existing
  movement costs and defaulted to zero, simplifying obstacle behaviour while
  keeping the low-diversity reproduction slider as the primary tuning surface.

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
