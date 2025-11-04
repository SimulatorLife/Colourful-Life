# Set up a development environment in Codex with GitHub authentication.
# Pre-requisites:
# Set the following environment variables:
#   REPO_OWNER        - GitHub repo owner (default: SimulatorLife)
#   REPO_NAME         - GitHub repo name (default: current directory name)
#   GIT_TRANSPORT     - git transport method: api (default), ssh443, https
#   GIT_DIFF_OVERRIDE - set to 0 to disable custom git diff behavior (default: 1)
# Set the following environment secrets:
#   GITHUB_TOKEN      - GitHub token with repo access (optional, but needed for API pushes)

set -euo pipefail

# --- Repo/env
REPO_OWNER="${REPO_OWNER:-SimulatorLife}"
REPO_NAME="${REPO_NAME:-$(basename "$(pwd)")}"
URL_443="ssh://git@ssh.github.com:443/${REPO_OWNER}/${REPO_NAME}.git"
export AUTO_COMMIT_ON_EXIT=${AUTO_COMMIT_ON_EXIT:-1}
export GIT_TRANSPORT="${GIT_TRANSPORT:-api}"
echo "Repo resolved as: ${REPO_OWNER}/${REPO_NAME} (transport=${GIT_TRANSPORT})"

# Make sure our shim takes precedence
export PATH="/usr/local/bin:${PATH}"

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

# --- Route SSH via 443 and ensure key (only used in ssh443 mode)
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

# --- Transport selection
case "${GIT_TRANSPORT}" in
  api)
    git remote remove origin 2>/dev/null || true
    ;;
  ssh443)
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "$URL_443"
    else
      git remote add origin "$URL_443"
    fi
    git config --global url."ssh://git@ssh.github.com:443/".insteadOf https://github.com/
    ;;
  https)
    if git remote get-url origin >/dev/null 2>&1; then
      git remote set-url origin "https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
    else
      git remote add origin "https://github.com/${REPO_OWNER}/${REPO_NAME}.git"
    fi
    git config --global --unset-all url.ssh://git@ssh.github.com:443/.insteadOf || true
    [ -n "${HTTPS_PROXY:-}" ] && git config --global https.proxy "${HTTPS_PROXY}"
    [ -n "${HTTP_PROXY:-}" ] && git config --global http.proxy "${HTTP_PROXY}"
    [ -n "${SSL_CERT_FILE:-}" ] && git config --global http.sslCAInfo "${SSL_CERT_FILE}"
    ;;
  *) echo "Unknown GIT_TRANSPORT='${GIT_TRANSPORT}' (use api|ssh443|https)"; exit 2 ;;
esac

# --- Install jq for API helper
if ! command -v jq >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y jq
fi

# --- API Push helper (mirrors HEAD to GitHub)
cat > /usr/local/bin/commit-via-api.sh <<'APISCRIPT'
#!/usr/bin/env bash
set -euo pipefail
owner="${REPO_OWNER:?REPO_OWNER unset}"
repo="${REPO_NAME:?REPO_NAME unset}"
branch="${1:?usage: commit-via-api.sh <branch> [last-commit]}"
mode="${2:-last-commit}"

token="${GITHUB_TOKEN:-}"
if [ -z "${token}" ]; then
  helper="$(git config --local --get credential.helper || true)"
  case "${helper}" in *'store --file '*) cred_file="${helper##*--file }" ;; *) cred_file=".git/codex-cred" ;; esac
  if [ -f "${cred_file}" ]; then
    token="$(sed -n 's#^https\?://[^:]*:\([^@]*\)@github\.com.*#\1#p' "${cred_file}" | tail -n1 || true)"
  fi
fi
[ -n "${token}" ] || { echo "[api-push] GITHUB_TOKEN is required (env or .git/codex-cred)." >&2; exit 1; }

api() { curl -fsS -H "Authorization: token ${token}" -H "Accept: application/vnd.github+json" "$@"; }

default_branch="$(api "https://api.github.com/repos/${owner}/${repo}" | jq -r .default_branch)"
ref_json="$(api "https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}" 2>/dev/null || true)"
if [ -n "${ref_json}" ]; then base_sha="$(echo "${ref_json}" | jq -r .object.sha)"; else base_sha="$(api "https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${default_branch}" | jq -r .object.sha)"; fi
base_tree="$(api "https://api.github.com/repos/${owner}/${repo}/git/commits/${base_sha}" | jq -r .tree.sha)"

declare -a add_paths del_paths
commit_msg="$(git log -1 --pretty=%B)"
if git rev-parse -q --verify HEAD^ >/dev/null 2>&1; then
  while IFS=$'\t' read -r status path; do
    case "${status}" in D) del_paths+=("${path}") ;; *) add_paths+=("${path}") ;; esac
  done < <(git diff-tree --no-commit-id --name-status -r HEAD)
else
  mapfile -t add_paths < <(git ls-files)
fi
if [ "${#add_paths[@]:-0}" -eq 0 ] && [ "${#del_paths[@]:-0}" -eq 0 ]; then
  echo "[api-push] Nothing changed in HEAD; nothing to push."
  exit 0
