# Run GitHub Actions Workflow Generator

Runs the [github-actions-workflow-generator](https://github.com/spring-io/github-actions-workflow-generator) across all Spring Cloud OSS and commercial repositories and branches, keeping generated workflow files and release-train action files up to date.

## What It Does

For every repository and `.x` branch tracked in [`config/projects.json`](../config/projects.json):

1. Copies `.github/actions/release-train-build/action.yml` and `.github/actions/release-train-test/action.yml` into the target repo from this repo (see [Release Train Actions](#release-train-actions)).
2. Copies `release-train-settings.xml` to the root of the target repo.
3. Runs the workflow generator JAR, which regenerates `.github/workflows/release-train-*.yml` files (build, test, join, leave, ready) in the target repo.
4. Commits and pushes any changes with the message `Update generated GitHub Actions workflow files [skip actions]`. On a [dry run](#dry-run) the changes are reported but not committed or pushed.

The primary Java version passed to the generator is determined per-branch from `projects.json`:
- `8` if JDK 8 is listed in the branch's `jdkVersions`
- `17` otherwise

`release/*` and `*-internal` branches are never processed, even when listed in `projects.json`. They are rebased onto the `.x` branches and pick up the regenerated workflow files that way.

## Triggering the Workflow

The workflow is triggered manually via **Actions → Run GitHub Actions Workflow Generator → Run workflow**.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `generator-version` | No | Latest release | Version of `github-actions-workflow-generator` to use (e.g. `0.0.5`). |
| `sha` | No | Triggering commit | Commit SHA of this repo to copy release-train action files from. Useful for rolling out a specific version of the build/test logic. |
| `projects` | No | _(empty — all projects)_ | Comma-separated list of Spring Cloud project names to limit the run to (e.g. `spring-cloud-build,spring-cloud-config`). When empty, every project in `projects.json` is processed. |
| `dry_run` | No | `true` | When true, reports which repos and branches would be updated and pushes nothing. Uncheck to actually commit and push. |
| `token` | No | `GH_ACTIONS_REPO_TOKEN` | GitHub token with write access to all target repos. Falls back to the `GH_ACTIONS_REPO_TOKEN` organisation secret. |

## Dry Run

`dry_run` defaults to `true`, so a run with default inputs only previews. The generator still runs against a fresh clone of every target branch, and the job log shows the diff stat of what would change. Nothing is committed or pushed, and the summary lists those branches under **Would update**. Uncheck `dry_run` to apply the changes.

## Examples

### Preview what would change

```
dry_run: true
```

### Update everything

Regenerate workflow files across every tracked repo and branch:

```
dry_run: false
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
