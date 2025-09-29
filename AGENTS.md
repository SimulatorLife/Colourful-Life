# Agent Guide

This document captures the guardrails and shared context for any automation or AI agent contributing to Colourful Life.

## Mission & Product Vision

- Reinforce curiosity, empathy, and playful experimentation in the cellular ecosystem simulation.
- Support emergent complexity, evolutionary principles, resource-feedback loops, and adaptive strategies without compromising approachability.
- Preserve the modular architecture separating simulation logic, rendering, and UI controls so the project remains extensible and headless-friendly.

## Hard Rules

- **Never modify files inside `.github/`.** Treat workflow definitions, agent prompts, and CI config as read-only.
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

## Auth & Push Troubleshooting (for agents)

When a push fails, **print and run this checklist**. It never prints your token value, only lengths/status codes.

### 1) Quick checklist

✅ `origin` exists and points to the repo  
✅ Git identity is set (`user.name`, `user.email`)  
✅ Token was detected during setup phase (length > 0)  
✅ Repo is reachable with the token (`git ls-remote`)  
✅ App installation has **Contents: Read & Write** on this repo  
✅ No SSO block (`X-GitHub-SSO` header)  
✅ Branch protection isn’t blocking direct pushes  
✅ Use URL push if `origin` is missing

### 2) Diagnostics (safe, no secrets leaked)

```bash
echo "== Git remotes =="
git remote -v || echo "No git remotes."

echo "== Git identity =="
echo "user.name:  $(git config --get user.name || echo '<unset>')"
echo "user.email: $(git config --get user.email || echo '<unset>')"

echo "== Repo reachability =="
git ls-remote https://github.com/SimulatorLife/Colourful-Life.git >/dev/null 2>&1 \
  && echo "OK: repo reachable" \
  || echo "FAIL: repo not reachable (403/404). Check token access, app install, or SSO."
```

3. Pushing safely

If origin isn’t available at the end of the run, push by URL:

```shell
# With the repo cloned and commits staged:
git push "${REPO_HTTPS}" "HEAD:your/branch-name"   # relies on stored/approved creds from setup
# or, if origin exists:
git push origin "HEAD:your/branch-name"
```

If you see:

**fatal: 'origin' does not appear to be a git repository**
→ The remote was removed/never added in this container. Re-add origin (no token needed):
git remote add origin "${REPO_HTTPS}"

**remote: Write access to repository not granted. / HTTP 403**
→ The app token can read but not write. See Common failures below.

**HTTP 404 on API or ls-remote**
→ The token can’t see the repo (not installed on it, wrong owner, or private without access).

### 3) Common failures & fixes (what to print)

**App not installed / not granted to this repo**
Message to print: “The Codex GitHub App is not installed or not granted access to ${REPO_OWNER}/${REPO_NAME}. Please install/Configure the app on this repo with Contents: Read & Write and Pull requests: Read & Write.”

**SSO required (orgs with SSO)**
Symptom: API/ls-remote 403 and response header X-GitHub-SSO: required; …
Message to print: “Org SSO requires authorizing the Codex app. An org admin should open Organization Settings → Installed GitHub Apps → Codex → Configure and complete the SSO authorization.”

**Branch protection**
Symptom: Push denied or PR merge blocked by required checks/reviews.
Message to print: “Branch protection is blocking direct pushes/merge. Commit to the PR branch and let required checks pass, or adjust branch rules / grant the app bypass if appropriate.”

**Token lifetime / scope**
Symptom: 401 or intermittent 403; token length was >0 in setup but later unavailable.
Message to print: “Codex secrets are only available during setup. Ensure all git credential approve and remote URL configuration happen in the setup script. Do not rely on ${GITHUB_TOKEN} after setup.”

**Pushing to wrong owner/URL**
Symptom: 403/404 on pushes but reads work.
Message to print: “Confirm the push URL matches the PR’s repo/owner (forks vs upstream)..”

```shell
# Ensure a remote exists (tokenless URL is fine for naming)
git remote get-url origin >/dev/null 2>&1 || git remote add origin "${REPO_HTTPS}"

# Approve credentials for HTTPS (only if token is available *during setup*)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # Repo-local credential store to avoid polluting global config
  git config --local credential.helper 'store --file .git/codex-cred'
  git -c credential.helper= -c 'credential.helper=store --file .git/codex-cred' credential approve <<EOF
protocol=https
host=github.com
username=x-access-token
password=${GITHUB_TOKEN}
EOF

  # Sanity: confirm we can read the repo via Git HTTPS with the stored helper
  if git -c 'credential.helper=store --file .git/codex-cred' ls-remote "${REPO_HTTPS}" >/dev/null 2>&1; then
    echo "Stored credential works for HTTPS operations."
  else
    echo "Stored credential check FAILED — verify app install/SSO/scopes."
  fi
else
  echo "No GITHUB_TOKEN in setup; cannot prime credentials for later push."
fi
```

### 4) Dry-run before pushing

```shell
# Confirm what would be pushed
git push --dry-run origin "HEAD:your/branch-name" || \
git push --dry-run "${REPO_HTTPS}" "HEAD:your/branch-name"
```

If dry-run succeeds but real push fails, it’s almost always permissions/branch-protection changing between checks or a required status failing.

Agent rule of thumb: Github credential priming happens in the setup script/phase. Never echo secret values. When 403/404 appears, print the precise diagnosis and one-line fix from above so humans can unblock quickly.
