# Run GitHub Actions Workflow Generator

Runs the [github-actions-workflow-generator](https://github.com/spring-io/github-actions-workflow-generator) across all Spring Cloud OSS and commercial repositories and branches, keeping generated workflow files and release-train wrapper actions up to date.

## What It Does

For every repository and branch tracked in [`config/projects.json`](../config/projects.json) on the `main` branch:

1. Creates or updates `.github/actions/release-train-build/action.yml` and `.github/actions/release-train-test/action.yml` in the target repo, pinning them to the latest SHA of those actions in this repo.
2. Runs the workflow generator JAR, which regenerates `.github/workflows/release-train-*.yml` files (build, test, join, leave, ready) in the target repo.
3. Commits and pushes any changes with the message `Update generated GitHub Actions workflow files`.

The primary Java version passed to the generator is determined per-branch from `projects.json`:
- `8` if JDK 8 is listed in the branch's `jdkVersions`
- `17` otherwise

## Triggering the Workflow

The workflow is triggered manually via **Actions → Run GitHub Actions Workflow Generator → Run workflow**.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `generator-version` | No | Latest release | Version of `github-actions-workflow-generator` to use (e.g. `0.0.5`). |
| `release-train-build-sha` | No | Auto-detected | SHA to pin `.github/actions/release-train-build/action.yml` to. Defaults to the SHA of the latest commit that modified that action in this repo. |
| `release-train-test-sha` | No | Auto-detected | SHA to pin `.github/actions/release-train-test/action.yml` to. Defaults to the SHA of the latest commit that modified that action in this repo. |
| `spring-release` | No | _(empty)_ | Spring release train version (e.g. `2026.1`). When set, also processes `release/[version]` branches found in the `spring-io/release-train` README for that version. See [Spring Release Branches](#spring-release-branches). |
| `projects` | No | _(empty — all projects)_ | Comma-separated list of Spring Cloud project names to limit the run to (e.g. `spring-cloud-build,spring-cloud-config`). When empty, every project in `projects.json` is processed. |
| `token` | No | `GH_ACTIONS_REPO_TOKEN` | GitHub token with write access to all target repos. Falls back to the `GH_ACTIONS_REPO_TOKEN` organisation secret. |

## Examples

### Update everything

Run with all defaults to regenerate workflow files across every tracked repo and branch:

```
Inputs: (all empty)
```

### Target specific projects

```
projects: spring-cloud-config,spring-cloud-gateway
```

### Pin to a specific generator version

```
generator-version: 0.0.5
```

### Pin wrapper action SHAs manually

Useful if you want to roll out a specific version of the build/test logic without waiting for the auto-detect:

```
release-train-build-sha: 348109524f9790dc1e20d48043fb1ef4765373b8
release-train-test-sha:  3844cdcd9639d7dfdfaa5bb8affb730c54ddfee2
```

### Include active release-train branches

```
spring-release: 2026.1
```

## Spring Release Branches

When `spring-release` is set, the workflow fetches `README.adoc` from the `spring-io/release-train` repository at the specified ref (e.g. `2026.1`) and scans it for Spring Cloud entries. For each entry it finds a `release/[version]` branch in the corresponding commercial repository and runs the same generator steps against it.

The primary JDK for a release branch is determined by deriving the parent branch from the version number (e.g. `release/3.1.15` → parent `3.1.x`) and looking up that branch's `jdkVersions` in `projects.json`.

## Wrapper Actions

Each target repo is expected to have (or will have created):

**`.github/actions/release-train-build/action.yml`**
```yaml
name: Build Release
runs:
  using: composite
  steps:
    - uses: spring-cloud/spring-cloud-github-actions/.github/actions/release-train-build@<sha>
```

**`.github/actions/release-train-test/action.yml`**
```yaml
name: Test Release
runs:
  using: composite
  steps:
    - uses: spring-cloud/spring-cloud-github-actions/.github/actions/release-train-test@<sha>
```

If these files already exist, only the SHA is updated; any other content in the file is preserved.

## Adding a New Project

Add the project to [`config/projects.json`](../config/projects.json) on the `main` branch with its OSS/commercial branch and `jdkVersions` configuration, then re-run this workflow (optionally scoped with the `projects` input).
