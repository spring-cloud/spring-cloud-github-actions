# Run GitHub Actions Workflow Generator

Runs the [github-actions-workflow-generator](https://github.com/spring-io/github-actions-workflow-generator) across all Spring Cloud OSS and commercial repositories and branches, keeping generated workflow files and release-train action files up to date.

## What It Does

For every repository and branch tracked in [`config/projects.json`](../config/projects.json):

1. Copies `.github/actions/release-train-build/action.yml` and `.github/actions/release-train-test/action.yml` into the target repo from this repo (see [Release Train Actions](#release-train-actions)).
2. Copies `release-train-settings.xml` to the root of the target repo.
3. Runs the workflow generator JAR, which regenerates `.github/workflows/release-train-*.yml` files (build, test, join, leave, ready) in the target repo.
4. Commits and pushes any changes with the message `Update generated GitHub Actions workflow files [skip actions]`.

The primary Java version passed to the generator is determined per-branch from `projects.json`:
- `8` if JDK 8 is listed in the branch's `jdkVersions`
- `17` otherwise

## Triggering the Workflow

The workflow is triggered manually via **Actions → Run GitHub Actions Workflow Generator → Run workflow**.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `generator-version` | No | Latest release | Version of `github-actions-workflow-generator` to use (e.g. `0.0.5`). |
| `sha` | No | Triggering commit | Commit SHA of this repo to copy release-train action files from. Useful for rolling out a specific version of the build/test logic. |
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

### Copy action files from a specific commit

Useful when you want to roll out a specific version of the build/test action logic:

```
sha: 348109524f9790dc1e20d48043fb1ef4765373b8
```

### Include active release-train branches

```
spring-release: 2026.1
```

## Spring Release Branches

When `spring-release` is set, the workflow fetches `README.adoc` from the `spring-io/release-train` repository at the specified ref (e.g. `2026.1`) and scans it for Spring Cloud entries. For each entry it finds a `release/[version]` branch in the corresponding commercial repository and runs the same generator steps against it.

The primary JDK for a release branch is determined by deriving the parent branch from the version number (e.g. `release/3.1.15` → parent `3.1.x`) and looking up that branch's `jdkVersions` in `projects.json`.

## Release Train Actions

Each target repo receives a copy of the release-train action files directly from this repo. The source file for each action is chosen using a three-level lookup (first match wins):

1. **Branch-specific override**: `config/release-train-actions/<project>/<branch>/<action>/action.yml`
2. **Project-level override**: `config/release-train-actions/<project>/<action>/action.yml`
3. **Global default**: `.github/actions/<action>/action.yml`

Where `<project>` is the OSS project name (e.g. `spring-cloud-kubernetes`, without the `-commercial` suffix) and `<branch>` is the exact branch name (e.g. `release/5.0.2.1` — branch names containing `/` become nested directories naturally).

### Adding a project-level override

Create the override file in this repo and re-run the generator:

```
config/release-train-actions/
  spring-cloud-kubernetes/
    release-train-build/
      action.yml    ← custom build logic (e.g. adds MAVEN_OPTS)
```

### Adding a branch-specific override

```
config/release-train-actions/
  spring-cloud-foo/
    release/
      5.0.2.1/
        release-train-build/
          action.yml    ← only used for this specific branch
```

## Adding a New Project

Add the project to [`config/projects.json`](../config/projects.json) on the `main` branch with its OSS/commercial branch and `jdkVersions` configuration, then re-run this workflow (optionally scoped with the `projects` input).