fi

blobs_json="[]"
for f in "${add_paths[@]}"; do
  [ -f "${f}" ] || continue
  content_b64="$(base64 -w0 < "${f}")"
  blob_sha="$(api -X POST "https://api.github.com/repos/${owner}/${repo}/git/blobs" -d "{\"content\":\"${content_b64}\",\"encoding\":\"base64\"}" | jq -r .sha)"
  blobs_json=$(jq --arg path "$f" --arg sha "$blob_sha" '. + [{"path":$path,"mode":"100644","type":"blob","sha":$sha}]' <<<"${blobs_json}")
done
for f in "${del_paths[@]:-}"; do
  blobs_json=$(jq --arg path "$f" '. + [{"path":$path,"mode":"100644","type":"blob","sha":null}]' <<<"${blobs_json}")
done

new_tree="$(api -X POST "https://api.github.com/repos/${owner}/${repo}/git/trees" -d "{\"base_tree\":\"${base_tree}\",\"tree\":${blobs_json}}" | jq -r .sha)"
new_commit="$(api -X POST "https://api.github.com/repos/${owner}/${repo}/git/commits" -d "{\"message\":$(jq -aRs . <<<\"$commit_msg\"),\"tree\":\"${new_tree}\",\"parents\":[\"${base_sha}\"]}" | jq -r .sha)"
if [ -n "${ref_json}" ]; then
  api -X PATCH "https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}" -d "{\"sha\":\"${new_commit}\",\"force\":false}" >/dev/null
else
  api -X POST "https://api.github.com/repos/${owner}/${repo}/git/refs" -d "{\"ref\":\"refs/heads/${branch}\",\"sha\":\"${new_commit}\"}" >/dev/null
fi
echo "[api-push] ${owner}/${repo}@${branch} -> ${new_commit} (last-commit)"
APISCRIPT
chmod +x /usr/local/bin/commit-via-api.sh

# --- Global hooks (autopush + post-rewrite)
GIT_GLOBAL_HOOKS="${HOME}/.githooks"
mkdir -p "${GIT_GLOBAL_HOOKS}"

cat > "${GIT_GLOBAL_HOOKS}/post-commit" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "${branch}" ] || exit 0
_write_patch_fallback(){ ts="$(date -u +%Y%m%dT%H%M%SZ)"; git diff HEAD~1..HEAD > ".autosave-${ts}.patch" || true; }
if [ "${GIT_TRANSPORT:-api}" = "api" ]; then /usr/local/bin/commit-via-api.sh "${branch}" || _write_patch_fallback; exit 0; fi
remote="origin"; git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"; [ -n "${remote}" ] || exit 0
git push -u "${remote}" "${branch}" >/dev/null 2>&1 || { /usr/local/bin/commit-via-api.sh "${branch}" || _write_patch_fallback; }
HOOK
chmod +x "${GIT_GLOBAL_HOOKS}/post-commit"

cat > "${GIT_GLOBAL_HOOKS}/post-rewrite" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0
branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[ -n "${branch}" ] || exit 0
if [ "${GIT_TRANSPORT:-api}" = "api" ]; then /usr/local/bin/commit-via-api.sh "${branch}" || true; else
  remote="origin"; git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"; [ -n "${remote}" ] || exit 0
  git push --force-with-lease -u "${remote}" "${branch}" >/dev/null 2>&1 || true
fi
HOOK
chmod +x "${GIT_GLOBAL_HOOKS}/post-rewrite"

if ! git config --global --get core.hooksPath >/dev/null 2>&1; then
  git config --global core.hooksPath "${GIT_GLOBAL_HOOKS}"
fi
git config --global push.autoSetupRemote true
git config --global push.default current

# --- Autosave on exit
_auto_commit_on_exit() {
  [ "${AUTO_COMMIT_ON_EXIT}" = "1" ] || return 0
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  cd "${repo_root}" || return 0

  # skip during merges or rebases
  if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 || [ -d .git/rebase-apply ] || [ -d .git/rebase-merge ]; then
    return 0
  fi

  # only commit if there are changes
  if git status --porcelain 2>/dev/null | grep -q .; then
    git add -A
    git diff --cached --quiet && return 0

    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    host="${HOSTNAME:-unknown}"
    msg="chore(autosave): session shutdown ${ts} on ${host}"

    # merge recent commits if very recent
    if git log -1 --since="2 minutes ago" --pretty=%H >/dev/null 2>&1; then
      git commit --amend --no-edit >/dev/null 2>&1 || git commit -m "${msg}" >/dev/null 2>&1
    else
      git commit -m "${msg}" >/dev/null 2>&1 || return 0
    fi

    # push via appropriate transport
    if [ "${GIT_TRANSPORT:-api}" = "api" ]; then
      /usr/local/bin/commit-via-api.sh "$(git rev-parse --abbrev-ref HEAD)" || {
        git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
      }
    else
      if git rev-parse --abbrev-ref --symbolic-full-name "@{u}" >/dev/null 2>&1; then
        git push >/dev/null 2>&1 || git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
      else
        remote="origin"
        git remote get-url "${remote}" >/dev/null 2>&1 || remote="$(git remote | head -n1 || true)"
        if [ -n "${remote}" ]; then
          git push -u "${remote}" "$(git rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1 || \
          git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
        else
          git diff HEAD~1..HEAD > ".autosave-$(date -u +%Y%m%dT%H%M%SZ).patch"
        fi
      fi
    fi
  fi
}
trap _auto_commit_on_exit EXIT HUP INT TERM

