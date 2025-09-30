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

| Purpose     | Command(s)                                | Notes                                                                                                                            |
| ----------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Format      | `npm run format` / `npm run format:check` | Apply or verify Prettier formatting across source, documentation, and configuration files.                                       |
| Lint        | `npm run lint` / `npm run lint:fix`       | Run ESLint with the project ruleset. Use `:fix` to apply safe autofixes after addressing root issues.                            |
| Tests       | `npm test`                                | Execute UVU suites under an esbuild loader. Focused suites live beside their target modules in `test/`.                          |
| Profiling   | `node scripts/profile-energy.mjs`         | Benchmark the energy preparation loop. Configure dimensions with `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, and `PERF_ITERATIONS`. |
| Cache reset | `npm run clean:parcel`                    | Delete `dist/` and `.parcel-cache/` when Parcel hot reloads or builds become inconsistent.                                       |

Always run the formatter and linter before committing. Execute `npm test` when
changing simulation logic, utilities, UI behaviour, or configuration that can
affect runtime outcomes.

## Documentation conventions

- Keep the README and architecture documents aligned with the current module
  layout. Update them when adding or removing systems.
- Prefer short, focused sections. Link to source files (e.g.
  ``[`src/grid/gridManager.js`](../src/grid/gridManager.js)``) when detailing
  behaviour so readers can dive deeper.
- Use JSDoc for exported functions and classes. Include parameter types,
  default values, return shapes, and noteworthy side effects. Internal helper
  functions should still carry brief comments when behaviour is non-obvious.
- When deprecating behaviour, call it out explicitly in the relevant docs and
  add TODOs that reference follow-up issues where appropriate.
- Inline comments should explain **why** code exists, not rephrase what it
  already does.
- Keep [`CHANGELOG.md`](../CHANGELOG.md) updated whenever behaviour changes,
  tooling is added, or migration steps are required.

## Testing expectations

- Unit tests live under `test/` and use [UVU](https://github.com/lukeed/uvu).
  Create new suites when broad systems are introduced and extend existing ones
  for regressions.
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
