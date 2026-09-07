# Spring Release Train Project Ready Action

A composite GitHub Action that prepares a Spring Cloud project for release train readiness. It checks out the project's release branch, updates all dependency versions from the release train, verifies no pre-release versions remain, commits and pushes the changes, triggers the project's `release-train-ready.yml` workflow, and then removes the release branch from the Antora playbook.

## Description

This action orchestrates the steps required to mark a Spring Cloud project as ready within a release train:

1. **Resolve the version** for this project from the release train's properties file, and confirm it has not already been released
2. **Checkout** the `release/<version>` branch of `spring-cloud/<project>`
3. **Update versions** using the `update-project-versions` action, resolving all dependency versions from the jenkins-releaser-config properties file for the given release train
4. **Verify** that no pre-release versions (`-SNAPSHOT`, `-RC*`, `-M*`) remain in any Maven or Gradle build file
5. **Commit and push** the version changes (if any) with the message `"Release <version>"`
6. **Trigger** the `release-train-ready.yml` workflow on the project's release branch
7. **Remove from Antora playbook** — removes `release/<version>` from `content.sources.branches` in the `antora-playbook.yml` on the repo's `docs-build` branch (no-op when the docs-build branch, playbook, or branch entry is absent)

Release branches are not registered in `config/projects.json`, so nothing is removed from it here. The long-lived `<major>.<minor>.x-internal` branch **is** registered, and it is deregistered by [`retire-branch.yml`](../../workflows/retire-branch.yml) when the minor line is retired — not on every release.

If verification fails (step 4), the action stops immediately — no commit, push, or workflow dispatch occurs.

### The version is derived, not passed in

`spring-cloud-release-train-version` and `project` together determine everything else. This
project's entry in that train's properties file **is** the version being released —
`2026_0_0-m1.properties` says `spring-cloud-config=5.1.0-M1` — which names the
`release/5.1.0-M1` branch to check out, dispatch into and drop from the Antora playbook.
There is nothing for a separate version input to say that these two do not already fix.

Step 1 also refuses when `v<version>` already exists, in either the OSS or the commercial
repository. Release branches are not deleted after a release, so `release/5.0.5` is still
there long after 5.0.5 shipped; without that check, naming an already-released train would
re-stamp that branch and re-dispatch readiness for it.

## Inputs

| Input | Description                                                                                                                                                                                     | Required | Default |
|-------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `project` | The spring-cloud GitHub project name (e.g. `spring-cloud-config`). Selects the repository to act on; append `-commercial` for commercial variants. The release branch inside it is derived, not passed in. | Yes | — |
| `spring-cloud-release-train-version` | The Spring Cloud release train version matching the jenkins-releaser-config properties file (e.g. `2025.0.0`). Used to resolve dependency versions.                                             | Yes | — |
| `spring-release-train-version` | The Spring release train version to mark this project ready in (e.g. `2026.07`). Passed as the `release-train` input to the project's `release-train-ready.yml` workflow.                       | Yes | — |
| `token` | GitHub token for checkout, push, and workflow dispatch.                                                                                                                                         | Yes | — |

## Usage

### Typical Usage

```yaml
jobs:
  release-train-ready:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Mark spring-cloud-config ready in release train
        uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@v1
        with:
          project: spring-cloud-config
          spring-cloud-release-train-version: '2025.0.0'
          spring-release-train-version: '2026.07'
          token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### Where the releaser config comes from

**Always `spring-cloud/spring-cloud-release-commercial`, for OSS releases too** — the same
choice `post-release.yml`, `update-versions.yml`, `setup-next-release-train.yml` and
`create-oss-release-branch.yml` all make. That repository holds the releaser config for
every train now, and its train files are plain OSS train files: `2026_0_0-m1.properties` is
`spring-cloud-config=5.1.0-M1` and so on, with no commercial-only versions in it.

The OSS repository's copy of `jenkins-releaser-config` stopped at 2025.1.3 and disagrees
with reality where the two still overlap, so reading it for an OSS release would 404 on a
current train and stamp versions that were never released on an older one.

Both reads go there — the version check, and the `commercial: 'true'` passed to
`update-project-versions` — so the file validated against and the file stamped from are
always the same one.

### Commercial Variant

The `-commercial` suffix selects the **project repository** to check out and dispatch into,
and nothing else. It is stripped before looking the project up in the properties file,
since the config lists `spring-cloud-config` rather than `spring-cloud-config-commercial`.

```yaml
- name: Mark spring-cloud-config-commercial ready in release train
  uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@v1
  with:
    project: spring-cloud-config-commercial
    spring-cloud-release-train-version: '2025.0.0'
    spring-release-train-version: '2026.07'
    token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

### Matrix Strategy Across Multiple Projects

```yaml
jobs:
  release-train-ready:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        project:
          - spring-cloud-config
          - spring-cloud-gateway
          - spring-cloud-commons
    steps:
      - uses: actions/checkout@v4

      - uses: spring-cloud/spring-cloud-github-actions/.github/actions/spring-release-train-project-ready@v1
        with:
          project: ${{ matrix.project }}
          spring-cloud-release-train-version: '2025.0.0'
          spring-release-train-version: '2026.07'
          token: ${{ secrets.GH_ACTIONS_REPO_TOKEN }}
```

## How It Works

### Version Updates

The action passes the following fixed substitutions to `update-project-versions` to handle non-standard version property naming conventions across Spring Cloud projects:

| Property key | Maps to project |
|---|---|
| `spring-cloud-dependencies-parent` | `spring-cloud-build` |
| `verifier` | `spring-cloud-contract` |
| `springBoot` | `spring-boot` |

### Version Verification

After updating, `verify-no-snapshot-versions` scans all `pom.xml`, `gradle.properties`, `build.gradle`, and `build.gradle.kts` files to confirm no pre-release versions remain. If any are found, the action fails with a detailed list of violations and skips the commit, push, and workflow dispatch.

### Commit Author

Changes are committed as:
- **Name:** `spring-builds`
- **Email:** `spring-builds@users.noreply.github.com`

If there are no changes to commit (versions were already at release values), the commit and push steps are skipped, but the `release-train-ready.yml` workflow is still triggered.

### Workflow Dispatch

The action triggers `release-train-ready.yml` via `gh workflow run` with:
- `release-train`: the value of the `spring-release-train-version` input
- `release-train-repository`: `spring-io/release-train` (the default for that workflow)

## Required Token Permissions

The token provided (or the `GH_ACTIONS_REPO_TOKEN` secret) must have:
- **Contents: write** on `spring-cloud/<project>` — to push commits to the release branch
- **Actions: write** on `spring-cloud/<project>` — to dispatch the `release-train-ready.yml` workflow
- **Contents: read** on `spring-cloud/spring-cloud-release-commercial` — to fetch the jenkins-releaser-config properties file, for OSS releases too (see [Where the releaser config comes from](#where-the-releaser-config-comes-from))

## License

Apache License 2.0
