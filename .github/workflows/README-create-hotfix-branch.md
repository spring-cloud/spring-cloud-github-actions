# create-hotfix-branch

Creates a commercial hotfix release branch. By default, the branch is cut from the tip of the commercial repo's `<major>.<minor>.x-internal` branch, preserving its full git history so the hotfix branch can later be rebased onto an updated `-internal` branch. Setting `use_tag` instead creates the branch from an OSS tag — an orphan branch with no shared history, the workflow's original behaviour. Either way, the workflow stamps the project version to a hotfix snapshot, ensures required release-train workflows are present, and (by default) triggers `release-train-join` in the commercial repo.

The hotfix version itself is never passed in directly — it's looked up from this project's own entry in the release train's `jenkins-releaser-config` properties file, keyed by `release_train_version`.

## What it does

1. **Looks up the hotfix version and derives names** — detects this project's artifact ID from the OSS repo's root `pom.xml`, then reads `releaser.fixed-versions[<project>]` from the `release_train_version`'s properties file in `spring-cloud-release-commercial@jenkins-releaser-config` to get the hotfix version (e.g. `5.0.4.1`). From it: the commercial branch is `release/<version>` (e.g. `release/5.0.4.1`), the internal branch is `<major>.<minor>.x-internal` (e.g. `5.0.x-internal`), and (when `use_tag` is set) the OSS tag is `v<major>.<minor>.<patch>` (e.g. `v5.0.4`). The commercial repo is always the OSS repo with `-commercial` appended.
2. **Validates the `-internal` branch** (default path only) — fails before making any changes if the `-internal` branch's `pom.xml` version doesn't exactly match `<major>.<minor>.<patch>-INTERNAL-SNAPSHOT` — i.e. if the `-internal` branch is out of date.
3. **Creates the branch**:
   - Default (`use_tag: false`): forks `release/<version>` from the tip of the `-internal` branch via the GitHub API, preserving its full git history. Then adds a retargeted `ci-release.yml`/`release-ci-settings.xml` (via `add-commercial-release-files`, which already point the build at the commercial deploy target — no `.settings.xml` copy, workflow rewrite, or `pom.xml` distribution-management edit needed), updates license headers (and `checkstyle-header.txt`), and registers the branch in `config/projects.json` (a hotfix branch can fail its own CI independently of `-internal`, so it needs its own scheduled CI entry — this entry is removed automatically once the hotfix's release is finalized).
   - `use_tag: true`: delegates to [`initialize-commercial-branch`](initialize-commercial-branch.yml), which creates an orphan branch from the OSS tag and runs the full suite of commercial setup actions: copy `.settings.xml`, update CI/PR workflows, update licence headers, replace OSS repositories with commercial Broadcom repositories, update distribution management, and update `config/projects.json`.
4. **Creates a milestone** — creates a milestone in the commercial repo for the hotfix version if one does not already exist.
5. **Stamps the project version** — updates the project version in `pom.xml`, `gradle.properties`, and `build.gradle` files to `<version>-SNAPSHOT` (e.g. `5.0.4.1-SNAPSHOT`), and updates dependency versions from the release train. `versions` can supply additional dependency version overrides on top.
6. **Ensures required workflows** — checks that `release-train-join.yml` and `release-train-ready.yml` are present on the new branch. If either is missing, runs the workflow generator for that single branch to create them (see [Workflow generator SHA](#workflow-generator-sha)).
7. **Triggers release-train-join** — dispatches `release-train-join.yml` in the commercial repo and waits for it to complete. This step is skipped when `spring_release_train` is left empty; the branch is still fully created and initialised.
8. **Triggers CI**:
   - Default path: squashes only the initialisation commits added on top of the `-internal` fork point into one commit and pushes it — history at and before the fork point is left untouched.
   - `use_tag` path: squashes all `[skip actions]` initialisation commits into a single orphan root commit and force pushes it (without `[skip actions]`) to start CI.

## Inputs

| Name | Required | Default | Description |
|------|----------|---------|-------------|
| `oss_repo` | yes | — | OSS repository name in the `spring-cloud` org (e.g. `spring-cloud-stream`) |
| `release_train_version` | yes | — | Release train version (e.g. `2025.1.2`) whose `jenkins-releaser-config` properties file names this project's hotfix version and supplies dependency versions |
| `use_tag` | no | `false` | Create the branch from an OSS tag (`v<major>.<minor>.<patch>`) instead of the `<major>.<minor>.x-internal` branch |
| `spring_release_train` | no | — | Spring release train this hotfix belongs to (e.g. `2026.1`). Passed to `release-train-join`, and supplying it is what triggers the join — leave it empty to prepare the branch without joining. |
| `versions` | no | — | JSON map of dependency versions to apply on top of the release train's dependency versions (e.g. `{"spring-boot":"3.3.0","spring-cloud-commons":"4.1.1"}`) |
| `sha` | no | Triggering commit | Commit SHA of this repo to copy release-train action files from when the workflow generator runs. See [Workflow generator SHA](#workflow-generator-sha). |

When called as a reusable workflow (`workflow_call`), a `token` secret can also be supplied; if omitted the `GH_ACTIONS_REPO_TOKEN` organisation secret is used.

## Branch and version naming

Given a release train whose `jenkins-releaser-config` properties file has `releaser.fixed-versions[<project>]=5.0.4.1`:

| Derived value | Example |
|---------------|---------|
| Commercial repo | `org/repo-commercial` |
| Commercial branch | `release/5.0.4.1` |
| Internal branch (default path) | `5.0.x-internal` |
| Expected internal `pom.xml` version (default path) | `5.0.4-INTERNAL-SNAPSHOT` |
| OSS tag (`use_tag` path only) | `v5.0.4` |
| Stamped project version | `5.0.4.1-SNAPSHOT` |

## Usage

### Manual dispatch — default path, from `-internal`

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f release_train_version=2025.1.2 \
  -f spring_release_train=2026.1
```

This looks up `spring-cloud-foo`'s fixed version for release train `2025.1.2` (e.g. `5.0.4.1`), verifies `5.0.x-internal` in `spring-cloud/spring-cloud-foo-commercial` is at `5.0.4-INTERNAL-SNAPSHOT`, forks `release/5.0.4.1` from it, stamps the project version to `5.0.4.1-SNAPSHOT`, and triggers `release-train-join`.

### From an OSS tag instead of `-internal`

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f release_train_version=2025.1.2 \
  -f spring_release_train=2026.1 \
  -f use_tag=true
```

Same version lookup, but creates the branch as an orphan copy of tag `v5.0.4`, with full commercial customisation, instead of forking `5.0.x-internal`.

### With explicit dependency version overrides

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f release_train_version=2025.1.2 \
  -f spring_release_train=2026.1 \
  -f versions='{"spring-boot":"3.3.5","spring-cloud-commons":"4.1.2"}'
```

### Without triggering release-train-join

Create and initialise the branch but opt out of joining the release train:

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f release_train_version=2025.1.2
```

Omitting `spring_release_train` is what opts out: everything else runs, and the branch is
created and initialised as usual.

### As a reusable workflow

```yaml
jobs:
  hotfix:
    uses: spring-cloud/spring-cloud-github-actions/.github/workflows/create-hotfix-release-branch.yml@v1
    with:
      oss_repo: spring-cloud-foo
      release_train_version: '2025.1.2'
      spring_release_train: '2026.1'
    secrets:
      token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## Workflow generator SHA

When the `ensure-workflows` step needs to generate `release-train-join.yml` and `release-train-ready.yml` for a new branch, it invokes the [`generate-workflows-for-branch`](../actions/generate-workflows-for-branch/) action. That action copies release-train action files from this repo into the commercial repo. The `sha` input controls which commit of this repo is used as the source. When omitted, the commit that triggered the workflow is used.

This is useful if you need to ensure a specific version of the build/test action logic is deployed to the new branch:

```bash
gh workflow run create-hotfix-release-branch.yml \
  -f oss_repo=spring-cloud-foo \
  -f release_train_version=2025.1.2 \
  -f spring_release_train=2026.1 \
  -f sha=348109524f9790dc1e20d48043fb1ef4765373b8
```

## Related workflows

| Workflow | Use when |
|----------|----------|
| [`create-oss-release-branch`](create-oss-release-branch.yml) | Cutting a GA (non-hotfix) `release/<version>` branch from `-internal` |
| [`create-commercial-branch`](create-commercial-branch.yml) | Copying an OSS branch (not a tag) to the commercial repo |
| [`initialize-commercial-branch`](initialize-commercial-branch.yml) | Full control over repo names, branch names, and all options |
| [Run GitHub Actions Workflow Generator](run-github-actions-workflow-generator.README.md) | Regenerating workflows across all repos/branches in bulk |
