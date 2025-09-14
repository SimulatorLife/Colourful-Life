# Cleanup and Cohesion Tasks

## 1) Consolidate Events into `EventManager`

- Goal: Move `applyEventEffects` logic from `index.html` into an instance method `applyToCell(cell, r, c)` on `EventManager`.
- Why: Improves cohesion; all event behavior in one class.
- Changes:
  - Add `applyToCell(cell, r, c, strengthMultiplier)` to `eventManager.js`.
  - Replace calls to free function `applyEventEffects` in `index.html` with `eventManager.applyToCell(...)`, passing UI multiplier.
  - Remove the standalone function from `index.html`.
- Affects: `eventManager.js`, `index.html`.
- Acceptance: No behavior change; events still overlay and affect energy identically.

## 2) Centralize Config Constants

- Goal: Extract magic numbers to a shared `config.js` (e.g., cell size, max energies, regen, density radius, UI defaults).
- Why: Single source of truth; easier tuning and testing.
- Changes:
  - Create `config.js` exporting constants and default UI values.
  - Update `index.html`, `uiManager.js`, and `eventManager.js` to import from `config.js`.
  - Allow `UIManager` to update only whitelisted runtime tunables (not structural constants like `cellSize`).
- Affects: `index.html`, `uiManager.js`, `eventManager.js`.
- Acceptance: Build runs; constants removed from scattered locations; UI sliders initialize from config values.

## 3) Seeded `SimulationRNG` Service

- Goal: Introduce a top-level seeded RNG for the run and route non-DNA randomness through it.
- Why: Reproducible simulations; de-dup RNG utilities.
- Changes:
  - Add `rng.js` exporting `createRNG` (or reuse from `utils.js`) and `SimulationRNG` instance seeded once.
  - Pass RNG (or a scoped generator) into `EventManager`, `GridManager` selection rolls, and `DNA.random`.
  - Replace remaining `Math.random` with `randomRange`/`randomPercent` backed by the seeded RNG.
- Affects: `index.html`, `eventManager.js`, possibly `utils.js`.
- Acceptance: Given a fixed seed, repeated runs produce the same macro sequence (events, seeding spots, selections).

## 4) Extract `Renderer` Class

- Goal: Move drawing concerns (cells, overlays) out of `GridManager` into `Renderer`.
- Why: Reduce coupling; `GridManager` manages state only.
- Changes:
  - Create `renderer.js` with `Renderer(canvas, cellSize)` and methods `drawGrid(grid, energyOverlay?)`, `drawEventOverlay(event)`.
  - Update main loop in `index.html` to call `renderer.draw...` instead of `grid.draw()`.
- Affects: `index.html`.
- Acceptance: Visual output unchanged; code split is clear.

## 5) Unify Movement & Interaction Helpers

- Goal: Encapsulate `tryMove`, `moveToTarget`, `moveAwayFromTarget`, `moveRandomly`, `fightEnemy`, `cooperateWithEnemy`.
- Why: Reduce global helpers; make testing easier; avoid duplication.
- Changes:
  - Either: Add methods on `Cell` (e.g., `moveTowards`, `moveAway`, `randomMove`, `fight(target)`, `cooperate(target)`).
  - Or: Create `movement.js` and `interaction.js` modules with pure helpers.
  - Ensure wrap-around rules and distance calc share one implementation.
- Affects: `index.html`.
- Acceptance: No behavior change; helpers removed from global scope; calls updated accordingly.

---

Notes

- Keep changes incremental; validate with `npm run lint` and manual smoke test.
- Avoid widening scope beyond cohesion/coupling and de-dup for this pass.
