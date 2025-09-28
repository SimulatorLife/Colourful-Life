# Colourful Life

This repository is a JavaScript playground simulation, inspired by cellular automata.

## Project Vision

To guide ongoing development, the simulation is anchored around four interlocking pillars that describe the desired experience, learning takeaways, interaction model, and structural organization.

### Desired Emotional Experience

- **Curiosity and wonder**: Each run should entice viewers to linger, notice emergent patterns, and feel a sense of discovery as behaviours unfold organically.
- **Empathy for digital life**: Subtle cues—colour shifts, energy trails, population booms and busts—should encourage players to care about the organisms' survival journeys.
- **Agency without overwhelm**: Controls ought to feel empowering yet approachable, reinforcing that small nudges can spark dramatic ecological shifts without demanding expert-level micromanagement.

### Learning Goals

- **Emergent complexity**: Highlight how simple local rules produce unexpected ecosystem-level dynamics, echoing principles from cellular automata and evolutionary biology.
- **Resource-feedback loops**: Demonstrate how energy flow, environmental events, and population density intertwine to create cascading consequences.
- **Adaptive strategies**: Showcase genetic variation, mutation, and behaviour weights so users internalize how diversity supports resilience.

### Interaction Principles

- **Tactile experimentation**: Provide intuitive sliders, toggles, and stamping tools that invite quick iteration and playful tinkering.
- **Transparent feedback**: Mirror every user action with visible responses (e.g., overlays updating in real time, organisms reacting promptly) to reinforce cause and effect.
- **Meaningful influence**: Allow interventions at multiple scales—individual cells, regional terrain, global climate—so users can role-play as caretaker, disruptor, or scientist.

### Structural & Organizational Tenets

- **Modular architecture**: Keep simulation logic, rendering, UI layers, and data models decoupled to support headless runs and future extensions.
- **Curated terrain content**: Organize obstacle presets and maps as reusable modules that can be mixed and extended over time.
- **Progressive disclosure**: Structure panels and documentation so beginners see essential controls first, while advanced tools (genetic inspectors, debug overlays) remain close at hand for deeper dives.
- **Simplicity as a feature**: Prefer lean modules with clear responsibilities over sprawling managers. Before adding a new system, seek opportunities to refactor, reuse existing behaviours, or generalize small utilities so the codebase stays approachable.
- **Quality-first iteration**: Reserve time each cycle to tighten tests, remove duplication, and resolve edge-case bugs. Shiny additions wait until the current experience feels polished, stable, and well-documented.

## Key Concepts

- **Grid-based cells**: simulations use a 2D array to track cells/particles and update them each frame.
- **Genes and mutation**: advanced versions assign each cell genetic traits that deterministically recombine, blend, and mutate
  during reproduction.
  - Each genome also encodes a similarity preference band (kin-loving to novelty-seeking) and tolerance width, so populations can drift toward inbreeding or outbreeding strategies as conditions change.
- **Neuron-inspired movement**: gene weights influence direction choices, giving each organism a rudimentary nervous system.
- **Energy and evolution**: organisms gather energy from tiles, spend it to move and reproduce, and perish when depleted.
  - Death leaves residue: when a cell dies (age, starvation, or combat), a fraction of its remaining energy is deposited back into the tile as nutrients. Environmental events modulate how much residue persists.
  - Events shape resources: floods boost tile regeneration; droughts and heatwaves suppress it and add per-tile drain; coldwaves slow cycling and preserve residues. Reproduction probability scales with local tile energy and current event pressure.
  - Sunlight coupling: a day–night cycle injects external energy. Occupied tiles route a portion directly to the occupant (photosynthesis weighted by the green gene), with the rest entering the environment. High local density and occupied tiles reduce soil regeneration (competition/shading).
- **Density-aware behavior**: local population density increases aggression, reduces reproduction probability, nudges movement toward caution, and slightly raises energy costs.
- **Environmental events**: floods, droughts, heatwaves, and coldwaves affect regions and influence cell survival.
- **Rendering loop**: `requestAnimationFrame` drives updates and drawing to an HTML `<canvas>`.
- **Obstacles & terrain**: apply obstacle presets to recreate wall drops or chokepoints while the movement AI respects blocked tiles and optional wall-pressure energy penalties.

## Development

