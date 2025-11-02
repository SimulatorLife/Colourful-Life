# Architectural Audit — 5 June 2024

## Design rationale

- **Pain points.** The simulation runtime is split between `src/simulationEngine.js` and the `src/engine/` helpers. The primary event loop lives at the project root while its dependencies (`environment`, `telemetry`, runtime services) are nested, making the "engine" concept fragmented and harder to navigate during onboarding.
- **Target architecture.** Treat the engine as a cohesive package rooted at `src/engine/`, with the main loop, runtime services, and environment utilities living side-by-side. Public entry points should remain unchanged for external embedders by using lightweight re-exports.

## Repository survey highlights

- The remainder of the codebase already groups UI, grid, stats, and events by domain, but the engine remained the notable outlier.
- Tests and headless tooling reach for the engine via deep relative paths, so keeping stable public surfaces is critical while reshaping internals.

## Focused refactor executed

| Before                                               | After                                                                                                                | Impact                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/simulationEngine.js` at the repo root           | `src/engine/simulationEngine.js` colocated with other runtime helpers                                                | Clarifies that the simulation loop is part of the engine subsystem. |
| Call sites importing `./simulationEngine.js`         | Internal modules now import `./engine/simulationEngine.js` while `src/simulationEngine.js` re-exports the public API | Preserves existing entry points for consumers and tests.            |
| Documentation referencing the root-level engine file | Updated docs point to the new engine layout                                                                          | Keeps contributor guidance accurate.                                |

## Migration and fallback plan

- `src/simulationEngine.js` now acts as a compatibility shim that re-exports the relocated implementation, ensuring external imports continue to succeed.
- Future refactors can gradually move additional engine utilities into subfolders (e.g. `engine/runtime/`) without breaking consumers, following the same shim pattern when necessary.

## Follow-up opportunities

- Evaluate whether telemetry and stats adapters should also expose aggregating `index.js` modules to reduce long relative imports.
- Consider documenting the engine public API surface in TypeScript declaration files to make the migration path explicit for downstream integrations.
