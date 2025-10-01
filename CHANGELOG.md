# Changelog

All notable changes to this project will be documented in this file. The format
roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
where practical.

## [Unreleased]

### Added

- Documentation audit covering the README, developer guide, and architecture
  overview to highlight headless usage, cache-reset tooling, and supporting
  modules.
- Changelog tracking ongoing project evolution.

### Changed

- Expanded inline documentation for maintenance scripts to clarify intent and
  usage.
- Raised the default energy regeneration rate from `0.007` to `0.0075` after a
  200-tick headless run showed populations crashing to ~60 survivors (avg tile
  energy ~0.88) versus roughly 300 organisms and ~1.08 average energy with the
  higher baseline, improving ecosystem stability without removing scarcity
  pressure.

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