The project uses [Parcel](https://parceljs.org/) for local development:

```bash
npm ci
npm run start    # Parcel dev server
npm run build    # Production build
npm run serve    # Simple static server (no bundling)
npm run format   # Format code with Prettier

This line tests the Codex auto-merge workflow.
This follow-up line checks a second Codex auto-merge run.
npm run format:check  # Check formatting without writing
```

Important: Do not open `index.html` directly via `file://`. ES module imports are blocked by browsers for `file://` origins. Always use an `http://` URL (e.g., Parcel dev server or `npm run serve`).

## Project Structure

- `src/` — Core simulation logic, including the grid engine, configuration defaults, and headless utilities such as `createSimulation`.
- `ui/` — Modular UI components and styles that wire controls, overlays, and inspector panels to the simulation state.
- `demo/` — Terrain preset walkthroughs such as [`demo/obstacle-presets.md`](demo/obstacle-presets.md) for stress-testing behaviours.
- `test/` — UVU-based unit and regression suites covering grid utilities, behaviour modules, and factory wiring.
- `fallingSand/` — Legacy sandbox experiments that inspired the current ecosystem rules and rendering.
- `styles.css`, `index.html` — Entry-point assets for Parcel, defining the base layout and bootstrapping the browser experience.

### Formatting

This repo uses [Prettier](https://prettier.io/) for consistent formatting. Run `npm run format` before committing, or add it to your editor's "format on save" using the Prettier extension.

### Modular & headless usage

The browser entry point now imports a `createSimulation` factory from `src/main.js`. The factory accepts a canvas element and optional configuration, returning handles for the grid, UI manager, and lifecycle controls. This keeps the simulation logic reusable in Node-based tooling, unit tests, or custom launchers.

For headless scripts, pass `headless: true` (to skip DOM UI wiring) and inject timing hooks if the default `requestAnimationFrame` shim is not desired:

```js
import { createSimulation } from './src/main.js';

const canvas = new OffscreenCanvas(300, 300);
const simulation = createSimulation({
  canvas,
  headless: true,
  autoStart: false,
  requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 16),
  cancelAnimationFrame: (id) => clearTimeout(id),
});

// Advance a single simulation tick.
simulation.step();
```

### Configuration defaults

Energy-related defaults for the simulation are centralized in `src/config.js`. The UI sliders read `ENERGY_REGEN_RATE_DEFAULT` and `ENERGY_DIFFUSION_RATE_DEFAULT` from this shared module so that the controls always reflect the same baseline values used by the grid manager.

### Obstacles

- The **Obstacles** panel in the sidebar lets you stamp obstacle layouts and adjust the **Wall Linger Penalty** slider that drains energy from organisms repeatedly pushing against barriers.
- Toggle **Show Obstacles** in the overlay section to blend the mask into the main canvas or pair it with the density/energy heatmaps.
- Full walkthroughs—including console snippets for custom presets—live in [`demo/obstacle-presets.md`](demo/obstacle-presets.md).

## Testing & Quality

- `npm test` — Runs the [UVU](https://github.com/lukeed/uvu) suites in `test/` via the esbuild loader.
- `npm run lint` / `npm run lint:fix` — Lints JavaScript and HTML sources with ESLint (optionally auto-fixing).
- `npm run format:check` — Verifies Prettier formatting without writing changes; pair with `npm run format` before commits.
- Husky + lint-staged — Automatically format and lint staged files on commit to keep diffs clean.

## Onboarding Tips

- **Recommended Node version**: Node.js 18 LTS (or newer) matches the tooling expectations in `package.json` and Parcel 2 support.
- **Headless simulation**: Use `headless: true` with `createSimulation` (see example above) to run deterministic smoke tests or scripted experiments without the DOM.
- **Obstacle exploration**: Start with [`demo/obstacle-presets.md`](demo/obstacle-presets.md) to learn how obstacle layouts and wall penalties shape emergent behaviour.
- **Dev server shortcuts**: `npm run start` launches Parcel with hot module reloading; `npm run serve` spins up the lightweight Node server for static demos.

## Agentic Prompts

- Discard outdated or incompatible code from the current feature branch and re-implement the intended feature on top of the up-to-date master. Refactor and adapt as needed to align with current architecture and coding standards. Ensure the resulting branch is clean, conflict-free, and ready to merge as a pull request into master.

- Review the entire codebase with the goal of raising overall quality and maintainability. Identify duplicate, near-duplicate, or overly verbose code that can be consolidated, and refactor it to improve clarity and consistency. Break down monolithic functions into smaller, more focused units and ensure the code is DRY, clean, and easy to understand. Avoid unnecessary abstraction—do not introduce classes or functions that add complexity without real benefit—but re-implement outdated or incompatible code in a modern, clean way aligned with the current architecture. The objective is to deliver a streamlined, high-quality, and consistent codebase that is maintainable, readable, and free of redundant logic.

- Audit the codebase for test coverage, reliability, and resilience. Identify critical paths, edge cases, and modules with insufficient or missing tests. Add or expand automated tests to ensure both expected and edge-case behavior are validated. Modernize existing tests for readability, speed, and maintainability, and eliminate redundant or flaky tests. Where logic is complex or risky, write focused unit tests; where integration is essential, add end-to-end coverage. The goal is to ensure the codebase is robust, with a strong safety net that prevents regressions and increases confidence in future changes.

- Profile and analyze the codebase for performance bottlenecks. Identify inefficient algorithms, unnecessary computations, excessive memory usage, or redundant database and API calls. Refactor or optimize hot paths to improve execution speed and resource efficiency while preserving readability and maintainability. Where possible, replace heavy operations with lighter alternatives, cache repeated work, and streamline data structures. Ensure changes are validated with benchmarks or profiling results to confirm measurable performance gains without introducing regressions. The goal is to deliver a faster, more efficient codebase that scales well under load.

- Review dependencies, build scripts, and configurations. Remove unused or outdated libraries, upgrade to stable versions, and replace deprecated APIs with supported alternatives. Simplify build steps and eliminate fragile scripts. Ensure CI/CD pipelines run reliably and quickly. The goal is a lean, healthy dependency graph and a robust, maintainable build process.

- Enforce consistent coding style and standards across the codebase. Normalize formatting, naming conventions, and file organization. Replace ad-hoc patterns with consistent project-wide practices (e.g., error handling, logging, configuration loading). Ensure linter and formatter rules are applied and eliminate style drift. The goal is to make the codebase uniform, predictable, and easy to read for any contributor.

- Audit the codebase for missing or unclear documentation. Ensure every public function, module, and complex piece of logic has concise, accurate docstrings or comments. Update outdated docs, improve clarity, and align formatting with the project’s style. Expand README, changelogs, and developer guides so new contributors can onboard quickly and understand project structure, usage, and conventions. The goal is to make the codebase well-documented, self-explanatory, and accessible.

- Assess the architecture for overly coupled modules. Identify opportunities to separate concerns, reduce circular dependencies, and introduce clearer boundaries. Restructure the codebase into logical, maintainable modules without over-engineering. The goal is a modular design that supports future growth and reduces technical debt.

- Scan the codebase for unused functions, variables, files, assets, and configuration entries. Remove or archive anything that is no longer referenced, consolidating partial duplicates where possible. The goal is to reduce bloat, simplify the repository, and ensure that every line of code serves a purpose.

- Review all open PRs against master with a focus on preserving architecture and tests. For each PR, check alignment with current design principles, coding standards, and regression coverage. If it is solid, non-duplicative, and compatible, merge it cleanly. If it is outdated, incompatible, or destructive (such as deleting core systems or reducing tests) but the underlying feature is valuable, extract the intent and re-implement it as a fresh, minimal change on top of the latest master, then close the original PR. If it detracts value or introduces duplication with no salvageable intent, close it outright. Try to target no net loss of coverage, no architectural regressions, and no unnecessary abstraction. The goal is to keep master clean, consistent, and high-quality while still salvaging worthwhile ideas.

Resolve local merge conflicts strategically, preserving current master architecture and test integrity while keeping the incoming branch’s intent. Before editing files, read the conflict set holistically (code + tests + docs + config), scan commit history/blame for each hunk, and restate the intended behavior. For each conflict: prefer the up-to-date APIs, module boundaries, and style from master; keep or adapt the feature logic only where it adds clear value; never delete core systems or reduce test coverage to ‘make it merge’. Consolidate duplicates, avoid reintroducing deprecated code, and refactor minimally to keep changes small and DRY. Special cases: in configs/CI/build scripts prefer master unless the feature explicitly requires changes; for package.json/lockfiles or dependency manifests, take master, then re-apply needed deps and regenerate the lock cleanly; for migrations, ensure forward-only, idempotent paths. After each file group, run formatters/linters/tests, and fix failures at the source (not by weakening tests). Commit in logical slices with clear messages, add or update tests where behavior differs, and document any non-obvious decisions inline. Goal: a clean, minimal, behavior-correct merge with green tests and no architectural regressions. You can view the current open PRs with:

```
export GITHUB_TOKEN=your_token_here
echo $GITHUB_TOKEN | gh auth login --with-token
gh pr list --state open --limit 50
```