# --- Fetch refs (skip in api)
if [ "${GIT_TRANSPORT}" != "api" ]; then
  git fetch --prune --no-tags origin '+refs/heads/*:refs/remotes/origin/*' || true
fi

# --- Proxy diagnostics
env | grep -i proxy || true
git config --show-origin --get-regexp 'http\..*proxy' || true
export NO_PROXY="${NO_PROXY:-},github.com,api.github.com,uploads.github.com,raw.githubusercontent.com,ghcr.io,npm.pkg.github.com"
git config --global http.https://github.com/.proxy "" || true

# --- Create a git **shim** so bare `git diff` shows the entire codebase (incl. untracked)
mkdir -p /tmp/empty
REAL_GIT_PATH="$(command -v git)"
# If our shim will be /usr/local/bin/git, make sure REAL_GIT_PATH isn't pointing to that
if [ "${REAL_GIT_PATH}" = "/usr/local/bin/git" ] && [ -x /usr/bin/git ]; then
  REAL_GIT_PATH="/usr/bin/git"
fi

sudo tee /usr/local/bin/git >/dev/null <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
REAL_GIT="${REAL_GIT_PATH:-/usr/bin/git}"

# Allow escape hatch: GIT_DIFF_OVERRIDE=0 git diff
if [ "${1-}" = "diff" ] && [ "${GIT_DIFF_OVERRIDE:-1}" = "1" ] && [ "$#" -eq 1 ]; then
  mkdir -p /tmp/empty
  exec "${REAL_GIT}" diff --no-index /tmp/empty .
fi

# Mirror the full-repo view for specific commit inspections, even with extra flags
if [ "${1-}" = "show" ] && [ "${GIT_DIFF_OVERRIDE:-1}" = "1" ]; then
  orig_show_args=("$@")
  shift

  commit=""
  options=()
  paths=()
  extras=()

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --help|-h)
        exec "${REAL_GIT}" show "${orig_show_args[@]}"
        ;;
      --)
        shift
        while [ "$#" -gt 0 ]; do
          paths+=("$1")
          shift
        done
        break
        ;;
      -* )
        options+=("$1")
        shift
        ;;
      * )
        if [ -z "${commit}" ]; then
          commit="$1"
        else
          extras+=("$1")
        fi
        shift
        ;;
    esac
  done

  # default to HEAD when no explicit commit is supplied
  commit="${commit:-HEAD}"

  # bail out to the real implementation on complex forms
  if [ "${#extras[@]}" -gt 0 ]; then
    exec "${REAL_GIT}" show "${orig_show_args[@]}"
  fi

  # ensure the commit exists
  if ! "${REAL_GIT}" cat-file -e "${commit}^{tree}" >/dev/null 2>&1; then
    exec "${REAL_GIT}" show "${orig_show_args[@]}"
  fi

  empty_tree="4b825dc642cb6eb9a060e54bf8d69288fbee4904"
  if [ "${#paths[@]}" -gt 0 ]; then
    "${REAL_GIT}" diff "${options[@]}" "${empty_tree}" "${commit}" -- "${paths[@]}"
  else
    "${REAL_GIT}" diff "${options[@]}" "${empty_tree}" "${commit}"
  fi
  exit $?
fi

exec "${REAL_GIT}" "$@"
SHIM
sudo chmod +x /usr/local/bin/git

# Also provide an explicit alias for scripts/tools:
git config --global alias.fulldiff '!f(){ mkdir -p /tmp/empty && command git diff --no-index /tmp/empty . "$@"; }; f'

# --- Node: ensure version BEFORE any npm use
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
echo "npm in use : $(npm -v 2>/dev/null || echo 'none')"

# --- Install deps (after Node is correct)
if [ -f package-lock.json ]; then
  npm ci --no-fund --no-audit --loglevel=error
else
  npm install --no-fund --no-audit --loglevel=error
fi

# --- Repo-local credential store for HTTPS pushes (if token provided)
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "Configuring repo-local credential store..."
  git config --local credential.helper 'store --file .git/codex-cred'
git -c credential.helper= \
  -c 'credential.helper=store --file .git/codex-cred' \
  credential approve <<EOF
protocol=https
host=github.com
username=codex-bot
password=${GITHUB_TOKEN}
EOF
chmod 600 .git/codex-cred
fi

echo "Final Git remote configuration:"
git remote -v || true
echo "Custom environment setup script complete."
