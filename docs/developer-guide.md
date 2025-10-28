# Developer Guide

This guide captures the everyday practices for maintaining Colourful Life. It
complements the [architecture overview](architecture-overview.md) by focusing on
workflow, tooling, and documentation expectations. Treat it as the handbook for
day-to-day contributions—whether you are building new simulation features,
extending tests, or polishing docs. Start with the
[README quick start](../README.md#quick-start) to clone the project and launch
the dev server, then return here for the deeper workflow.

## Environment setup

1. Install Node.js 25.x (the `.nvmrc` pins to 25.0.0) and run `nvm use` after cloning so your shell matches the expected runtime.
2. Install dependencies with `npm ci` (or `npm install` when you explicitly need a non-clean install), then run `npm run prepare` once so Husky hooks stay active after fresh clones or `.husky/` updates.
3. Launch the Parcel development server via `npm run start` and open `http://localhost:1234`.
4. Keep a second terminal handy for `npm run check` before you commit. The meta-command chains `npm run lint`, `npm run format:check`, and `npm test` so you exercise linting, formatting, the energy benchmark, and the Node.js test suites together. During feature work, lean on focused loops—`npm test -- --watch` for continuous execution, `npm test path/to/file.test.js` to run a single suite—and finish with `npm run check` once the changes stabilise.
5. If Parcel ever becomes stuck, run `npm run clean` to remove `dist/` and `.parcel-cache/` before restarting the dev server. Append `-- --dry-run` when you just want to confirm the cleanup targets without deleting files.

### Quality-of-life tips

- The in-app "Pause When Hidden" toggle starts disabled so long-running
  simulations continue evolving even when the browser tab loses focus. Re-enable
  it from the Simulation Controls panel directly beneath the playback controls
  if you prefer focus-dependent behaviour.
- Adjust the "Dashboard Refresh Interval" slider within the Evolution Insights
  panel's **Refresh Cadence** section to tune how often the leaderboard and
  analytics dashboard request fresh data without digging through individual
  metric panes.
- The Evolution Insights dashboard surfaces a Simulation Clock at the top of
  the metrics feed, reporting both simulated time and the aggregate tick count
  for easy pacing comparisons.
- Parcel performs hot module replacement during development. Use
  `npm run build` when you need a fresh production bundle in `dist/` for manual
  verification or publishing. Refer back to the
  [README quick start](../README.md#quick-start) whenever you onboard a new environment.

## Coding standards

- Follow the existing module structure. Simulation logic belongs in `src/`,
  documentation in `docs/`, tests in `test/`, and profiling scripts in
  `scripts/`.
- Uphold the simulation laws, including energy exclusivity—tiles with residents must never track stored energy, so new behaviour
  should drain or reroute reserves when a cell occupies a coordinate.
- Rely on the root `package.json` for module settings; nested manifests inside
  `src/` or other subdirectories are unnecessary and should be removed when
  discovered.
- Prefer pure functions for deterministic systems. Stateful helpers (e.g.
  `Stats`) should surface clear methods for mutation.
- Avoid adding new dependencies unless they are lightweight and Parcel
  compatible. When introducing one, update `package.json` and justify it in the
  PR description.
- Keep functions focused. If a helper exceeds ~80 lines or multiple
  responsibilities, consider splitting it into composable units.
- Use descriptive naming. Reflect the intent of behaviours—e.g.
  `accumulateEventModifiers` instead of `applyEvents`. When profiling identifies
  energy updates as a hotspot, reuse the helper's `result` buffer (and, when it
  is safe to do so, disable applied-event collection via
  `collectAppliedEvents: false`) to avoid unnecessary allocations inside tight
  simulation loops.

## Tooling

- **Format** — Run `npm run format`, `npm run format:check`, or `npm run format:workflows` to apply Prettier across source, documentation, configuration files, and GitHub workflows.
- **Lint** — Use `npm run lint` / `npm run lint:fix` to enforce the ESLint ruleset and apply safe autofixes.
- **Check** — Use `npm run check` before committing to chain linting, formatting verification, and tests.
- **Tests** — Execute `npm test` to run the energy benchmark in [`scripts/profile-energy.mjs`](../scripts/profile-energy.mjs) before the Node.js test suites. Focused suites live beside their target modules under `test/`, and the runner accepts paths, directories, and flags such as `-- --watch`, `--watch`, `--watchAll`, or `--runTestsByPath` (append them after `--` when calling through npm scripts).
- **Profiling** — Run `npm run benchmark` (alias for `node scripts/profile-energy.mjs`) with `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, `PERF_ITERATIONS`, and `PERF_CELL_SIZE` to benchmark the energy preparation loop. The script also seeds a high-density `SimulationEngine` and reports a `simulationBenchmark` block you can tune via `PERF_SIM_ROWS`, `PERF_SIM_COLS`, `PERF_SIM_WARMUP`, `PERF_SIM_ITERATIONS`, `PERF_SIM_UPS`, `PERF_SIM_CELL_SIZE`, `PERF_SIM_DENSITY`, and `PERF_SIM_SEED` to reproduce CI runs or stress-test new optimizations. For subsystem-specific profiling, `node scripts/profile-density-cache.mjs` measures the cached density grid lookups in `GridManager`, and `node scripts/profile-trait-aggregation.mjs` reports average timings for the stats trait aggregation pipeline so telemetry changes stay lightweight.
- **Cache reset** — Use `npm run clean` to clear `dist/` and `.parcel-cache/` when Parcel hot reloads become inconsistent.
- **Hooks** — Run `npm run prepare` to reinstall Husky hooks after cloning or whenever `.husky/` contents change.

Always run the formatter and linter before committing. Execute `npm test` when
changing simulation logic, utilities, UI behaviour, or configuration that can
affect runtime outcomes, and finish with `npm run check` to ensure nothing was
missed.

### Performance budgets

- `npm test` exercises `test/performance.profile-energy.test.js`, which parses
  `scripts/profile-energy.mjs` output. The suite fails if energy preparation
  exceeds roughly **5 ms per tick** or if the seeded `SimulationEngine`
  surpasses **140 ms per tick** under the standard CI configuration
  (24×24 grid, 70 % density). When a regression trips the threshold, re-run the
  script locally with the same environment variables to compare `msPerTick`
  values, dig into the `simulationBenchmark` payload, and capture before/after
  numbers for the pull request discussion.
- A worst-case stress pass that fills a 96×96 grid to 98 % occupancy
  (`PERF_ROWS=96 PERF_COLS=96 PERF_SIM_DENSITY=0.98 PERF_INCLUDE_SIM=1`)
  currently reports ~**0.66 ms** per energy tick and ~**945 ms** per simulated
  frame (20 tick sample). Use the JSON payload emitted by
  `scripts/profile-energy.mjs` as the source of truth when comparing future
  pooling or streaming experiments.

## Configuration overrides

`src/config.js` centralises the environment knobs surfaced to players and
automation. Set them before launching the dev server or headless scripts to
change behaviour without touching source:

**Energy and density**

- `COLOURFUL_LIFE_MAX_TILE_ENERGY` adjusts the per-tile energy ceiling. Use it to
  explore more generous or harsher energy caps in both browser and headless
  runs.
- `COLOURFUL_LIFE_ENERGY_REGEN_RATE` overrides the baseline regeneration rate
  applied to each tile before density penalties and events apply.
- `COLOURFUL_LIFE_ENERGY_DIFFUSION_RATE` controls how much energy diffuses to
  neighbouring tiles every tick (values are clamped to the 0–1 range).
- `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` tunes how strongly crowding suppresses
  regeneration (0 disables the penalty, 1 preserves the default `0.39`
  coefficient).
- `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` controls the harvesting tax
  organisms pay on packed tiles so you can reward cooperation or sharpen
  competition.

**Lifecycle and territory**

- `COLOURFUL_LIFE_DECAY_RETURN_FRACTION` determines how much energy corpses
  return to nearby tiles as they decompose.
- `COLOURFUL_LIFE_DECAY_IMMEDIATE_SHARE` sets the fraction of that recycled
  energy that splashes into neighbouring tiles on the same tick instead of
  smouldering in the decay reservoir.
- `COLOURFUL_LIFE_DECAY_RELEASE_BASE` establishes the minimum amount of energy a
  decay reservoir releases whenever it yields resources back to the grid.
- `COLOURFUL_LIFE_DECAY_RELEASE_RATE` scales how aggressively decay reservoirs
  release stored energy each tick.
- `COLOURFUL_LIFE_DECAY_MAX_AGE` caps how long the decay reservoir persists
  before fully dissipating.
- `COLOURFUL_LIFE_COMBAT_TERRITORY_EDGE_FACTOR` tempers or emphasises territorial
  advantage in combat. Values outside 0–1 are clamped back to the default.

**Telemetry and dashboards**

- `config.leaderboardSize` (or
  `resolveSimulationDefaults({ leaderboardSize })`) controls how many organisms
  the telemetry stream surfaces to the Evolution Insights leaderboard. Values
  below zero clamp to zero so headless runs can disable the leaderboard entirely
  without rewriting the engine wiring.

**Neural activity and evolution**

- `COLOURFUL_LIFE_ACTIVITY_BASE_RATE` globally adjusts the baseline neural
  activity genomes inherit before DNA modifiers apply.
- `COLOURFUL_LIFE_MUTATION_CHANCE` raises or lowers the default mutation
  probability applied when genomes reproduce without an explicit DNA override.
- `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` shifts the normalized cutoff the
  stats system uses when counting organisms as "active" for a trait.
- `COLOURFUL_LIFE_OFFSPRING_VIABILITY_BUFFER` scales how much surplus energy
  parents must stockpile beyond the strictest genome's demand before gestation
  begins.

Non-finite or out-of-range values are ignored and fall back to the defaults
resolved in [`src/config.js`](../src/config.js). Overlays pull the sanitised
values so UI telemetry reflects whichever configuration is active. The README's
[configuration overview](../README.md#configuration-overrides) lists the same
variables for quick reference during onboarding.

## UI layout options

- `ui.layout.deathBreakdownMaxEntries` controls how many individual death causes
  the life event dashboard lists before folding the remainder into an "Other"
  bucket. Non-positive or non-numeric values fall back to the default of 4.
- `ui.layout.deathCauseColors` overrides the life event dashboard palette. Keys
  map to death cause identifiers (case-insensitive) and values accept any CSS
  color string. Unrecognized or empty values fall back to the default theme.

## Documentation conventions

- Keep the README and architecture documents aligned with the current module
  layout. Update them when adding or removing systems.
- Refresh the README's headless usage section and architecture notes when
  `createSimulation`, environment adapters, or UI mounting behaviour change so
  embedding guidance stays accurate.
- Prefer short, focused sections. Link to source files (e.g.
  ``[`src/grid/gridManager.js`](../src/grid/gridManager.js)``) when detailing
  behaviour so readers can dive deeper.
- Use JSDoc for exported functions and classes. Include parameter types,
  default values, return shapes, and noteworthy side effects. Internal helper
  functions should still carry brief comments when behaviour is non-obvious.
- When adding a new module or exported helper, mirror the existing JSDoc style
  and ensure every export (function, class, constant map) carries a concise
  description so contributors can consume it without scanning implementation
  details.
- Overlay utilities in [`src/ui/overlays.js`](../src/ui/overlays.js) describe
  their canvas options via JSDoc; follow the same pattern when extending the
  overlay pipeline so rendering hooks remain self-documenting.
- Periodically audit for missing docstrings by searching for `export function`
  / `export default` declarations. Add coverage before shipping changes so the
  codebase remains self-explanatory.
- When deprecating behaviour, call it out explicitly in the relevant docs and
  add TODOs that reference follow-up issues where appropriate.
- Inline comments should explain **why** code exists, not rephrase what it
  already does.
- Keep [`CHANGELOG.md`](../CHANGELOG.md) updated whenever behaviour changes,
  tooling is added, or migration steps are required.

## Testing expectations

- Unit tests live under `test/` and run with the built-in
  [Node.js test runner](https://nodejs.org/api/test.html). Create new suites
  when broad systems are introduced and extend existing ones for regressions.
- Simulation changes should document the manual and automated checks performed.
  Include a summary in the PR body and ensure the final commit message captures
  the intent.
- Avoid deleting tests unless the covered behaviour has been removed from the
  product. When refactoring, keep or update the assertions.
- Prefer deterministic randomness in tests using `createRNG` from
  [`src/utils/math.js`](../src/utils/math.js) to keep outcomes reproducible.

## Helpful scripts

- `npm run clean` — Clear Parcel caches when dev servers behave strangely.
- `npm run benchmark` — Profile the energy preparation loop with configurable
  grid sizes and SimulationEngine samples; combine with `PERF_*` variables to
  reproduce CI runs.
- `node scripts/profile-density-cache.mjs` — Sample cached density lookups across
  tens of thousands of grid queries to validate the density grid optimisation.
- `node scripts/profile-trait-aggregation.mjs` — Benchmark the Stats trait
  aggregation helpers so dashboard updates remain lightweight after changes.
- `npm run deploy:public` — Publish the latest production build to a public
  repository. See [`docs/public-hosting.md`](public-hosting.md) for setup
  details.

## Support

If you are blocked or discover ambiguous behaviour, document the uncertainty in
your PR description. Reviewers can then help resolve the gap while preserving a
clear historical record.
