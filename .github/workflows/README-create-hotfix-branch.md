# create-hotfix-branch

Creates a commercial hotfix release branch directly from an OSS tag, applies all standard commercial branch initialisation steps, stamps the project version to a hotfix snapshot, ensures required release-train workflows are present, and (by default) triggers `release-train-join` in the commercial repo.

## What it does

1. **Derives names** — strips the leading `v` from the tag, appends `.1`, and prefixes with `release/` to form the commercial branch name (e.g. `v5.0.1` → `release/5.0.1.1`). The commercial repo is always the OSS repo with `-commercial` appended.
2. **Initialises the branch** — delegates to [`initialize-commercial-branch`](initialize-commercial-branch.yml), which runs the full suite of commercial setup actions: copy `.settings.xml`, update CI/PR workflows, update licence headers, replace OSS repositories with commercial Broadcom repositories, update distribution management, and update `config/projects.json`.
3. **Creates a milestone** — creates a milestone in the commercial repo for the hotfix version if one does not already exist.
4. **Stamps the project version** — updates the project version in `pom.xml`, `gradle.properties`, and `build.gradle` files to `<current-version>.1-SNAPSHOT` (e.g. `5.0.1` → `5.0.1.1-SNAPSHOT`). Optionally updates dependency versions at the same time.
5. **Ensures required workflows** — checks that `release-train-join.yml` and `release-train-ready.yml` are present on the new branch. If either is missing, runs the workflow generator for that single branch to create them (see [Workflow generator SHA](#workflow-generator-sha)).
6. **Triggers release-train-join** — dispatches `release-train-join.yml` in the commercial repo and waits for it to complete. This step is skipped when `trigger_release_train_join` is set to `false`; the branch is still fully created and initialised.
7. **Triggers CI** — squashes all `[skip actions]` initialisation commits into a single root commit and force pushes it (without `[skip actions]`) to start CI now that the branch is fully initialised.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `oss_repo` | yes | — | OSS repository name in the `spring-cloud` org (e.g. `spring-cloud-stream`) |
| `oss_tag` | yes | — | Tag in the OSS repository to branch from (e.g. `v5.0.1`) |
| `spring_release_train` | yes | — | Spring release train this hotfix belongs to (e.g. `2026.1`). Passed to `release-train-join`. |
| `project_version` | no | `<current>.1-SNAPSHOT` | Override the auto-computed hotfix project version |
| `release_train_version` | no | — | Release train version (e.g. `2025.1.2` or `2025.1.2.1-snapshot`). When supplied, all dependency version properties are updated from the Spring Cloud release train. Mutually exclusive with `versions`. |
| `versions` | no | — | JSON map of dependency versions to apply directly (e.g. `{"spring-boot":"3.3.0","spring-cloud-commons":"4.1.1"}`). Mutually exclusive with `release_train_version`. |
| `sha` | no | Triggering commit | Commit SHA of this repo to copy release-train action files from when the workflow generator runs. See [Workflow generator SHA](#workflow-generator-sha). |
| `trigger_release_train_join` | no | `true` | Whether to dispatch `release-train-join.yml` in the commercial repo after the branch is prepared. Set to `false` to create and initialise the branch without joining the release train. |

When called as a reusable workflow (`workflow_call`), a `token` secret can also be supplied; if omitted the `GH_ACTIONS_REPO_TOKEN` organisation secret is used.

## Branch and version naming

| OSS tag | Commercial repo | Commercial branch | Default project version |
|---------|----------------|-------------------|------------------------|
| `v5.0.1` | `org/repo-commercial` | `release/5.0.1.1` | `5.0.1.1-SNAPSHOT` |
| `v3.3.2` | `org/repo-commercial` | `release/3.3.2.1` | `3.3.2.1-SNAPSHOT` |
| `v2.0.0` | `org/repo-commercial` | `release/2.0.0.1` | `2.0.0.1-SNAPSHOT` |

## Version update behaviour

The version update step always runs. Exactly which versions are changed depends on the inputs supplied:

| Inputs | Project version | Dependency versions |
|--------|----------------|---------------------|
| Neither `versions` nor `release_train_version` | `<current>.1-SNAPSHOT` | unchanged |
| `project_version` only | explicit override | unchanged |
| `versions` only | `<current>.1-SNAPSHOT` | from `versions` map |
| `versions` + `project_version` | explicit override | from `versions` map |
| `release_train_version` | `<current>.1-SNAPSHOT` | fetched from Spring Cloud release train |
| `release_train_version` + `project_version` | explicit override | fetched from Spring Cloud release train |

When `release_train_version` is used the action fetches the matching `jenkins-releaser-config` properties file from `spring-cloud-release-commercial`. The version can be specified as a GA version (`2025.1.2`), a full hotfix version (`2025.1.2.1`), or a SNAPSHOT version (`2025.1.2.1-snapshot`) — the correct parent GA properties file is always resolved automatically.

## Workflow generator SHA

When the `ensure-workflows` step needs to generate `release-train-join.yml` and `release-train-ready.yml` for a new branch, it invokes the [`generate-workflows-for-branch`](../actions/generate-workflows-for-branch/) action. That action copies release-train action files from this repo into the commercial repo. The `sha` input controls which commit of this repo is used as the source. When omitted, the commit that triggered the workflow is used.

This is useful if you need to ensure a specific version of the build/test action logic is deployed to the new branch:

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1 \
  -f sha=348109524f9790dc1e20d48043fb1ef4765373b8
```

## Usage

### Manual dispatch (simplest — auto-computes everything)

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1
```

This creates `spring-cloud/spring-cloud-foo-commercial` branch `release/5.0.1.1`, stamps the project version to `5.0.1.1-SNAPSHOT`, and triggers `release-train-join`.

### With an explicit project version

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1 \
  -f project_version=5.0.1.2-SNAPSHOT
```

### With dependency versions from a release train

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1 \
  -f release_train_version=2025.1.2
```

### With explicit dependency versions (no release train lookup)

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1 \
  -f versions='{"spring-boot":"3.3.5","spring-cloud-commons":"4.1.2"}'
```

### Without triggering release-train-join

Create and initialise the branch but opt out of joining the release train:

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f oss_tag=v5.0.1 \
  -f spring_release_train=2026.1 \
  -f trigger_release_train_join=false
```

### As a reusable workflow

```yaml
jobs:
  hotfix:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/create-hotfix-release-branch.yml@main
    with:
      oss_repo: spring-cloud-foo
      oss_tag: v5.0.1
      spring_release_train: '2026.1'
      release_train_version: '2025.1.2'
      trigger_release_train_join: true
    secrets:
      token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Related workflows

| Workflow | Use when |
|----------|----------|
| [`create-commercial-branch`](create-commercial-branch.yml) | Copying an OSS branch (not a tag) to the commercial repo |
| [`initialize-commercial-branch`](initialize-commercial-branch.yml) | Full control over repo names, branch names, and all options |
| [Run GitHub Actions Workflow Generator](run-github-actions-workflow-generator.README.md) | Regenerating workflows across all repos/branches in bulk |
