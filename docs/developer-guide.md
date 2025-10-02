# Developer Guide

This guide captures the everyday practices for maintaining Colourful Life. It
complements the [architecture overview](architecture-overview.md) by focusing on
workflow, tooling, and documentation expectations. Treat it as the handbook for
day-to-day contributions—whether you are building new simulation features,
extending tests, or polishing docs.

## Environment setup

1. Install Node.js 18 or newer.
2. Clone the repository and install dependencies with `npm ci`.
3. Run `npm run start` to launch the Parcel development server at
   `http://localhost:1234`.
4. If Parcel ever becomes stuck, run `npm run clean:parcel` to remove `dist/`
   and `.parcel-cache/` before restarting the dev server.

> The in-app "Pause When Hidden" toggle now starts disabled so long-running
> simulations can keep evolving without babysitting the browser tab. Re-enable
> it from the playback controls if you prefer the previous focus-dependent
> behaviour.

> Tip: The Parcel server performs hot module replacement. If you need a clean
> build, use `npm run build` to emit a production bundle in `dist/`.

## Coding standards

- Follow the existing module structure. Simulation logic belongs in `src/`,
  documentation in `docs/`, tests in `test/`, and profiling scripts in
  `scripts/`.
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
  `accumulateEventModifiers` instead of `applyEvents`.

## Tooling

| Purpose     | Command(s)                                | Notes                                                                                                                                                                   |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format      | `npm run format` / `npm run format:check` | Apply or verify Prettier formatting across source, documentation, and configuration files.                                                                              |
| Lint        | `npm run lint` / `npm run lint:fix`       | Run ESLint with the project ruleset. Use `:fix` to apply safe autofixes after addressing root issues.                                                                   |
| Tests       | `npm test`                                | Run the Node.js test suites. Focused suites live beside their target modules in `test/`.                                                                                |
| Profiling   | `node scripts/profile-energy.mjs`         | Benchmark the energy preparation loop. Configure dimensions with `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, `PERF_ITERATIONS`, and stub `cellSize` with `PERF_CELL_SIZE`. |
| Cache reset | `npm run clean:parcel`                    | Delete `dist/` and `.parcel-cache/` when Parcel hot reloads or builds become inconsistent.                                                                              |

Always run the formatter and linter before committing. Execute `npm test` when
changing simulation logic, utilities, UI behaviour, or configuration that can
affect runtime outcomes.

## Configuration overrides

- `COLOURFUL_LIFE_MAX_TILE_ENERGY` adjusts the per-tile energy ceiling. Set it
  before running tests or headless scripts to explore higher or lower caps
  without modifying `src/config.js`.
- `COLOURFUL_LIFE_REGEN_DENSITY_PENALTY` tunes how strongly local population
  density suppresses regeneration (0 disables the penalty, 1 preserves the
  default).
- `COLOURFUL_LIFE_CONSUMPTION_DENSITY_PENALTY` controls how much additional
  energy cost organisms pay when harvesting from crowded tiles (0 removes the
  tax, 1 matches the baseline density pressure).
- `COLOURFUL_LIFE_TRAIT_ACTIVATION_THRESHOLD` shifts the normalized cutoff the
  stats system uses when counting organisms as "active" for a trait. Lower
  values loosen the requirement so charts show broader participation, while
  higher values focus on strongly expressed behaviours.
- Non-finite or out-of-range values are ignored and fall back to the defaults
  resolved in [`src/config.js`](../src/config.js). The energy overlays pull the
  sanitized values so UI telemetry reflects the active configuration.

## Documentation conventions

- Keep the README and architecture documents aligned with the current module
  layout. Update them when adding or removing systems.
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
  [`src/utils.js`](../src/utils.js) to keep outcomes reproducible.

## Helpful scripts

- `npm run clean:parcel` — Clear Parcel caches when dev servers behave
  strangely.
- `node scripts/profile-energy.mjs` — Profile the energy preparation loop with
  configurable grid sizes.
- `node scripts/clean-parcel.js` — Underpins the `clean:parcel` npm script and
  can be run directly if you need to customise arguments in a local script.

## Support

If you are blocked or discover ambiguous behaviour, document the uncertainty in
your PR description. Reviewers can then help resolve the gap while preserving a
clear historical record.
