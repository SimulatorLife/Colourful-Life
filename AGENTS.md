# Agent Guide

This document captures the guardrails and shared context for any automation or AI agent contributing to Colourful Life.

## Mission & Product Vision

- Reinforce curiosity, empathy, and playful experimentation in the cellular ecosystem simulation.
- Support emergent complexity, evolutionary principles, resource-feedback loops, and adaptive strategies without compromising approachability.
- Preserve the modular architecture separating simulation logic, rendering, and UI controls so the project remains extensible and headless-friendly.

## Hard Rules

- **Don't modify files inside `.github/` unless explicitly asked to** Treat workflow definitions, agent prompts, and CI config as read-only.
- Ignore `node_modules/`, lockfiles caches, and other generated artifacts when scanning, searching, or linting. Focus on checked-in source (`src/`, `ui/`, `test/`, `demo/`, etc.). Ignore build outputs in `dist/` and `build/`. Ignore hidden files and folders unless explicitly relevant. Ignore file `codex-setup-env-script.sh`.
- Do not delete or downgrade existing tests. Add coverage when behavior changes or risk increases.
- Keep the working tree clean. Stage only relevant files and ensure commits represent minimal, logical changes.

## Quality & Engineering Standards

- Adhere to the existing architecture and naming conventions in `src/` and `ui/`. Refactor only when it improves clarity, removes duplication, or fixes defects.
- Maintain deterministic behavior for core simulation pieces: grid updates, energy flow, event handling, and UI bindings.
- Before introducing new dependencies, confirm they are necessary, lightweight, and compatible with Parcel and Node 18+.
- Document non-obvious behavior with concise comments or README updates. Avoid noisy or redundant commentary.

## Code Style & Tooling

- Run Prettier (`npm run format`) before committing; verify with `npm run format:check` when needed.
- Use ESLint via `npm run lint` (or `npm run lint:fix`). Resolve issues at the source rather than suppressing rules.
- Prefer modern ES modules, literal imports, and descriptive variable/function names. Keep functions focused and pure where practical.
- Be mindful of Canvas rendering performance: avoid per-frame allocations inside tight loops and reuse buffers/objects.

## Testing Expectations

- Execute `npm test` after logic changes touching simulation behavior, utilities, or shared helpers.
- Extend UVU test suites in `test/` when new functionality or bug fixes introduce edge cases.
- For UI changes, add lightweight integration checks or storybook-style demos when possible.

## Collaboration Workflow

- Base new work on the latest `master`. Rebase frequently to minimize merge friction.
- Write informative commit messages and PR descriptions explaining intent, context, and validation steps.
- Cross-reference related issues/PRs within commit or PR descriptions when applicable.
- If blocked or uncertain, document open questions in the PR body so reviewers can assist promptly.

## Safeguards & Operational Notes

- Treat configuration files (`config.toml`, `package.json`, `package-lock.json`) with caution. Update only when intentional and validated.
- When editing long-form docs like `README.md`, keep the tone consistent and update relevant sections together.
- For performance-sensitive code in `gridManager.js` or rendering loops, measure impacts when feasible before merging.
- Maintain accessibility and usability when adjusting UI components: preserve keyboard navigation, color contrast, and responsive layouts.

Following these practices keeps the simulation delightful, maintainable, and ready for iterative experimentation.