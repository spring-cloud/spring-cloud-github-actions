# devkit-cli

Builds the [`spring-io/spring-devkit`](https://github.com/spring-io/spring-devkit) CLI (`spd`) from source and makes the resulting JAR available to the calling workflow. Optionally runs a single `spd` command.

`spring-devkit` provides tooling that Spring uses across projects — currently `hotfix`, `migrate-license`, `release-train` and `release-dependencies`. This action exists so this repository can call that tooling instead of maintaining a second copy of the same logic.

## Why build from source?

`spring-io/spring-devkit` is an **internal** repository, and its latest GitHub Release (`v0.0.2`) predates the rename from `commercial-support-cli` to `spring-devkit` — the binary published there is `commercial`, not `spd`. Until a post-rename release exists, the CLI has to be built from source.

Because the JAR is a pure function of the devkit commit, it is cached under that commit SHA. Only the first run on a given devkit commit pays for the Gradle build.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `repository` | no | `spring-io/spring-devkit` | Repository to build from. Override to point at a fork when trying out an unmerged devkit change. |
| `ref` | no | `main` | Git ref of the devkit repository to build (branch, tag or SHA) |
| `token` | yes | — | GitHub token with read access to the devkit repository. `spring-io/spring-devkit` is internal, so the default `GITHUB_TOKEN` is **not** sufficient — pass `GH_ACTIONS_REPO_TOKEN`. |
| `patches` | no | `''` | Path (relative to the caller's workspace) to a directory of `*.patch` files, or a single patch file, applied to the devkit checkout before building. |
| `args` | no | `''` | Arguments to pass to `spd`. When empty, the action only builds the CLI. |
| `working-directory` | no | `github.workspace` | Directory to run `spd` from. Only used when `args` is supplied. |

## Outputs

| Name | Description |
|------|-------------|
| `cli-jar` | Absolute path to the built `spring-devkit-cli.jar` |
| `sha` | Commit SHA of the devkit repository that was built |
| `patched` | `'true'` if local patches were applied |

## Usage

Run a command directly:

```yaml
- name: Migrate license
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/devkit-cli@v1
  with:
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
    args: migrate-license /path/to/repo
```

Build once and invoke repeatedly:

```yaml
- name: Build devkit CLI
  id: devkit
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/devkit-cli@v1
  with:
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}

- name: Run several commands
  run: |
    java -jar "${{ steps.devkit.outputs.cli-jar }}" migrate-license "$RUNNER_TEMP/repo-a"
    java -jar "${{ steps.devkit.outputs.cli-jar }}" migrate-license "$RUNNER_TEMP/repo-b"
```

Pin to a specific devkit commit for reproducibility:

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/devkit-cli@v1
  with:
    ref: 8d0963f
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

Build from a fork, to try an unmerged devkit change:

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/devkit-cli@v1
  with:
    repository: spring-cloud/spring-devkit
    ref: copyright-symbol
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Patching devkit before the build

Rather than maintaining a fork, a change on its way upstream can be carried as a patch in
the calling repository and applied to the checkout before the build:

```yaml
- uses: spring-cloud/spring-cloud-github-actions/.github/actions/devkit-cli@v1
  with:
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
    patches: config/devkit-patches
```

Patches are applied with `git apply --3way` in file-name order. If one no longer applies
the build **fails** — that is deliberate, and is the signal that upstream has moved and
the patch needs rebasing or deleting. See
[`config/devkit-patches`](../../../config/devkit-patches/) for the patches this repository
currently carries and their upstream status.

The patch set is fingerprinted into the cache key, so editing, adding or removing a patch
rebuilds rather than reusing a stale JAR.

## Notes

* Java 25 (Liberica) is installed by the action, matching devkit's `.sdkmanrc`. It is installed on cache hits too, since running `spd` still needs a JVM.
* `spd migrate-license` exits with code **1** when it finds nothing to migrate. That is a "no match" signal, not a failure — callers that tolerate it must handle the exit code themselves rather than passing the command through `args`.
* `GITHUB_TOKEN` is exported when running `spd`, which the `release-train` and `release-dependencies` commands use to reach the GitHub API.
