#!/usr/bin/env bash
set -euo pipefail

# Builds the project and pushes the compiled assets to a dedicated public repository.
#
# Requirements:
#   * Run from the root of the private/source repository.
#   * "npm install" must have already been executed.
#   * A git remote pointing at the public repo must exist (defaults to "public").
#   * The public repository must have a branch dedicated to the build output
#     (defaults to "gh-pages").
#
# The script will create a temporary git worktree for the public repository branch,
# copy the Parcel build output (dist/) into it, commit the changes, and push.
#
# If `rsync` is unavailable the script falls back to `tar` or `cp` so it can run
# on environments like Windows shells without additional dependencies.

PUBLIC_REMOTE_NAME=${PUBLIC_REMOTE_NAME:-public}
PUBLIC_BRANCH=${PUBLIC_BRANCH:-gh-pages}
BUILD_COMMAND=${BUILD_COMMAND:-"npm run build"}
BUILD_DIR=${BUILD_DIR:-dist}

ROOT_DIR=$(git rev-parse --show-toplevel)
cd "$ROOT_DIR"

if ! git remote get-url "$PUBLIC_REMOTE_NAME" >/dev/null 2>&1; then
  echo "Error: git remote '$PUBLIC_REMOTE_NAME' not found."
  echo "Add it with: git remote add $PUBLIC_REMOTE_NAME <git-url-to-public-repo>"
  exit 1
fi

# Run build
printf 'Running build command: %s\n' "$BUILD_COMMAND"
eval "$BUILD_COMMAND"

if [ ! -d "$BUILD_DIR" ]; then
  echo "Error: build directory '$BUILD_DIR' was not produced by the build command."
  exit 1
fi

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

WORKTREE_PATH="$TMP_DIR/worktree"
mkdir -p "$WORKTREE_PATH"

# Fetch latest state of the public branch
printf 'Fetching latest %s/%s...\n' "$PUBLIC_REMOTE_NAME" "$PUBLIC_BRANCH"
git fetch "$PUBLIC_REMOTE_NAME" "$PUBLIC_BRANCH"

printf 'Checking out %s/%s into temporary worktree...\n' "$PUBLIC_REMOTE_NAME" "$PUBLIC_BRANCH"
# Create or reset worktree for the public branch
if git show-ref --verify --quiet "refs/heads/$PUBLIC_BRANCH"; then
  git worktree add "$WORKTREE_PATH" "$PUBLIC_BRANCH" --force
else
  git worktree add "$WORKTREE_PATH" "$PUBLIC_REMOTE_NAME/$PUBLIC_BRANCH"
fi

cd "$WORKTREE_PATH"

# Clear existing files (keeping .git directory)
find . -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +

# Copy build output into worktree

copy_build_output() {
  local source_dir="$ROOT_DIR/$BUILD_DIR"

  if command -v rsync >/dev/null 2>&1; then
    printf 'Copying build output with rsync...\n'
    rsync -a --delete "$source_dir/" ./
    return
  fi

  if command -v tar >/dev/null 2>&1; then
    printf 'rsync not found; falling back to tar-based copy...\n'
    tar -C "$source_dir" -cf - . | tar -xf -
    return
  fi

  if command -v cp >/dev/null 2>&1; then
    printf 'rsync and tar not found; using portable cp fallback...\n'
    if cp -a "$source_dir"/. ./ 2>/dev/null; then
      return
    fi

    cp -R "$source_dir"/. ./
    return
  fi

  echo "Error: unable to copy build output. Install rsync or tar." >&2
  exit 1
}

copy_build_output

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes to publish."
else
  git add --all
  COMMIT_MESSAGE="Publish build from $(git -C "$ROOT_DIR" rev-parse --short HEAD)"
  git commit -m "$COMMIT_MESSAGE"
  git push "$PUBLIC_REMOTE_NAME" "$PUBLIC_BRANCH"
  echo "Published build to $PUBLIC_REMOTE_NAME/$PUBLIC_BRANCH"
fi

cd "$ROOT_DIR"
git worktree remove "$WORKTREE_PATH" --force

printf 'Deployment worktree cleaned up.\n'
