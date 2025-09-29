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
- **Neuron-inspired movement**: gene weights influence direction choices, giving each organism a rudimentary nervous system. A DNA-tuned resource trend sensor now feeds each brain short-term signals about local tile regeneration versus drain so policies can adapt to boom-and-bust cycles.
- **Neural sensory modulation**: genomes seed baseline gains and homeostasis targets for every brain sensor, and neural tissue adapts those gains in real time. As organisms experience allies, threats, or resource swings, their sensory priorities shift organically instead of following hard-coded weights.
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
This third line verifies the Codex auto-merge path again.
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
- **Frame-by-frame inspection**: Pause the simulation and click the **Step** control to advance a single tick when you want to study how interventions ripple through the ecosystem.
- **Auto-respawn safety net**: The **General Settings** panel now includes an _Auto-Respawn Collapse_ toggle and floor slider. Keep it on to automatically reseed the world when populations crash, or dial the floor to zero to disable the safety net for ironman runs.

## Agentic Prompts

1. Review dependencies, build scripts, and configurations. Remove unused or outdated libraries, upgrade to stable versions, and replace deprecated APIs with supported alternatives. Simplify build steps and eliminate fragile scripts. The goal is a lean, healthy dependency graph and a robust, maintainable build process. If there are no dependencies to update, skip this step.

2. Audit the codebase for missing or unclear documentation. Ensure every public function, module, and complex piece of logic has concise, accurate docstrings or comments. Update outdated docs, improve clarity, and align formatting with the project’s style. Expand README, changelogs, and developer guides so new contributors can onboard quickly and understand project structure, usage, and conventions. The goal is to make the codebase well-documented, self-explanatory, and accessible.

3. Docs Refresh Action
   Review the project documentation and inline comments for accuracy and clarity. Update the README, architecture notes, or code-level docstrings where they are outdated or missing, ensuring contributors can quickly understand current features, modules, and usage. Keep the documentation practical and concise, reflecting reality without speculative details, and avoid unnecessary rewrites — focus only on making docs consistent with the current codebase.

4. DNA Encoding Improvements
   Examine how DNA is represented and used in the simulation, and improve it by expanding its ability to encode meaningful organism traits and behaviors. Replace ad-hoc or hardcoded logic with DNA-driven values where possible, keeping the system extensible, realistic, and evolvable without adding unnecessary complexity. The goal is to deliver a richer, more expressive encoding that drives diversity and emergent outcomes.

5. Neural System Expansion
   Review the neural/brain system and identify one behavior currently controlled by rigid conditions that could instead be neuron-driven. Refactor that case to use neural activation in a clean, maintainable way, keeping the change scoped but impactful. The aim is to make organism behavior more flexible, dynamic, and emergent by strengthening the role of the neural system.

6. Emergent Systems Pass
   Find one hardcoded, rule-based behavior in the simulation and reframe it into an emergent system that arises naturally from organism traits, DNA, or environmental interaction. Implement the shift in a focused way, preserving readability while reducing rigid control logic. The goal is to move toward more realistic, dynamic behavior that is not dictated by explicit rules but instead emerges from the simulation systems.

7. Parameter Flexibility
   Search the codebase for hardcoded constants or “magic numbers” that drive organism or environment behavior, and refactor one of them into a configurable parameter (preferably controlled by DNA or environment variables). Ensure the parameter integrates cleanly with existing systems and avoids unnecessary abstraction. The objective is to reduce rigid values and increase flexibility, making the simulation more tunable and adaptive.

8. Dead Code & Asset Audit
   Scan the repository for unused functions, variables, files, assets, or configuration entries. Remove or archive one meaningful set of unused items, consolidating duplicates if needed. Keep the change tight and non-disruptive, verifying that no active features depend on what’s removed. The goal is to reduce bloat, simplify the codebase, and ensure every component has a clear purpose.

9. Error Handling Consistency
   Review the codebase and identify one area where error handling is inconsistent, ad-hoc, or missing. Refactor that area to align with a consistent project-wide pattern (e.g., standardized logging, safe fallbacks, or structured error reporting). The aim is to make errors easier to diagnose and handle, without introducing unnecessary abstraction or complexity.

10. Evolutionary Pressure Tuning
    Assess the evolutionary fitness or survival logic and identify one opportunity to refine how selection pressures shape organisms. Adjust the system to better encourage diverse, realistic, and adaptive strategies without breaking existing features. Keep the change focused, measurable, and well-integrated so that it strengthens natural selection dynamics without overhauling the entire evolution model.

11. Review all open PRs against master with a focus on preserving architecture and tests. For each PR, check alignment with current design principles, coding standards, and regression coverage. If it is solid, non-duplicative, and compatible, merge it cleanly. If it is outdated, incompatible, or destructive (such as deleting core systems or reducing tests) but the underlying feature is valuable, extract the intent and re-implement it as a fresh, minimal change on top of the latest master, then close the original PR. If it detracts value or introduces duplication with no salvageable intent, close it outright. Try to target no net loss of coverage, no architectural regressions, and no unnecessary abstraction. The goal is to keep master clean, consistent, and high-quality while still salvaging worthwhile ideas.

Resolve local merge conflicts strategically, preserving current master architecture and test integrity while keeping the incoming branch’s intent. Before editing files, read the conflict set holistically (code + tests + docs + config), scan commit history/blame for each hunk, and restate the intended behavior. For each conflict: prefer the up-to-date APIs, module boundaries, and style from master; keep or adapt the feature logic only where it adds clear value; never delete core systems or reduce test coverage to ‘make it merge’. Consolidate duplicates, avoid reintroducing deprecated code, and refactor minimally to keep changes small and DRY. Special cases: in configs/CI/build scripts prefer master unless the feature explicitly requires changes; for package.json/lockfiles or dependency manifests, take master, then re-apply needed deps and regenerate the lock cleanly; for migrations, ensure forward-only, idempotent paths. After each file group, run formatters/linters/tests, and fix failures at the source (not by weakening tests). Commit in logical slices with clear messages, add or update tests where behavior differs, and document any non-obvious decisions inline. Goal: a clean, minimal, behavior-correct merge with green tests and no architectural regressions. You can view the current open PRs with:

```
export GITHUB_TOKEN=your_token_here
echo $GITHUB_TOKEN | gh auth login --with-token
gh pr list --state open --limit 50
```
