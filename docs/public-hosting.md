# Publishing the Simulation to a Public Repository

This guide describes how to publish the compiled Colourful Life simulation to a
public GitHub repository so it can be hosted via GitHub Pages (or any other
static host) without exposing the private source code. The workflow copies the
Parcel build output from this private repository into a public repository using
Git worktrees.

## 1. Prepare a Public Repository

1. Create a new **public** repository in GitHub. The repository only needs to
   store the compiled assets (`index.html`, `styles.css`, JavaScript bundles,
   etc.).
2. Ensure the default branch name matches the branch you want to publish to
   (the automation assumes `gh-pages`, but this can be adjusted).
3. Enable GitHub Pages (Settings → Pages) and point it at the publishing branch
   (`gh-pages` by default).

## 2. Add the Public Repository as a Remote

From your local clone of the private source repository:

```bash
git remote add public git@github.com:your-org/colourful-life-public.git
```

You can pick any remote name. If you choose a name other than `public`, export
`PUBLIC_REMOTE_NAME` before running the publishing script.

## 3. Build and Publish the Assets

Run the helper script added to `scripts/`:

```bash
npm install
./scripts/publish-public-build.sh
```

The script performs the following steps:

1. Runs `npm run build` (override with `BUILD_COMMAND` if needed).
2. Creates a temporary Git worktree for the target publishing branch.
3. Copies the Parcel build output (`dist/` by default) into the worktree.
4. Commits the updated assets with a message referencing the source commit.
5. Pushes the changes to the public repository.

Environment variables let you customise the behaviour without editing the
script:

| Variable             | Default         | Purpose                                                   |
| -------------------- | --------------- | --------------------------------------------------------- |
| `PUBLIC_REMOTE_NAME` | `public`        | Name of the Git remote pointing to the public repository. |
| `PUBLIC_BRANCH`      | `gh-pages`      | Branch that stores the compiled assets.                   |
| `BUILD_COMMAND`      | `npm run build` | Command used to create the production build.              |
| `BUILD_DIR`          | `dist`          | Directory containing the build output to publish.         |

Example:

```bash
PUBLIC_BRANCH=main BUILD_DIR=dist ./scripts/publish-public-build.sh
```

If the script detects no changes in the build output, it exits without pushing.

## 4. (Optional) Automate via CI

Once you are satisfied with the manual flow, you can automate it using a CI
workflow (e.g., GitHub Actions) that runs the script whenever `master` is
updated. Because the workflow needs write access to the public repository, add
an SSH deploy key or use a fine-grained personal access token. Remember to keep
CI definitions in sync with the script so both paths share the same logic.

## 5. Viewing the Hosted Simulation

After a successful publish, GitHub Pages will redeploy the site automatically.
Visit the Pages URL shown in the public repository settings to access the
latest build from any device, including mobile browsers.
