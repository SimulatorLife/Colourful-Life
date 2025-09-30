# Developer Guide

This guide captures the everyday practices for maintaining Colourful Life. It
complements the [architecture overview](architecture-overview.md) by focusing on
workflow, tooling, and documentation expectations.

## Environment setup

1. Install Node.js 18 or newer.
2. Clone the repository and install dependencies with `npm ci`.
3. Run `npm run start` to launch the Parcel development server at
   `http://localhost:1234`.

> Tip: The Parcel server performs hot module replacement. If you need a clean
> build, use `npm run build` to emit a production bundle in `dist/`.

## Coding standards

- Follow the existing module structure. Simulation logic belongs in `src/`,
  documentation in `docs/`, tests in `test/`, and profiling scripts in
  `scripts/`.
- Prefer pure functions for deterministic systems. Stateful helpers (e.g.
  `Stats`) should surface clear methods for mutation.
- Avoid adding new dependencies unless they are lightweight and Parcel
  compatible. When introducing one, update `package.json` and justify it in the
  PR description.
- Keep functions focused. If a helper exceeds ~80 lines or multiple
  responsibilities, consider splitting it into composable units.
- Use descriptive naming. Reflect the intent of behaviours—e.g. `accumulateEventModifiers`
  instead of `applyEvents`.

## Tooling

| Purpose   | Command                           | Notes                                                                                                                             |
| --------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Format    | `npm run format`                  | Applies Prettier to source and documentation files.                                                                               |
| Lint      | `npm run lint`                    | Runs ESLint with the project ruleset.                                                                                             |
| Tests     | `npm test`                        | Executes UVU suites under an esbuild loader.                                                                                      |
| Profiling | `node scripts/profile-energy.mjs` | Benchmarks the energy preparation loop. Configure dimensions with `PERF_ROWS`, `PERF_COLS`, `PERF_WARMUP`, and `PERF_ITERATIONS`. |

Always run the formatter and linter before committing. Execute `npm test` when
changing simulation logic, utilities, or behaviour-affecting configuration.

## Documentation conventions

- Keep the README and architecture documents aligned with the current module
  layout. Update them when adding or removing systems.
- Prefer short, focused sections. Link to source files (e.g.
  ``[`src/gridManager.js`](../src/gridManager.js)``) when detailing
  behaviour so readers can dive deeper.
- Use JSDoc for exported functions and classes. Include parameter types,
  default values, and noteworthy side effects. Internal helper functions should
  still carry brief comments when behaviour is non-obvious.
- When deprecating behaviour, call it out explicitly in the relevant docs and
  add TODOs that reference follow-up issues where appropriate.
- Inline comments should explain **why** code exists, not rephrase what it
  already does.

## Testing expectations

- Unit tests live under `test/` and use [UVU](https://github.com/lukeed/uvu).
  Create new suites when broad systems are introduced and extend existing ones
  for regressions.
- Simulation changes should document the manual and automated checks performed.
  Include a summary in the PR body and ensure the final commit message captures
  the intent.
- Avoid deleting tests unless the covered behaviour has been removed from the
  product. When refactoring, keep or update the assertions.

## Releasing and change management

- Break work into small, reviewable commits. Each commit should contain focused
  changes plus related documentation updates.
- Reference relevant issues or discussions in commit messages and PR bodies when
  available.
- After merging, validate that the Parcel build still succeeds and that the
  README instructions remain accurate.

## Support

If you are blocked or discover ambiguous behaviour, document the uncertainty in
your PR description. Reviewers can then help resolve the gap while preserving a
clear historical record.
