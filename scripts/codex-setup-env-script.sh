# Set up a development environment in Codex with GitHub authentication.
# Pre-requisites:
# Set the following environment variables:
#   REPO_OWNER        - GitHub repo owner (default: SimulatorLife)
#   REPO_NAME         - GitHub repo name (default: current directory name)
# Set the following environment secrets:
#   GITHUB_TOKEN      - GitHub token with repo access (optional, but needed for API pushes)

set -euo pipefail

# --- Repo
REPO_OWNER="${REPO_OWNER:-SimulatorLife}"
REPO_NAME="${REPO_NAME:-$(basename "$(pwd)")}"
echo "Repo resolved as: ${REPO_OWNER}/${REPO_NAME}"

# --- Git config
git config --global user.name "bot"
git config --global user.email "bot@example.com"
git config --global advice.detachedHead false
git config --global core.askPass true
git config --global safe.directory "$(pwd)"
git config --global push.autoSetupRemote true
git config --global push.default current

# --- Git: make proxy + CA persistent for this repo
git config --local http.proxy  "http://proxy:8080"
git config --local https.proxy "http://proxy:8080"

# If you previously told Git to bypass proxy for GitHub, undo that and force proxy:
git config --local --unset-all http.https://github.com.proxy 2>/dev/null || true
git config --local http.https://github.com.proxy "http://proxy:8080"

# Trust the MITM proxy cert path your env exposes:
git config --local http.sslCAInfo "/usr/local/share/ca-certificates/envoy-mitmproxy-ca-cert.crt"

# --- Token visibility
[ -n "${GITHUB_TOKEN:-}" ] && echo "GITHUB_TOKEN present (length hidden)." || echo "GITHUB_TOKEN not provided."

# Use a local credential helper tied to this repo
git config --local credential.helper 'store --file .git/codex-cred'

# Approve credentials into that file
git -c credential.helper= -c 'credential.helper=store --file .git/codex-cred' credential approve <<EOF
protocol=https
host=github.com
username=henrylkirk
password=${GITHUB_TOKEN}
EOF

chmod 600 .git/codex-cred

# --- Fetch
git fetch --prune --no-tags "https://github.com/${REPO_OWNER}/${REPO_NAME}.git" '+refs/heads/*:refs/remotes/origin/*' || true

# Also provide an explicit alias for scripts/tools:
# git config --global alias.fulldiff '!f(){ mkdir -p /tmp/empty && command git diff --no-index /tmp/empty . "$@"; }; f'

# --- Node: ensure version BEFORE any pnpm use
export NVM_DIR="${HOME}/.nvm"
if [ ! -s "${NVM_DIR}/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
fi
. "${NVM_DIR}/nvm.sh"

if [ -f .nvmrc ]; then
  required_node="$(tr -d '\r\n' < .nvmrc)"
  if [ -n "${required_node}" ]; then
    nvm install "${required_node}"
    nvm use "${required_node}"
  fi
fi

echo "Node in use: $(node -v 2>/dev/null || echo 'none')"
echo "pnpm in use: $(pnpm --version 2>/dev/null || echo 'none')"

# --- Install deps (after Node is correct)
corepack enable
corepack prepare pnpm@9.15.5 --activate

if [ -f pnpm-lock.yaml ]; then
  pnpm install --frozen-lockfile
else
  pnpm install
fi

echo "Final Git remote configuration:"
git remote -v || true
echo "Custom environment setup script complete."
