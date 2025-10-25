set -euo pipefail

# --- Quiet install (prefer lockfile if present)
if [ -f package-lock.json ]; then
  npm ci --no-fund --no-audit --loglevel=error
else
  npm install --no-fund --no-audit --loglevel=error
fi

# --- Ensure GitHub CLI is installed (for later use)
if ! command -v gh >/dev/null 2>&1; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
    https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi

# --- Token is only available during setup in Codex
echo "GITHUB_TOKEN length: ${#GITHUB_TOKEN}"

# --- Git identity & non-interactive config (commit metadata only)
git config --global user.name  "codex-bot"
git config --global user.email "codex@example.com"
git config --global advice.detachedHead false
git config --global core.askPass true
git config --global safe.directory "$(pwd)"

# --- Ensure 'origin' points to the correct repo (clean URL, no token)
REPO_OWNER="SimulatorLife"
REPO_NAME="Colourful-Life"
REPO_URL="https://github.com/${REPO_OWNER}/${REPO_NAME}.git"

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

# --- Wire credentials for later pushes (repo-local helper)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # We are using a PAT that belongs to this login:
  PAT_LOGIN="henrylkirk"

  # Use a repo-local credential store so pushes later in the run use these creds automatically.
  git config --local credential.helper 'store --file .git/codex-cred'

  # Write PAT-style entry (username MUST be the login for PAT auth).
  git -c credential.helper= \
      -c 'credential.helper=store --file .git/codex-cred' \
      credential approve <<EOF
protocol=https
host=github.com
username=${PAT_LOGIN}
password=${GITHUB_TOKEN}
EOF

  # --- Sanity: verify the same helper works (no token in URL)
  echo "Checking authenticated access to repo via repo-local helper…"
  if git -c 'credential.helper=store --file .git/codex-cred' \
         ls-remote "${REPO_URL}" >/dev/null 2>&1; then
    echo "Git auth OK (repo-local helper)."
  else
    echo "Git auth FAIL via repo-local helper."
    echo "Fix: Ensure the PAT for '${PAT_LOGIN}' has 'repo' (Contents: read/write) and any required org SSO is authorized."
  fi

  echo "Repo credential.helper: $(git config --local --get credential.helper || echo '<unset>')"
else
  echo "WARNING: GITHUB_TOKEN not injected during setup; pushes will fail."
fi

# --- Optional: fetch base so refs exist locally (non-fatal)
git fetch --prune --no-tags origin master || true

# Notes:
# - Do NOT embed the token in remote URLs, and do NOT remove 'origin'.
# - Later, push with either:
#     git push origin "HEAD:<branch>"
#   or:
#     git -c credential.helper= -c 'credential.helper=store --file .git/codex-cred' \
#       push "${REPO_URL}" "HEAD:<branch>"
#   Both use the repo-local credential helper written above.

echo "Custom environment setup script complete."
