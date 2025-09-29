set -euo pipefail

# --- Quiet install (prefer lockfile if present)
if [ -f package-lock.json ]; then
  npm ci --no-fund --no-audit --loglevel=error
else
  npm install --no-fund --no-audit --loglevel=error
fi

# --- Token is only available during setup in Codex
echo "GITHUB_TOKEN length: ${#GITHUB_TOKEN}"

# --- Git identity & non-interactive config
git config --global user.name  "codex-bot"
git config --global user.email "codex@example.com"
git config --global advice.detachedHead false
git config --global core.askPass true
git config --global safe.directory "$(pwd)"

# --- Ensure 'origin' points to the correct repo
REPO_URL="https://github.com/SimulatorLife/Colourful-Life.git"
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REPO_URL"
else
  git remote add origin "$REPO_URL"
fi

# --- Wire credentials for later pushes (persist within this repo + global fallback)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  # Determine token owner login (PAT requires username = login)
  ME_LOGIN=""
  if command -v jq >/dev/null 2>&1; then
    ME_LOGIN="$(curl -sS -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/user | jq -r .login)"
  else
    ME_LOGIN="$(curl -sS -H "Authorization: Bearer ${GITHUB_TOKEN}" https://api.github.com/user \
      | sed -n 's/.*"login"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
  fi

  # 1) Repo-local credential helper (survives phase/user changes)
  git config --local credential.helper 'store --file .git/codex-cred'

  # Write PAT-style entry to repo-local helper only
  if [ -n "${ME_LOGIN}" ] && [ "${ME_LOGIN}" != "null" ]; then
    git -c credential.helper= \
        -c 'credential.helper=store --file .git/codex-cred' \
        credential approve <<EOF
protocol=https
host=github.com
username=${ME_LOGIN}
password=${GITHUB_TOKEN}
EOF
  fi

  # Also write App-style entry (harmless if unused)
  git -c credential.helper= \
      -c 'credential.helper=store --file .git/codex-cred' \
      credential approve <<EOF
protocol=https
host=github.com
username=x-access-token
password=${GITHUB_TOKEN}
EOF

  # 2) Global fallback (optional)
  git config --global credential.helper 'store --file ~/.git-credentials'
  if [ -n "${ME_LOGIN}" ] && [ "${ME_LOGIN}" != "null" ]; then
    git credential approve <<EOF
protocol=https
host=github.com
username=${ME_LOGIN}
password=${GITHUB_TOKEN}
EOF
  fi
  git credential approve <<EOF
protocol=https
host=github.com
username=x-access-token
password=${GITHUB_TOKEN}
EOF

  # --- Auth sanity check using the SAME repo-local helper that pushes will use
  echo "Checking authenticated access to repo via repo-local helper…"
  if git -c 'credential.helper=store --file .git/codex-cred' \
         ls-remote "${REPO_URL}" >/dev/null 2>&1; then
    echo "Git auth OK (repo-local helper)."
  else
    echo "Git auth FAIL via repo-local helper."
    echo "If a PAT: ensure username='${ME_LOGIN}' entry exists; verify token has Contents: read/write and org SSO is granted."
  fi
else
  echo "WARNING: GITHUB_TOKEN not injected during setup; pushes will fail."
fi

# --- Optional: fetch base so refs exist locally (non-fatal)
git fetch --prune --no-tags origin master || true
