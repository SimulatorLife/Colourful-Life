# Set up a development environment in Codex with GitHub authentication.

set -euo pipefail

# --- Repo/env
REPO_OWNER="${REPO_OWNER:-SimulatorLife}"
REPO_NAME="${REPO_NAME:-$(basename "$(pwd)")}"
URL_443="ssh://git@ssh.github.com:443/${REPO_OWNER}/${REPO_NAME}.git"
export AUTO_COMMIT_ON_EXIT=${AUTO_COMMIT_ON_EXIT:-1}
echo "Repo resolved as: ${REPO_OWNER}/${REPO_NAME}"

# --- Git identity & safe config
git config --global user.name  "codex-bot"
git config --global user.email "codex@example.com"
git config --global advice.detachedHead false
git config --global core.askPass true
git config --global safe.directory "$(pwd)"

# --- GitHub CLI (optional)
if ! command -v gh >/dev/null 2>&1; then
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
  sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
  sudo apt-get update
  sudo apt-get install -y gh
fi

# --- Token visibility
[ -n "${GITHUB_TOKEN:-}" ] && echo "GITHUB_TOKEN present (length hidden)." || echo "GITHUB_TOKEN not provided."

# --- Route SSH via 443 and ensure key
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if ! grep -q "^Host github.com$" ~/.ssh/config 2>/dev/null; then
  cat >> ~/.ssh/config <<'EOF'
Host github.com
  Hostname ssh.github.com
  Port 443
  User git
  StrictHostKeyChecking accept-new
EOF
  chmod 600 ~/.ssh/config
fi
ssh-keyscan -p 443 ssh.github.com 2>/dev/null >> ~/.ssh/known_hosts || true
chmod 600 ~/.ssh/known_hosts 2>/dev/null || true
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "codex-bot-$(date -u +%Y%m%dT%H%M%SZ)" >/dev/null

# --- Optional: add deploy key (may require perms and proxy access)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  PUBKEY_CONTENT="$(cat ~/.ssh/id_ed25519.pub)"
  DEPLOY_TITLE="codex-bot-ephemeral-$(hostname)-$(date -u +%Y%m%dT%H%M%SZ)"
  curl -fsS -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/keys" \
    -d "{\"title\":\"$DEPLOY_TITLE\",\"key\":\"$PUBKEY_CONTENT\",\"read_only\":false}" \
    >/dev/null 2>&1 || echo "NOTE: deploy-key add failed (proxy/perms)."
fi

# --- Add/update origin to SSH:443 and force HTTPS->SSH rewrite (belt & suspenders)
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$URL_443"
else
  git remote add origin "$URL_443"
fi
git config --global url."ssh://git@ssh.github.com:443/".insteadOf https://github.com/

# --- Global hooks (autopush + post-rewrite)
GIT_GLOBAL_HOOKS="${HOME}/.githooks"
mkdir -p "${GIT_GLOBAL_HOOKS}"
git config --global core.hooksPath "${GIT_GLOBAL_HOOKS}"
git config --global push.autoSetupRemote true
git config --global push.default current

cat > "${GIT_GLOBAL_HOOKS}/post-commit" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "${branch}" ] || exit 0
remote="origin"; git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"
[ -n "${remote}" ] || exit 0
git push -u "${remote}" "${branch}" >/dev/null 2>&1 || true
HOOK
chmod +x "${GIT_GLOBAL_HOOKS}/post-commit"

cat > "${GIT_GLOBAL_HOOKS}/post-rewrite" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "${branch}" ] || exit 0
remote="origin"; git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"
[ -n "${remote}" ] || exit 0
git push --force-with-lease -u "${remote}" "${branch}" >/dev/null 2>&1 || true
HOOK
chmod +x "${GIT_GLOBAL_HOOKS}/post-rewrite"

# --- Autosave on exit
_auto_commit_on_exit() {
  [ "${AUTO_COMMIT_ON_EXIT}" = "1" ] || return 0
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  cd "${repo_root}" || return 0
  if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 || [ -d .git/rebase-apply ] || [ -d .git/rebase-merge ]; then
    return 0
  fi
  if git status --porcelain 2>/dev/null | grep -q .; then
    git add -A
    git diff --cached --quiet && return 0
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; host="${HOSTNAME:-unknown}"
    msg="chore(autosave): session shutdown ${ts} on ${host}"
    if git log -1 --since="2 minutes ago" --pretty=%H >/dev/null 2>&1; then
      git commit --amend --no-edit >/dev/null 2>&1 || git commit -m "${msg}" >/dev/null 2>&1
    else
      git commit -m "${msg}" >/dev/null 2>&1 || return 0
    fi
    if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
      git push >/dev/null 2>&1 || git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
    else
      remote="origin"; git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"
      if [ -n "${remote}" ]; then
        git push -u "${remote}" "$(git rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1 || git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
      else
        git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
      fi
    fi
  fi
}
trap _auto_commit_on_exit EXIT HUP INT TERM

# --- Fetch refs (don’t assume master)
git fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*' || true

# --- Optional: proxy debug + bypass for GitHub HTTPS (harmless even if unused)
env | grep -i proxy || true
git config --show-origin --get-regexp 'http\..*proxy' || true
export NO_PROXY="${NO_PROXY:-},github.com,api.github.com,uploads.github.com,raw.githubusercontent.com,ghcr.io,npm.pkg.github.com"
git config --global http.https://github.com/.proxy "" || true

# --- Make `git diff` show whole repo by default (with an opt-out)
export GIT_DIFF_OVERRIDE="${GIT_DIFF_OVERRIDE:-1}"
git() {
  if [ "${GIT_DIFF_OVERRIDE}" = "1" ] && [ "${1-}" = "diff" ]; then
    shift
    command git diff 4b825dc642cb6eb9a060e54bf8d69288fbee4904 "$@"
  else
    command git "$@"
  fi
}

# --- Node: ensure version BEFORE any npm use
export NVM_DIR="${HOME}/.nvm"
if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
# shellcheck disable=SC1090
. "${NVM_DIR}/nvm.sh"

if [ -f .nvmrc ]; then
  required_node="$(tr -d '\r\n' < .nvmrc)"
  if [ -n "${required_node}" ]; then
    nvm install "${required_node}"
    nvm use "${required_node}"
  fi
fi

echo "Node in use: $(node -v 2>/dev/null || echo 'none')"
echo "npm in use : $(npm -v 2>/dev/null || echo 'none')"

# --- Install deps (run ONCE, now that Node is correct)
if [ -f package-lock.json ]; then
  npm ci --no-fund --no-audit --loglevel=error
else
  npm install --no-fund --no-audit --loglevel=error
fi

echo "Final Git remote configuration:"
git remote -v

echo "Custom environment setup script complete."
